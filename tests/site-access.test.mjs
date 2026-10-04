import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import session from '../netlify/functions/site-session.mjs';
import checkout from '../netlify/functions/package-checkout.mjs';
import contact from '../netlify/functions/contact-submit.mjs';
import booking from '../netlify/functions/booking-submit.mjs';
import audit from '../netlify/functions/website-audit.mjs';
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
test('guest homepage stays scrollable; a feature click requires login and preserves destination', async()=>{
  const p = await page();
  assert.equal(p.redirects.length,0);
  assert.equal(p.attributes.has('data-access-pending'),false);
  const {event} = p.interact();
  await setImmediate();
  assert.equal(event.prevented,true);
  assert.equal(event.stopped,true);
  assert.equal(p.redirects[0],'/partners.html?next=%2Fquote.html');
});
test('home sections and policies remain available without login',async()=>{
  const p = await page();
  for(const href of ['https://blvckoak.com.au/#services','https://blvckoak.com.au/privacy.html','https://blvckoak.com.au/partners.html']) {
    assert.equal(p.interact({href}).event.prevented,undefined);
  }
});
test('returning home with an existing session allows features without logging in again', async()=>{
  const p = await page({signedIn:true});
  assert.equal(p.interact().event.prevented,undefined);
  assert.deepEqual(p.redirects,[]);
  assert.equal(p.requests[0].options.credentials,'same-origin');
  assert.equal(p.requests[0].options.cache,'no-store');
});
test('direct guest feature visits preserve query and fragment through login',async()=>{
  const p = await page({path:'/contact.html?service=seo#contact-title'});
  assert.equal(p.attributes.has('data-access-pending'),true);
  assert.equal(p.redirects[0],'/partners.html?next=%2Fcontact.html%3Fservice%3Dseo%23contact-title');
});
test('direct signed-in feature visits reveal page without redirect',async()=>{
  const p = await page({signedIn:true,path:'/quote.html'});
  assert.equal(p.attributes.has('data-access-pending'),false);
  assert.deepEqual(p.redirects,[]);
});
test('failed session checks never grant feature access',async()=>{
  const p = await page({networkError:true});
  assert.equal(p.interact().event.prevented,true);
  await setImmediate();
  assert.equal(p.redirects.length,1);
});
test('guest package selection returns to the selected package after login',async()=>{
  const p = await page();
  p.interact({tag:'BUTTON',dataset:{package:'essential'}});
  await setImmediate();
  assert.equal(p.redirects[0],'/partners.html?next=%2F%3Fpackage%3Dessential%23packages');
});
test('feature APIs reject guests before invoking external services or parsing payloads',async()=>{
  for(const handler of [checkout,contact,booking,audit,payment,progress]) {
    const response = await handler(new Request('https://blvckoak.com.au/api/feature',{method:'POST',body:'invalid json'}));
    assert.equal(response.status,401);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal((await session(new Request('https://blvckoak.com.au/.netlify/functions/site-session'))).status,401);
});
test('release verification accepts authentication denial from the protected contact endpoint',async()=>{
  const smoke = await readFile(new URL('../scripts/release-smoke.mjs',import.meta.url),'utf8');
  assert.match(smoke,/check\(base,'\/api\/contact',\[401,403\]\)/);
  assert.doesNotMatch(smoke,/check\(base,'\/api\/contact',\[405\]\)/);
});
