import { PortalError } from './portal-auth.mjs';

export const INSTALMENT_PLAN_TYPE = 'instalments_15';
export const INSTALMENT_COUNT = 15;
export const INSTALMENT_VERSION = 'black_oak_instalments_v1';

function invalidPlan() {
  return new PortalError('This 15-part payment plan needs a Black Oak review before another payment.', 409);
}

// Work only in cents. Any remainder is spread over the earliest payments,
// so the approved total is preserved and parts differ by no more than one cent.
export function instalmentAmounts(totalCents) {
  if (!Number.isSafeInteger(totalCents) || totalCents < INSTALMENT_COUNT) throw invalidPlan();
  const base = Math.floor(totalCents / INSTALMENT_COUNT);
  const remainder = totalCents % INSTALMENT_COUNT;
  return Array.from({ length: INSTALMENT_COUNT }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function validateStoredInstalmentPlan(plan) {
  if (plan?.type !== INSTALMENT_PLAN_TYPE || plan.version !== INSTALMENT_VERSION || plan.instalmentCount !== INSTALMENT_COUNT) throw invalidPlan();
  return { type: INSTALMENT_PLAN_TYPE, version: INSTALMENT_VERSION, instalmentCount: INSTALMENT_COUNT };
}

export function readInstalmentProgress(quote) {
  if (quote?.paymentPlan?.type !== INSTALMENT_PLAN_TYPE) return null;
  validateStoredInstalmentPlan(quote.paymentPlan);
  if (!Number.isSafeInteger(quote.totalCents) || quote.totalCents < 10000 || quote.totalCents > 10000000
    || quote.depositCents !== 0 || !Array.isArray(quote.payments) || quote.payments.length > INSTALMENT_COUNT) throw invalidPlan();
  const amounts = instalmentAmounts(quote.totalCents);
  const sessions = new Set();
  const intents = new Set();
  let paidCents = 0;
  for (const [index, payment] of quote.payments.entries()) {
    if (!payment || payment.stage !== `instalment_${index + 1}` || payment.amountCents !== amounts[index]
      || typeof payment.sessionId !== 'string' || !payment.sessionId || sessions.has(payment.sessionId)
      || typeof payment.paymentIntentId !== 'string' || !payment.paymentIntentId || intents.has(payment.paymentIntentId)) throw invalidPlan();
    sessions.add(payment.sessionId);
    intents.add(payment.paymentIntentId);
    paidCents += payment.amountCents;
  }
  return {
    type: INSTALMENT_PLAN_TYPE,
    instalmentCount: INSTALMENT_COUNT,
    paidInstalments: quote.payments.length,
    remainingInstalments: INSTALMENT_COUNT - quote.payments.length,
    balanceCents: quote.totalCents - paidCents,
    schedule: amounts.map((amountCents, index) => ({ number: index + 1, amountCents, paid: index < quote.payments.length })),
  };
}

// Also check existing attempts: a stored attempt must never turn a damaged
// instalment plan into a full-balance charge. Paid attempts can settle after
// proposal expiry, or during a refund/dispute review, without creating a new one.
export function validateInstalmentAttempt(quote, attempt) {
  const plan = readInstalmentProgress(quote);
  if (!plan) return;
  const part = plan.schedule[plan.paidInstalments];
  if (!part || !attempt || attempt.stage !== `instalment_${part.number}` || attempt.amountCents !== part.amountCents
    || (attempt.instalmentNumber !== undefined && attempt.instalmentNumber !== part.number)
    || (attempt.instalmentCount !== undefined && attempt.instalmentCount !== INSTALMENT_COUNT)) throw invalidPlan();
}

export function instalmentStageLabel(stage) {
  const match = /^instalment_([1-9]|1[0-5])$/.exec(String(stage));
  return match ? `Instalment ${match[1]} of ${INSTALMENT_COUNT}` : null;
}
