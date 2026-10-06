import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { PortalError, assertCsrf, clientError, readBody, requireAccount } from '../lib/portal-auth.mjs';
import { json, scopedStoreName } from '../lib/referrals.mjs';

const TYPES = new Set(['supplier', 'tax', 'payroll', 'rent', 'super', 'contractor', 'international']);
const FUNDING = new Set(['card', 'bank', 'bpay']);
const ROLES = new Set(['admin', 'approver', 'viewer']);
const REWARD_TIERS = new Set(['core', 'plus']);

function workspaceStore() {
  return getStore({ name: scopedStoreName('black-oak-pay-workspaces'), consistency: 'strong' });
}

function textValue(value, max = 120, { required = false } = {}) {
  const result = String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, ' ');
  if (required && !result) throw new PortalError('Complete all required fields.');
  if (result.length > max) throw new PortalError('One of the fields is too long.');
  return result;
}

function positiveCents(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 100_000_000_00) throw new PortalError('Enter a valid payment amount.');
  return number;
}

function dateValue(value) {
  const result = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result + 'T00:00:00Z'))) throw new PortalError('Enter a valid date.');
  return result;
}

function emailValue(value) {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || result.length > 160) throw new PortalError('Enter a valid email address.');
  return result;
}

function baseState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    profile: { businessName: '', abn: '', industry: '', rewardsTier: 'core' },
    suppliers: [],
    bills: [],
    payments: [],
    paymentRequests: [],
    team: [],
    integrations: {
      xero: { status: 'not_configured' },
      myob: { status: 'not_configured' },
      paymentProvider: { status: 'not_configured' },
    },
    activity: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normaliseState(value) {
  const state = value && typeof value === 'object' ? value : baseState();
  state.profile = state.profile && typeof state.profile === 'object' ? state.profile : baseState().profile;
  state.profile.rewardsTier = REWARD_TIERS.has(state.profile.rewardsTier) ? state.profile.rewardsTier : 'core';
  for (const key of ['suppliers', 'bills', 'payments', 'paymentRequests', 'team', 'activity']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.integrations = state.integrations && typeof state.integrations === 'object' ? state.integrations : baseState().integrations;
  return state;
}

function withSummary(state) {
  const rewardPreviewPoints = state.payments.reduce((sum, item) => sum + (Number(item.rewardPreviewPoints) || 0), 0);
  const outstanding = state.bills.filter((item) => !['paid', 'cancelled'].includes(item.status));
  return {
    ...state,
    summary: {
      outstandingBillCents: outstanding.reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0),
      openBills: outstanding.length,
      paymentInstructionCents: state.payments.filter((item) => item.status === 'provider_required').reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0),
      paymentInstructions: state.payments.length,
      rewardPreviewPoints,
      requestCents: state.paymentRequests.reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0),
      requests: state.paymentRequests.length,
    },
    capabilities: {
      liveSettlement: false,
      payIdIssuance: false,
      virtualAccounts: false,
      internationalSettlement: false,
      accountingOauth: false,
      rewardsRedemption: false,
    },
  };
}

function addActivity(state, label, detail = '') {
  state.activity.unshift({ id: randomUUID(), label, detail: textValue(detail, 180), at: new Date().toISOString() });
  state.activity = state.activity.slice(0, 100);
}

async function loadWorkspace(store, accountId) {
  const key = 'workspace/' + accountId;
  const entry = await store.getWithMetadata(key, { type: 'json' });
  return { key, entry, state: normaliseState(entry?.data) };
}

async function saveWorkspace(store, key, entry, state) {
  state.updatedAt = new Date().toISOString();
  const options = entry?.etag ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
  const saved = await store.setJSON(key, state, options);
  if (!saved.modified) throw new PortalError('Your workspace changed in another session. Refresh and try again.', 409);
  return state;
}

function requireCapacity(list, max, label) {
  if (list.length >= max) throw new PortalError(`${label} limit reached. Contact BLVCK OAK before adding more.`, 409);
}

function supplierFrom(state, id) {
  return state.suppliers.find((item) => item.id === id) || null;
}

function billFrom(state, id) {
  return state.bills.find((item) => item.id === id) || null;
}

