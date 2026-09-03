import { json } from '../lib/referrals.mjs';
import { clientError, hash, portalStore, siteOrigin, tokenPattern } from '../lib/portal-auth.mjs';
import { completeSalesConnection } from '../lib/pay-as-you-sell.mjs';
import { quoteLink } from '../lib/quotes.mjs';

function redirect(location) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

async function quoteReturnForState(state, store, result) {
  if (!tokenPattern.test(state || '')) return `${siteOrigin()}/partners.html`;
  const stateKey = `pay-as-you-sell-oauth/${hash(state)}`;
  const pending = await store.get(stateKey, { type: 'json' });
  if (!pending || pending.expiresAt <= Date.now()) return `${siteOrigin()}/partners.html`;
  const quote = pending?.quoteId ? await store.get(`quote/${pending.quoteId}`, { type: 'json' }) : null;
  await store.delete(stateKey);
  if (!quote) return `${siteOrigin()}/partners.html`;
  const url = new URL(quoteLink(quote)); url.searchParams.set('sales', result); return url.toString();
}

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const store = portalStore();
  const parameters = new URL(request.url).searchParams;
  const state = parameters.get('state') || '';
  try {
    if (parameters.get('error')) return redirect(await quoteReturnForState(state, store, 'cancelled'));
    const quote = await completeSalesConnection(parameters.get('code') || '', state, store);
    const url = new URL(quoteLink(quote)); url.searchParams.set('sales', 'connected'); return redirect(url.toString());
  } catch (error) {
    console.error('Stripe sales connection failed:', error.name);
    const result = clientError(error);
    if (tokenPattern.test(state)) return redirect(await quoteReturnForState(state, store, 'failed'));
    return json({ error: result.error }, result.status);
  }
}
