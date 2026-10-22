import { createHash, randomBytes } from 'node:crypto';
import { publicFeatureAccess } from '../lib/feature-access.mjs';
import { json } from '../lib/referrals.mjs';
import { clientError, portalStore, readBody } from '../lib/portal-auth.mjs';
import { enforcePublicQuota } from '../lib/public-rate-limit.mjs';
import { ANALYTICS_EVENTS, coarseTechnology, publicAnalyticsPath } from '../lib/site-analytics.mjs';

export default async function handler(request, context) {
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  const denied = publicFeatureAccess(request);
  if (denied) return denied;
  const limited = await enforcePublicQuota('analytics', context);
  if (limited) return limited;

  let body;
  try {
    body = await readBody(request, 2048);
  } catch (error) {
    const result = clientError(error);
    return json({ error: result.error }, result.status);
  }

  try {
    const path = publicAnalyticsPath(body.path);
    const event = String(body.event || 'page_view');
    if (!path || !ANALYTICS_EVENTS.has(event)) return json({ok:true});
    const technology = coarseTechnology(request.headers.get('user-agent') || '');
    if (technology.bot || request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return json({ok:true});
    const raw=String(context?.ip||'').trim();
    const salt=String(process.env.ANALYTICS_SALT||process.env.SITE_URL||'black-oak');
    const visitor=raw?createHash('sha256').update(salt+':'+raw).digest('hex').slice(0,24):null;
    const origin = new URL(request.url).origin;
    let source = 'Direct / unknown';
    try {
      const ref = new URL(String(body.referrer || '').slice(0,300));
      if (ref.protocol === 'https:' || ref.protocol === 'http:') {
        if (ref.host !== new URL(origin).host) source = ref.hostname.slice(0,100);
        else source = 'Internal navigation';
      }
    } catch {}
    const campaign = {};
    for (const key of ['utm_source','utm_medium','utm_campaign','ref']) {
      const supplied = String(body[key] || '').trim();
      if (/@|:\/\/|%40/i.test(supplied)) continue;
      const value = supplied.replace(/[^a-zA-Z0-9 _.-]/g,'').slice(0,80);
      if (value) campaign[key] = value;
    }
    const geo = context?.geo || {};
    const country = String(geo.country?.name || geo.country?.code || 'Unknown').slice(0,80);
    const city = String(geo.city || 'Unknown').slice(0,80);
    const store=portalStore(); const at=Date.now(); const id=at+'-'+randomBytes(6).toString('hex');
    await store.setJSON('analytics-visit/'+id,{at,path,event,visitor,source,campaign,country,city,device:technology.device,browser:technology.browser});
    return json({ok:true},202);
  } catch { return json({ok:true},202); }
}
