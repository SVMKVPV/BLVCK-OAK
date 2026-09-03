import { randomUUID } from 'node:crypto';

import {
  getRewardHoldDays,
  getStripe,
  isReferralAccountEligible,
  json,
  referralsStore,
  rewardsStore,
} from '../lib/referrals.mjs';

const PAYOUT_BATCH_LIMIT = 100;

export default async function handler() {
  const summary = { transferred: 0, deferred: 0, failed: 0 };

  try {
    const stripe = getStripe();
    const rewardStore = rewardsStore();
    const referralStore = referralsStore();
    const { blobs } = await rewardStore.list({ prefix: 'pending/' });

    for (const pendingBlob of blobs.slice(0, PAYOUT_BATCH_LIMIT)) {
      const sessionId = pendingBlob.key.slice('pending/'.length);
      const rewardKey = `reward/${sessionId}`;
      let claimedRunId = null;

      try {
        const entry = await rewardStore.getWithMetadata(rewardKey, { type: 'json', consistency: 'strong' });
        const reward = entry?.data;
        if (!reward || reward.status !== 'pending' || reward.rewardCents <= 0) {
          await rewardStore.delete(pendingBlob.key);
          continue;
        }

        const fallbackEligibleAt = new Date(new Date(reward.createdAt).getTime() + getRewardHoldDays() * 86400000);
        const eligibleAt = new Date(reward.eligibleAt || fallbackEligibleAt);
        if (!Number.isFinite(eligibleAt.getTime()) || eligibleAt > new Date()) {
          summary.deferred += 1;
          continue;
        }

        const referral = await referralStore.get(`code/${reward.referralCode}`, { type: 'json', consistency: 'strong' });
        if (!referral || referral.status === 'suspended' || referral.status === 'closed') {
          summary.failed += 1;
          continue;
        }

        const account = await stripe.accounts.retrieve(referral.stripeAccountId);
        if (!isReferralAccountEligible(account)) {
          summary.deferred += 1;
          continue;
        }

        if (!reward.sourceChargeId) {
          summary.failed += 1;
          continue;
        }
        const charge = await stripe.charges.retrieve(reward.sourceChargeId);
        const remainingChargeCents = Math.max(0, charge.amount - charge.amount_refunded);
        if (charge.status !== 'succeeded' || charge.disputed || remainingChargeCents !== reward.amountPaidCents) {
          summary.deferred += 1;
          continue;
        }

        claimedRunId = randomUUID();
        const processingReward = {
          ...reward,
          status: 'processing',
          processingRunId: claimedRunId,
          processingAt: new Date().toISOString(),
        };
        const claim = await rewardStore.setJSON(rewardKey, processingReward, { onlyIfMatch: entry.etag });
        if (!claim.modified) {
          summary.deferred += 1;
          continue;
        }

        const transfer = await stripe.transfers.create({
          amount: processingReward.rewardCents,
          currency: processingReward.currency,
          destination: referral.stripeAccountId,
          source_transaction: reward.sourceChargeId,
          transfer_group: `REFERRAL_${reward.sessionId}`,
          description: `Black Oak referral ${reward.referralCode}`,
          metadata: {
            referral_code: reward.referralCode,
            checkout_session: reward.sessionId,
            package_id: reward.packageId,
          },
        }, { idempotencyKey: `black-oak-referral-${reward.sessionId}` });

        const claimedEntry = await rewardStore.getWithMetadata(rewardKey, { type: 'json', consistency: 'strong' });
        if (claimedEntry?.data?.status !== 'processing' || claimedEntry.data.processingRunId !== claimedRunId) {
          throw new Error('Reward state changed during transfer; manual reconciliation is required.');
        }

        const transferredReward = {
          ...claimedEntry.data,
          status: 'transferred',
          transferId: transfer.id,
          transferredAt: new Date().toISOString(),
        };
        delete transferredReward.processingRunId;
        delete transferredReward.processingAt;
        const saved = await rewardStore.setJSON(rewardKey, transferredReward, { onlyIfMatch: claimedEntry.etag });
        if (!saved.modified) throw new Error('Transfer completed but reward state could not be finalized.');
        await rewardStore.delete(pendingBlob.key);
        summary.transferred += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Referral payout failed for ${sessionId}:`, error.message);

        if (claimedRunId) {
          const latest = await rewardStore.getWithMetadata(rewardKey, { type: 'json', consistency: 'strong' }).catch(() => null);
          if (latest?.data?.status === 'processing' && latest.data.processingRunId === claimedRunId) {
            const pendingReward = { ...latest.data, status: 'pending', lastPayoutErrorAt: new Date().toISOString() };
            delete pendingReward.processingRunId;
            delete pendingReward.processingAt;
            await rewardStore.setJSON(rewardKey, pendingReward, { onlyIfMatch: latest.etag }).catch(() => {});
          }
        }
      }
    }

    return json(summary);
  } catch (error) {
    console.error('Weekly referral payout run failed:', error.message);
    return json({ ...summary, error: 'Weekly payout processing failed.' }, 500);
  }
}
