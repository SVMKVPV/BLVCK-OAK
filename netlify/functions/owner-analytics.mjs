import { json, runtimeEnv } from '../lib/referrals.mjs';
import { clientError, portalStore, requireAccount } from '../lib/portal-auth.mjs';

const AUD = 'aud';
const moneyTypes = new Set(['charge','payment','refund','payment_refund','payment_reversal','stripe_fee','stripe_fx_fee','tax_fee']);

function startOfDay(days) {
  const d = new Date();
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() - Math.max(0, Number(days) || 0));
  return Math.floor(d.getTime()/1000);
}

async function listAll(resource, params = {}, maxPages = 25) {
  const rows = [];
  let starting_after;
  for (let page=0; page<maxPages; page+=1) {
    const result = await resource.list({ limit:100, ...params, ...(starting_after ? {starting_after}: {}) });
    rows.push(...result.data);
    if (!result.has_more || !result.data.length) break;
    starting_after = result.data.at(-1).id;
  }
  return rows;
}

function normaliseEmail(value) { return String(value || '').trim().toLowerCase(); }

async function accountRows(store) {
  const { blobs } = await store.list({ prefix:'account/' });
  return (await Promise.all(blobs.slice(0,1000).map(({key})=>store.get(key,{type:'json'})))).filter(Boolean);
}

async function visitSummary(store, since) {
  const { blobs } = await store.list({ prefix:'analytics-visit/' });
  const rows = (await Promise.all(blobs.slice(-5000).map(({key})=>store.get(key,{type:'json'})))).filter(Boolean);
  const recent = rows.filter(v => Number(v.at || 0) >= since*1000);
  return {
    views: recent.length,
    uniqueVisitors: new Set(recent.map(v=>v.visitor).filter(Boolean)).size,
    topPages: Object.entries(recent.reduce((a,v)=>{const p=String(v.path||'/').slice(0,160);a[p]=(a[p]||0)+1;return a;},{})).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([path,views])=>({path,views}))
  };
}

export default async function handler(request) {
  try {
    if (request.method !== 'GET') return json({error:'Method not allowed.'},405);
    const store = portalStore();
    const auth = await requireAccount(request, store);
    if (!auth.isOwner) return json({error:'Owner analytics only.'},403);

    const url = new URL(request.url);
    const days = Math.min(3650, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const query = normaliseEmail(url.searchParams.get('q'));
    const since = startOfDay(days);
    const accounts = await accountRows(store);

    const key = runtimeEnv('STRIPE_ANALYTICS_KEY') || runtimeEnv('STRIPE_SECRET_KEY');
    if (!key) return json({error:'Revenue analytics is not configured.'},503);
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    const sessions = await listAll(stripe.checkout.sessions,{created:{gte:since},expand:['data.customer']});
    const blackOak = sessions.filter(s => s.status === 'complete' && s.payment_status === 'paid' && (s.metadata?.checkout_version === 'black_oak_v2' || s.metadata?.quote_id || s.metadata?.package_id));
    const transactions = await listAll(stripe.balanceTransactions,{created:{gte:since},currency:AUD});
    const tx = transactions.filter(t=>moneyTypes.has(t.type));
    const fees = tx.reduce((n,t)=>n+(Number(t.fee)||0),0);
    const net = tx.reduce((n,t)=>n+(Number(t.net)||0),0);
    const gross = blackOak.reduce((n,s)=>n+(Number(s.amount_total)||0),0);
    const refunded = blackOak.reduce((n,s)=>n+(Number(s.amount_total)||0)-(Number(s.amount_subtotal)||0),0); // informational; authoritative refunds below where available
    const taxCollected = blackOak.reduce((n,s)=>n+(Number(s.total_details?.amount_tax)||0),0);

    const byEmail = new Map();
    for (const a of accounts) byEmail.set(normaliseEmail(a.email), {email:a.email,name:a.name||'',signedUpAt:a.createdAt||a.verifiedAt||null,revenueCents:0,payments:0});
    for (const s of blackOak) {
      const email = normaliseEmail(s.customer_details?.email || s.customer?.email || s.customer_email);
      if (!email) continue;
      const row = byEmail.get(email) || {email,name:'Stripe customer',signedUpAt:null,revenueCents:0,payments:0};
      row.revenueCents += Number(s.amount_total)||0; row.payments += 1; byEmail.set(email,row);
    }
    let customers=[...byEmail.values()].sort((a,b)=>b.revenueCents-a.revenueCents);
    if (query) customers=customers.filter(c=>normaliseEmail(c.email).includes(query)||String(c.name).toLowerCase().includes(query));

    const visits = await visitSummary(store,since);
    return json({
      periodDays:days,
      generatedAt:new Date().toISOString(),
      traffic:visits,
      finance:{grossRevenueCents:gross,stripeFeesCents:fees,netBalanceActivityCents:net,taxCollectedCents:taxCollected,estimatedGstComponentCents: taxCollected || Math.round(gross/11),taxEstimateMethod:taxCollected?'Stripe tax actually collected in matching checkout sessions':'Simple 1/11 GST component estimate on gross sales; not tax payable',refundDisplayCents:Math.max(0,refunded)},
      accounts:{total:accounts.length,matching:customers.length,rows:customers.slice(0,250)},
      notes:['Tax payable depends on GST registration, taxable sales, GST-free/input-taxed supplies, credits, refunds and your BAS. This dashboard is an estimate only.','Revenue is limited to paid Black Oak checkout sessions identified by Black Oak metadata.']
    });
  } catch(error) {
    console.error('Owner analytics failed:',error.name);
    const result=clientError(error); return json({error:result.error},result.status);
  }
}
