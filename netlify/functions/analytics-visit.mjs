import { createHash, randomBytes } from 'node:crypto';
import { json } from '../lib/referrals.mjs';
import { portalStore } from '../lib/portal-auth.mjs';

export default async function handler(request) {
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  try {
    const body=await request.json().catch(()=>({}));
    const path=String(body.path||'/').slice(0,160);
    if (!path.startsWith('/') || path.includes('partners') || path.includes('login')) return json({ok:true});
    const raw=String(request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim();
    const salt=String(process.env.ANALYTICS_SALT||process.env.SITE_URL||'black-oak');
    const visitor=raw?createHash('sha256').update(salt+':'+raw).digest('hex').slice(0,24):null;
    const store=portalStore(); const at=Date.now(); const id=at+'-'+randomBytes(6).toString('hex');
    await store.setJSON('analytics-visit/'+id,{at,path,visitor,referrer:String(body.referrer||'').slice(0,300)});
    return json({ok:true},202);
  } catch { return json({ok:true},202); }
}
