import { json, runtimeEnv } from '../lib/referrals.mjs';
import { assertCsrf, clientError, hash, PortalError, portalStore, readBody, requireAccount, validEmail } from '../lib/portal-auth.mjs';
import { createSalesLead, leadIdPattern, listSalesLeads, publicLead, salesStore } from '../lib/sales-leads.mjs';
import { saveLeadOperations } from '../lib/owner-operations.mjs';
import { leadWorkflow, operationsSnapshot } from '../../operations-model.js';

export function createOperationsHandler(dependencies = {}) {
  const { getPortalStore = portalStore, authenticate = requireAccount, getSalesStore = salesStore, listLeads = listSalesLeads, createLead = createSalesLead, saveLead = saveLeadOperations, env = runtimeEnv, now = Date.now } = dependencies;
  return async function handler(request) {
    try {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
      const auth = await authenticate(request, getPortalStore());
      if (!auth.isOwner) throw new PortalError('This workspace is only available to the BLVCK OAK owner.', 403);
      if (request.method === 'POST') assertCsrf(request, auth);
      const store = getSalesStore();
      if (request.method === 'GET') {
        const id = new URL(request.url).searchParams.get('lead');
        if (id !== null) {
          if (!leadIdPattern.test(id)) throw new PortalError('Invalid lead.');
          const lead = await store.get(`lead/${id}`, { type: 'json' });
          if (!lead) throw new PortalError('Lead not found.', 404);
          return json({ lead: { ...publicLead(lead), workflow: leadWorkflow(lead, now()) }, csrf: auth.session.csrf });
        }
        const leads = await listLeads(250, store);
        return json({
          ...operationsSnapshot(leads, now()), csrf: auth.session.csrf, ownerName: auth.account.name,
          configuration: { email: Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM') && (env('OWNER_NOTIFICATION_EMAIL') || env('OWNER_EMAIL'))), payments: Boolean(env('STRIPE_SECRET_KEY')) },
        });
      }
      const body = await readBody(request, 12000);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PortalError('Invalid request.');
      if (['save_lead', 'log_contact'].includes(body.action)) {
        const lead = await saveLead(store, body, auth.account.id, now());
        return json({ lead: { ...lead, workflow: leadWorkflow(lead, now()) } });
      }
      if (body.action === 'create_lead') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const company = typeof body.company === 'string' ? body.company.trim() : '';
        const service = typeof body.service === 'string' ? body.service.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (name.length < 2 || name.length > 100 || !validEmail(email) || company.length > 120 || service.length < 3 || service.length > 120 || message.length < 20 || message.length > 3000) throw new PortalError('Enter a name, valid email, service and project details.');
        if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9-]{16,70}$/.test(body.requestId)) throw new PortalError('Refresh before adding another lead.');
        const id = hash(JSON.stringify([auth.account.id, body.requestId, name, email, company, service, message]));
        const lead = await createLead({ type: 'manual', requestId: `owner-${id}`, name, email, company, service, message }, store, new Date(now()).toISOString());
        return json({ lead: publicLead(lead), message: 'Lead saved. No email was sent; automatic follow-up is paused for manually added leads.' }, 201);
      }
      throw new PortalError('Unknown workspace action.');
    } catch (error) {
      const result = clientError(error);
      if (!(error instanceof PortalError)) console.error('Owner operations failed:', error.name);
      return json({ error: result.error }, result.status);
    }
  };
}
export default createOperationsHandler();
