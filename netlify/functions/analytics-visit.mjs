import { createHash, randomBytes } from 'node:crypto';
import { publicFeatureAccess } from '../lib/feature-access.mjs';
import { json } from '../lib/referrals.mjs';
import { clientError, portalStore, readBody } from '../lib/portal-auth.mjs';
import { enforcePublicQuota } from '../lib/public-rate-limit.mjs';

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
    const path=String(body.path||'/').slice(0,160);
    if (!path.startsWith('/') || path.includes('partners') || path.includes('login')) return json({ok:true});
    const raw=String(context?.ip||'').trim();
    const salt=String(process.env.ANALYTICS_SALT||process.env.SITE_URL||'black-oak');
    const visitor=raw?createHash('sha256').update(salt+':'+raw).digest('hex').slice(0,24):null;
    const store=portalStore(); const at=Date.now(); const id=at+'-'+randomBytes(6).toString('hex');
    await store.setJSON('analytics-visit/'+id,{at,path,visitor,referrer:String(body.referrer||'').slice(0,300)});
    return json({ok:true},202);
  } catch { return json({ok:true},202); }
}