function billInput(value, state) {
  const input = value && typeof value === 'object' ? value : {};
  const supplierId = textValue(input.supplierId, 64);
  const supplier = supplierId ? supplierFrom(state, supplierId) : null;
  const supplierName = supplier?.name || textValue(input.supplierName, 100, { required: true });
  return {
    id: randomUUID(),
    supplierId: supplier?.id || '',
    supplierName,
    amountCents: positiveCents(input.amountCents),
    dueDate: dateValue(input.dueDate),
    reference: textValue(input.reference, 80),
    category: textValue(input.category || 'Supplier', 50),
    source: 'workspace',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
}

export default async function handler(request) {
  try {
    const auth = await requireAccount(request);
    const store = workspaceStore();
    const loaded = await loadWorkspace(store, auth.account.id);

    if (request.method === 'GET') {
      return json({ state: withSummary(loaded.state), csrf: auth.session.csrf });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    assertCsrf(request, auth);
    const body = await readBody(request, 96_000);
    const state = loaded.state;

    if (body.action === 'save_profile') {
      const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
      const rewardsTier = String(profile.rewardsTier || 'core');
      if (!REWARD_TIERS.has(rewardsTier)) throw new PortalError('Choose a valid rewards preview.');
      const abn = String(profile.abn || '').replace(/\s+/g, '');
      if (abn && !/^\d{11}$/.test(abn)) throw new PortalError('ABN must contain 11 digits.');
      state.profile = {
        businessName: textValue(profile.businessName, 120, { required: true }),
        abn,
        industry: textValue(profile.industry, 80),
        rewardsTier,
      };
      addActivity(state, 'Business profile updated', state.profile.businessName);
    } else if (body.action === 'add_supplier') {
      requireCapacity(state.suppliers, 150, 'Supplier');
      const supplier = body.supplier && typeof body.supplier === 'object' ? body.supplier : {};
      const type = String(supplier.type || 'supplier');
      if (!TYPES.has(type)) throw new PortalError('Choose a valid recipient type.');
      const last4 = String(supplier.destinationLast4 || '').trim();
      if (last4 && !/^\d{4}$/.test(last4)) throw new PortalError('Destination last four must contain four digits.');
      const record = {
        id: randomUUID(),
        name: textValue(supplier.name, 100, { required: true }),
        type,
        destinationLabel: textValue(supplier.destinationLabel, 100),
        destinationLast4: last4,
        createdAt: new Date().toISOString(),
      };
      state.suppliers.unshift(record);
      addActivity(state, 'Supplier added', record.name);
    } else if (body.action === 'add_bill') {
      requireCapacity(state.bills, 500, 'Bill');
      const record = billInput(body.bill, state);
      state.bills.unshift(record);
      addActivity(state, 'Bill added', `${record.supplierName} · $${(record.amountCents / 100).toFixed(2)}`);
    } else if (body.action === 'import_bills') {
      if (!Array.isArray(body.bills) || !body.bills.length || body.bills.length > 50) throw new PortalError('Import between 1 and 50 bills at a time.');
      if (state.bills.length + body.bills.length > 500) throw new PortalError('Bill limit reached.', 409);
      const records = body.bills.map((item) => billInput(item, state));
      state.bills.unshift(...records);
      addActivity(state, 'Bills imported', `${records.length} bills from CSV`);
    } else if (body.action === 'queue_payment') {
      requireCapacity(state.payments, 500, 'Payment instruction');
      const input = body.payment && typeof body.payment === 'object' ? body.payment : {};
      const supplier = supplierFrom(state, textValue(input.supplierId, 64, { required: true }));
      if (!supplier) throw new PortalError('Choose a saved supplier.');
      const fundingMethod = String(input.fundingMethod || '');
      if (!FUNDING.has(fundingMethod)) throw new PortalError('Choose a valid funding method.');
      const billId = textValue(input.billId, 64);
      const bill = billId ? billFrom(state, billId) : null;
      if (billId && !bill) throw new PortalError('The selected bill no longer exists.');
      if (bill && bill.supplierId && bill.supplierId !== supplier.id) throw new PortalError('The bill belongs to a different supplier.');
      const amountCents = positiveCents(input.amountCents);
      const pointsRate = state.profile.rewardsTier === 'plus' ? 2 : 1;
      const record = {
        id: randomUUID(),
        supplierId: supplier.id,
        supplierName: supplier.name,
        billId: bill?.id || '',
        amountCents,
        fundingMethod,
        scheduledDate: dateValue(input.scheduledDate),
        reference: textValue(input.reference || bill?.reference, 80),
        rewardPreviewPoints: Math.floor((amountCents / 100) * pointsRate),
        status: 'provider_required',
        createdAt: new Date().toISOString(),
      };
      state.payments.unshift(record);
      addActivity(state, 'Payment instruction queued', `${record.supplierName} · $${(amountCents / 100).toFixed(2)} · no funds moved`);
    } else if (body.action === 'create_payment_request') {
      requireCapacity(state.paymentRequests, 300, 'Payment request');
      const input = body.request && typeof body.request === 'object' ? body.request : {};
      const record = {
        id: randomUUID(),
        customerName: textValue(input.customerName, 100, { required: true }),
        customerEmail: emailValue(input.customerEmail),
        amountCents: positiveCents(input.amountCents),
        reference: textValue(input.reference, 80),
        description: textValue(input.description, 500),
        status: 'draft',
        createdAt: new Date().toISOString(),
      };
      state.paymentRequests.unshift(record);
      addActivity(state, 'Customer payment request drafted', `${record.customerName} · $${(record.amountCents / 100).toFixed(2)}`);
    } else if (body.action === 'add_team_member') {
      requireCapacity(state.team, 30, 'Team member');
      const member = body.member && typeof body.member === 'object' ? body.member : {};
      const email = emailValue(member.email);
      const role = String(member.role || '');
      if (!ROLES.has(role)) throw new PortalError('Choose a valid team role.');
      if (email === auth.account.email || state.team.some((item) => item.email === email)) throw new PortalError('That email is already on the account.');
      state.team.unshift({ id: randomUUID(), email, role, status: 'role_model_only', createdAt: new Date().toISOString() });
      addActivity(state, 'Team role saved', `${email} · ${role}`);
    } else {
      throw new PortalError('Unknown BLVCK OAK PAY action.');
    }

    const saved = await saveWorkspace(store, loaded.key, loaded.entry, state);
    return json({ state: withSummary(saved), csrf: auth.session.csrf });
  } catch (error) {
    console.error('BLVCK OAK PAY request failed:', error.name);
    const result = clientError(error);
    return json({ error: result.error }, result.status);
  }
}