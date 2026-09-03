import { getStripe, json } from '../lib/referrals.mjs';
import { PortalError, assertSameOrigin, clientError, portalStore, quoteIdPattern, readBody, safeEqual, tokenPattern } from '../lib/portal-auth.mjs';
import { publicQuote } from '../lib/quotes.mjs';
import { openQuoteCheckout, reconcileQuoteCheckout } from '../lib/quote-checkout.mjs';
import { createSalesConnectionUrl, openMaintenanceCheckout, reconcileMaintenanceCheckout, stopCompletedSalesTracking } from '../lib/pay-as-you-sell.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 20 } };

function paymentFailure(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'UnknownError',
    code: typeof error?.code === 'string' ? error.code : undefined,
    type: typeof error?.type === 'string' ? error.type : undefined,
    status: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
  };
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    assertSameOrigin(request);
    const body = await readBody(request, 4096);
    if (!quoteIdPattern.test(body.id || '') || !tokenPattern.test(body.token || '')) throw new PortalError('This private payment link is incomplete.', 404);
    const store = portalStore();
    let quote = await store.get(`quote/${body.id}`, { type: 'json' });
    if (!quote || !safeEqual(body.token, quote.publicToken) || ['pending_approval', 'declined'].includes(quote.status)) throw new PortalError('This payment link is not approved or is unavailable.', 404);
    if (body.action === 'view') {
      if (quote.checkout?.sessionId) {
        try {
          quote = await reconcileQuoteCheckout(quote, getStripe(), store);
        } catch (error) {
          console.error('Custom quote reconciliation delayed:', paymentFailure(error));
        }
      }
      if (quote.maintenance?.checkout?.sessionId) {
        try { quote = await reconcileMaintenanceCheckout(quote, getStripe(), store); }
        catch (error) { console.error('Maintenance reconciliation delayed:', paymentFailure(error)); }
      }
      if (quote.status === 'paid' && quote.paymentPlan?.connectionStatus === 'connected') {
        try { quote = await stopCompletedSalesTracking(quote, getStripe(), store); }
        catch (error) { console.error('Stripe sales tracking disconnect delayed:', paymentFailure(error)); }
      }
      return json({ quote: publicQuote(quote) });
    }
    if (body.action === 'connect_sales_start') return json({ url: await createSalesConnectionUrl(quote, store) });
    if (body.action === 'maintenance_checkout') return json(await openMaintenanceCheckout(quote.id, getStripe(), store));
    if (body.action === 'checkout') return json(await openQuoteCheckout(quote.id, getStripe(), store));
    throw new PortalError('Unknown payment action.');
  } catch (error) {
    console.error('Custom quote payment failed:', paymentFailure(error));
    const result = clientError(error); return json({ error: result.error }, result.status);
  }
}
