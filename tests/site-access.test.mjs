import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import session from '../netlify/functions/site-session.mjs';
import checkout, { config as checkoutConfig } from '../netlify/functions/package-checkout.mjs';
import contact from '../netlify/functions/contact-submit.mjs';
import booking from '../netlify/functions/booking-submit.mjs';
import audit, { config as auditConfig } from '../netlify/functions/website-audit.mjs';
import payment from '../netlify/functions/quote-payment.mjs';
import progress from '../netlify/functions/project-progress.mjs';
const source = await readFile(new URL('../site-access.js', import.meta.url), 'utf8');
async function page({signedIn = false, path = '/', networkError = false} = {}) {
  const handlers = new Map(), redirects = [], attributes = new Map(), requests = [];
  const location = new URL('https://blvckoak.com.au' + path);
  location.assign = value => redirects.push(value);
  const root = {dataset: {}, setAttribute: (k,v) => attributes.set(k,v), removeAttribute: k => attributes.delete(k)};
  const document = {documentElement:root, querySelectorAll:()=>[], addEventListener:(type,fn)=>handlers.set(type,fn)};
  const window = {addEventListener:()=>{}};
  runInNewContext(source, {window, document, location, URL, sessionStorage:{setItem(){},getItem(){return null;},removeItem(){}}, fetch:async (url, options)=>{
    requests.push({url,options});
    if(networkError) throw new Error('Offline');
    return {status:signedIn?200:401,ok:signedIn,json:async()=>({authenticated:signedIn})};
  }});
  await setImmediate();
  function interact({tag = 'A', href = 'https://blvckoak.com.au/quote.html', type = 'click', dataset = {}} = {}) {
    const control = {tagName:tag,href,dataset,closest:()=>null,matches:()=>false,click(){this.clicked=true;}};
    const event = {type,target:{closest:()=>control},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    handlers.get(type)(event);
    return {event, control};
  }
  return {redirects, attributes, requests, interact, window};
}
test('guest homepage controls and package selection work without a login redirect', async()=>{
  const p = await page();
  assert.equal(p.redirects.length,0);
  assert.equal(p.attributes.has('data-access-pending'),false);
  assert.equal(p.interact({tag:'BUTTON',dataset:{detail:'goal-launch'}}).event.prevented,undefined);
  assert.equal(p.interact({tag:'BUTTON',dataset:{package:'essential'}}).event.prevented,undefined);
  assert.equal(p.interact({href:'https://blvckoak.com.au/quote.html'}).event.prevented,undefined);
  assert.deepEqual(p.redirects,[]);
});
test('customer-facing acquisition pages and previews are browsable by guests',async()=>{
  for (const path of [
    '/portfolio.html', '/marketplace', '/audit.html', '/quote',
    '/websites-near-me-sydney', '/websites-near-me-sydney.html',
    '/ai-generator.html', '/contact.html?service=seo#contact-title', '/book',
    '/nearby.html', '/previews/wedding-invitation.html',
  ]) {
    const p = await page({path});
    assert.equal(p.attributes.has('data-access-pending'),false, path);
    assert.deepEqual(p.redirects,[], path);
    assert.equal(p.interact({tag:'BUTTON'}).event.prevented,undefined, path);
  }
});
test('public pages still check an existing session without requiring it', async()=>{
  const p = await page({signedIn:true});
  assert.equal(p.interact().event.prevented,undefined);
  assert.deepEqual(p.redirects,[]);
  assert.equal(p.requests[0].options.credentials,'same-origin');
  assert.equal(p.requests[0].options.cache,'no-store');
});
test('direct guest visits to private payment and progress pages preserve their destination through login',async()=>{
  const p = await page({path:'/pay.html?id=abc#payment'});
  assert.equal(p.attributes.has('data-access-pending'),true);
  assert.equal(p.redirects[0],'/partners.html?next=%2Fpay.html%3Fid%3Dabc%23payment');
  const progressPage = await page({path:'/progress.html?id=abc'});
  assert.equal(progressPage.attributes.has('data-access-pending'),true);
  assert.equal(progressPage.redirects[0],'/partners.html?next=%2Fprogress.html%3Fid%3Dabc');
});
test('direct signed-in visits reveal protected pages without redirect',async()=>{
  const p = await page({signedIn:true,path:'/pay.html'});
  assert.equal(p.attributes.has('data-access-pending'),false);
  assert.deepEqual(p.redirects,[]);
});
test('failed session checks never grant protected-page access',async()=>{
  const p = await page({path:'/progress.html',networkError:true});
  assert.equal(p.attributes.has('data-access-pending'),true);
  assert.equal(p.redirects[0],'/partners.html?next=%2Fprogress.html');
});
test('partner login stays public but links to private client pages remain gated',async()=>{
  const p = await page({path:'/partners.html'});
  assert.deepEqual(p.redirects,[]);
  const {event} = p.interact({href:'https://blvckoak.com.au/pay.html?id=abc'});
  await setImmediate();
  assert.equal(event.prevented,true);
  assert.equal(p.redirects[0],'/partners.html?next=%2Fpay.html%3Fid%3Dabc');
});

const publicHandlers = [
  ['package checkout', checkout],
  ['contact', contact],
  ['booking', booking],
  ['website audit', audit],
];
const previewContext = { deploy: { context: 'deploy-preview' } };
const publicPost = (origin, body = {}) => new Request('https://blvckoak.com.au/api/feature', {
  method:'POST',
  headers:{origin,'content-type':'application/json'},
  body:JSON.stringify(body),
});

test('public acquisition APIs accept guest requests from the same site and retain validation',async()=>{
  for (const [name, handler] of publicHandlers) {
    const response = await handler(publicPost('https://blvckoak.com.au'), previewContext);
    assert.equal(response.status,400,name);
    assert.equal(response.headers.get('cache-control'),'no-store',name);
  }
});
test('public acquisition APIs reject cross-origin writes before parsing or external work',async()=>{
  const oldSite = process.env.SITE_URL;
  process.env.SITE_URL = 'https://blvckoak.com.au';
  try {
    for (const [name, handler] of publicHandlers) {
      const response = await handler(publicPost('https://attacker.example'));
      assert.equal(response.status,403,name);
      assert.match((await response.json()).error,/must come from the Black Oak website/i,name);
    }
  } finally {
    if (oldSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = oldSite;
  }
});
test('expensive public acquisition APIs retain valid Netlify rate limits',()=>{
  assert.ok(checkoutConfig.path.includes('/api/checkout/package'));
  assert.equal(checkoutConfig.rateLimit.windowLimit,12);
  assert.ok(auditConfig.path.includes('/api/website-audit'));
  assert.equal(auditConfig.rateLimit.windowSize,180);
  assert.equal(auditConfig.rateLimit.windowLimit,5);
});
test('private quote, progress and session APIs still reject guests',async()=>{
  for(const [name,handler] of [['quote payment',payment],['project progress',progress]]) {
    const response = await handler(new Request('https://blvckoak.com.au/api/private',{method:'POST',body:'invalid json'}));
    assert.equal(response.status,401,name);
    assert.equal(response.headers.get('cache-control'),'no-store',name);
  }
  assert.equal((await session(new Request('https://blvckoak.com.au/.netlify/functions/site-session'))).status,401);
});
test('partner API keeps account and CSRF enforcement',async()=>{
  const partnerSource = await readFile(new URL('../netlify/functions/partner-api.mjs',import.meta.url),'utf8');
  assert.match(partnerSource,/await requireAccount\(request, store\)/);
  assert.match(partnerSource,/assertCsrf\(request, auth\)/);
});
test('release verification probes the public contact route without creating a lead',async()=>{
  const smoke = await readFile(new URL('../scripts/release-smoke.mjs',import.meta.url),'utf8');
  assert.match(smoke,/check\(base,'\/api\/contact',\[405\]\)/);
  assert.doesNotMatch(smoke,/check\(base,'\/api\/contact',\[401,403\]\)/);
});
test('community browsing and its public acquisition links stay public',async()=>{
 for(const path of ['/community.html','/community','/community/forma-habitat/','/community/forma-habitat/index.html']) {
  const p=await page({path});assert.deepEqual(p.redirects,[]);assert.equal(p.attributes.has('data-access-pending'),false);
  assert.equal(p.interact({href:'https://blvckoak.com.au/community/moss-and-mortar/'}).event.prevented,undefined);
  assert.equal(p.interact({href:'https://blvckoak.com.au/contact.html'}).event.prevented,undefined);
 }
});
