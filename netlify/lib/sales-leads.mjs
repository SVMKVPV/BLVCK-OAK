import { createHash, randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { scopedStoreName } from './referrals.mjs';

export const salesStore = () => getStore({ name: scopedStoreName('black-oak-sales'), consistency: 'strong' });
export const leadIdPattern = /^[a-f0-9]{32}$/;
export const leadStatuses = Object.freeze(['new', 'contacted', 'qualified', 'booked', 'won', 'lost']);

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

export function publicLead(lead) {
  return {
    id: lead.id,
    type: lead.type,
    name: lead.name,
    email: lead.email,
    company: lead.company || '',
    phone: lead.phone || '',
    websiteUrl: lead.websiteUrl || '',
    service: lead.service || '',
    message: lead.message || '',
    preferredDate: lead.preferredDate || '',
    preferredTime: lead.preferredTime || '',
    auditScore: Number.isFinite(lead.auditScore) ? lead.auditScore : null,
    auditSummary: Array.isArray(lead.auditSummary) ? lead.auditSummary.slice(0, 8) : [],
    status: leadStatuses.includes(lead.status) ? lead.status : 'new',
    ownerNote: clean(lead.ownerNote, 1000),
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt || lead.createdAt,
    followUpSentAt: lead.followUpSentAt || null,
  };
}

export async function createSalesLead(input, store = salesStore(), now = new Date().toISOString()) {
  const requestId = clean(input.requestId, 80);
  if (!/^[A-Za-z0-9-]{16,80}$/.test(requestId)) throw new Error('Invalid lead request identifier.');
  const requestKey = `request/${hash(requestId)}`;
  const existingId = await store.get(requestKey, { type: 'text' });
  if (leadIdPattern.test(existingId || '')) {
    const existing = await store.get(`lead/${existingId}`, { type: 'json' });
    if (existing) return existing;
  }

  const id = randomBytes(16).toString('hex');
  const lead = {
    id,
    type: ['contact', 'booking', 'audit'].includes(input.type) ? input.type : 'contact',
    name: clean(input.name, 100),
    email: clean(input.email, 160).toLowerCase(),
    company: clean(input.company, 120),
    phone: clean(input.phone, 40),
    websiteUrl: clean(input.websiteUrl, 2048),
    service: clean(input.service, 120),
    message: clean(input.message, 3000),
    preferredDate: clean(input.preferredDate, 10),
    preferredTime: clean(input.preferredTime, 5),
    auditScore: Number.isFinite(input.auditScore) ? Math.max(0, Math.min(100, Math.round(input.auditScore))) : null,
    auditSummary: Array.isArray(input.auditSummary) ? input.auditSummary.map((item) => clean(item, 240)).filter(Boolean).slice(0, 8) : [],
    status: 'new',
    ownerNote: '',
    createdAt: now,
    updatedAt: now,
    followUpSentAt: null,
  };

  const reserved = await store.set(requestKey, id, { onlyIfNew: true });
  if (!reserved.modified) {
    const claimedId = await store.get(requestKey, { type: 'text' });
    const claimed = leadIdPattern.test(claimedId || '') ? await store.get(`lead/${claimedId}`, { type: 'json' }) : null;
    if (claimed) return claimed;
    throw new Error('Lead request is already processing.');
  }
  await store.setJSON(`lead/${id}`, lead, { onlyIfNew: true });
  await store.set(`lead-index/${now}/${id}`, id, { onlyIfNew: true });
  return lead;
}

export async function listSalesLeads(limit = 100, store = salesStore()) {
  const { blobs } = await store.list({ prefix: 'lead-index/' });
  const recent = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, Math.max(1, Math.min(250, limit)));
  return (await Promise.all(recent.map(async ({ key }) => {
    const id = key.split('/').at(-1);
    if (!leadIdPattern.test(id || '')) return null;
    const lead = await store.get(`lead/${id}`, { type: 'json' });
    return lead ? publicLead(lead) : null;
  }))).filter(Boolean);
}

export async function updateSalesLead(id, input, accountId, store = salesStore(), now = new Date().toISOString()) {
  if (!leadIdPattern.test(id || '')) throw new Error('Invalid lead.');
  if (!leadStatuses.includes(input.status)) throw new Error('Choose a valid lead status.');
  const entry = await store.getWithMetadata(`lead/${id}`, { type: 'json' });
  if (!entry?.data) throw new Error('Lead not found.');
  const updated = { ...entry.data, status: input.status, ownerNote: clean(input.ownerNote, 1000), updatedAt: now, updatedBy: accountId };
  const saved = await store.setJSON(`lead/${id}`, updated, { onlyIfMatch: entry.etag });
  if (!saved.modified) throw new Error('This lead changed. Refresh and try again.');
  return publicLead(updated);
}
