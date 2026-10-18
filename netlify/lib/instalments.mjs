import { PortalError } from './portal-auth.mjs';

export const INSTALMENT_PLAN_TYPE = 'instalments_15';
export const INSTALMENT_COUNT = 15;
export const INSTALMENT_VERSION = 'black_oak_instalments_v1';
export const MINIMUM_INSTALMENT_PAYMENT_CENTS = 50;

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

function allocatedProgress(amounts, paidCents) {
  let credit = paidCents;
  const schedule = amounts.map((amountCents, index) => {
    const applied = Math.min(amountCents, credit);
    credit -= applied;
    return { number: index + 1, amountCents, paidCents: applied, remainingCents: amountCents - applied, paid: applied === amountCents, partial: applied > 0 && applied < amountCents };
  });
  const paidInstalments = schedule.filter((part) => part.paid).length;
  return {
    type: INSTALMENT_PLAN_TYPE, instalmentCount: INSTALMENT_COUNT,
    paidInstalments, remainingInstalments: INSTALMENT_COUNT - paidInstalments,
    balanceCents: amounts.reduce((sum, amount) => sum + amount, 0) - paidCents,
    schedule,
  };
}

function paymentEndNumber(plan, amountCents) {
  let credit = amountCents;
  for (const part of plan.schedule) {
    if (part.paid) continue;
    credit -= part.remainingCents;
    if (credit <= 0) return part.number;
  }
  throw invalidPlan();
}

export function nextInstalmentPayment(plan) {
  const part = plan.schedule.find((item) => !item.paid);
  if (!part) return null;
  // A small part remainder can advance into the following part so every
  // Stripe charge meets the AUD minimum. Never leave an unpayable final balance.
  if (plan.balanceCents < MINIMUM_INSTALMENT_PAYMENT_CENTS) throw invalidPlan();
  const amountCents = Math.max(part.remainingCents, MINIMUM_INSTALMENT_PAYMENT_CENTS);
  const end = paymentEndNumber(plan, amountCents);
  return {
    stage: `instalment_${part.number}`, amountCents,
    instalmentNumber: part.number, instalmentCount: INSTALMENT_COUNT,
    ...(end > part.number ? { instalmentEndNumber: end } : {}),
    maxExtraCents: plan.balanceCents - amountCents,
    minimumPaymentCents: MINIMUM_INSTALMENT_PAYMENT_CENTS,
  };
}

function validatePaymentAmounts(plan, payment) {
  const expected = nextInstalmentPayment(plan);
  if (!expected || !payment || payment.stage !== expected.stage
    || !Number.isSafeInteger(payment.amountCents) || payment.amountCents < expected.amountCents || payment.amountCents > plan.balanceCents
    || (payment.instalmentNumber !== undefined && payment.instalmentNumber !== expected.instalmentNumber)
    || (payment.instalmentCount !== undefined && payment.instalmentCount !== INSTALMENT_COUNT)
    || (payment.instalmentEndNumber !== undefined && payment.instalmentEndNumber !== paymentEndNumber(plan, payment.amountCents))) throw invalidPlan();
  const hasBreakdown = payment.baseAmountCents !== undefined || payment.extraAmountCents !== undefined;
  if (hasBreakdown) {
    if (payment.baseAmountCents !== expected.amountCents || !Number.isSafeInteger(payment.extraAmountCents) || payment.extraAmountCents < 0
      || payment.amountCents !== payment.baseAmountCents + payment.extraAmountCents) throw invalidPlan();
  } else if (payment.amountCents !== expected.amountCents) {
    // Quotes and in-flight sessions created before extra payments remain valid
    // only at their original exact amount, never as an arbitrary advance.
    throw invalidPlan();
  }
  const remaining = plan.balanceCents - payment.amountCents;
  if (remaining > 0 && remaining < MINIMUM_INSTALMENT_PAYMENT_CENTS) throw invalidPlan();
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
  for (const payment of quote.payments) {
    if (!payment
      || typeof payment.sessionId !== 'string' || !payment.sessionId || sessions.has(payment.sessionId)
      || typeof payment.paymentIntentId !== 'string' || !payment.paymentIntentId || intents.has(payment.paymentIntentId)) throw invalidPlan();
    validatePaymentAmounts(allocatedProgress(amounts, paidCents), payment);
    sessions.add(payment.sessionId);
    intents.add(payment.paymentIntentId);
    paidCents += payment.amountCents;
  }
  return allocatedProgress(amounts, paidCents);
}

export function instalmentPaymentWithExtra(quote, extraAmountCents = 0) {
  const plan = readInstalmentProgress(quote);
  if (!plan) throw new PortalError('Extra payments are available on the 15-part payment plan.');
  const next = nextInstalmentPayment(plan);
  if (!next) throw new PortalError('This quote has already been paid in full.', 409);
  if (!Number.isSafeInteger(extraAmountCents) || extraAmountCents < 0) throw new PortalError('Enter a valid extra payment amount.');
  if (extraAmountCents > next.maxExtraCents) throw new PortalError('The payment cannot exceed the remaining quote balance.');
  const amountCents = next.amountCents + extraAmountCents;
  const remaining = plan.balanceCents - amountCents;
  if (remaining > 0 && remaining < MINIMUM_INSTALMENT_PAYMENT_CENTS) throw new PortalError('Leave at least A$0.50 remaining, or choose Pay remaining balance.');
  const end = paymentEndNumber(plan, amountCents);
  return {
    stage: next.stage, amountCents, baseAmountCents: next.amountCents, extraAmountCents,
    instalmentNumber: next.instalmentNumber, instalmentCount: INSTALMENT_COUNT,
    ...(end > next.instalmentNumber ? { instalmentEndNumber: end } : {}),
  };
}

// Also check existing attempts: a stored attempt must never turn a damaged
// instalment plan into a full-balance charge. Paid attempts can settle after
// proposal expiry, or during a refund/dispute review, without creating a new one.
export function validateInstalmentAttempt(quote, attempt) {
  const plan = readInstalmentProgress(quote);
  if (!plan) return;
  validatePaymentAmounts(plan, attempt);
}

export function instalmentStageLabel(stage, endNumber) {
  const match = /^instalment_([1-9]|1[0-5])$/.exec(String(stage));
  if (!match) return null;
  return Number.isInteger(endNumber) && endNumber > Number(match[1]) && endNumber <= INSTALMENT_COUNT
    ? `Payment toward parts ${match[1]}–${endNumber} of ${INSTALMENT_COUNT}`
    : `Instalment ${match[1]} of ${INSTALMENT_COUNT}`;
}
