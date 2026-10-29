import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { services, serviceById, recommendServices, industries, goals } from '../automation-catalog.js';
import { calculateAutomationEstimate, automationBrief } from '../automation-estimate.js';
import { quoteCatalog } from '../quote-builder.js';
import automationQuote, { prepareAutomationContact } from '../netlify/functions/automation-quote.mjs';

const reference='BOA-1234567890ABCDEF';
const input={services:['receptionist'],industry:'services',goal:'leads',scope:'focused',timing:'flexible',payment:'discuss'};
test('all 78 catalogue services have distinct, complete illustrative examples',()=>{
 assert.equal(services.length,78);assert.equal(serviceById.size,78);
 for(const service of services){assert.ok(service.description.length>35,service.id);assert.equal(service.stages.length,3,service.id);assert.ok(service.stages.every(Boolean));assert.ok(service.input.length>30);assert.ok(service.output.length>30);}
 assert.equal(new Set(services.map(s=>s.input)).size,78);
});
test('guided suggestions exist for every business/goal pair and logistics differs where relevant',()=>{
 for(const industry of Object.keys(industries))for(const goal of Object.keys(goals)){
  const list=recommendServices(industry,goal);assert.equal(list.length,3);assert.equal(new Set(list.map(s=>s.id)).size,3);assert.ok(list.every(s=>serviceById.has(s.id)&&s.reason));
 }
 assert.equal(recommendServices('logistics','team')[0].id,'warehouse');
 assert.deepEqual(recommendServices('not-valid','admin'),[]);
});
test('focused estimate uses existing pricing and deduplicates repeated selections',()=>{
 const estimate=calculateAutomationEstimate({...input,services:['receptionist','follow-up','receptionist']});
 assert.equal(estimate.items.length,2);assert.equal(estimate.subtotal.min,quoteCatalog.services.automation.min*2);assert.equal(estimate.subtotal.max,quoteCatalog.services.automation.max*2);assert.equal(estimate.customCount,0);
});
test('custom builds are never silently included in an apparently complete total',()=>{
 const estimate=calculateAutomationEstimate({...input,services:['receptionist','white-label'],payment:'instalments'});
 assert.equal(estimate.customCount,1);assert.equal(estimate.subtotal.min,800);assert.equal(estimate.items[1].range,null);assert.equal(estimate.instalments,null);
 assert.match(automationBrief(estimate,reference),/subtotal ONLY/);assert.match(automationBrief(estimate,reference),/Full project total is not yet priced/);
 const custom=calculateAutomationEstimate({...input,scope:'complex'});assert.equal(custom.pricedCount,0);assert.equal(custom.subtotal.max,0);
});
test('15-part illustration reconciles exactly to both estimate bounds',()=>{
 const e=calculateAutomationEstimate({...input,payment:'instalments'});
 assert.equal(e.instalments.min.length,15);assert.equal(e.instalments.min.reduce((a,b)=>a+b),80000);assert.equal(e.instalments.max.reduce((a,b)=>a+b),350000);
});
test('invalid service IDs, oversized selections and malformed values fail closed',()=>{
 for(const services of [[],['unknown'],[{}],Array(9).fill('receptionist'),null])assert.throws(()=>calculateAutomationEstimate({...input,services}));
 for(const [key,value] of [['industry','__proto__'],['goal','unknown'],['scope','free'],['timing','today'],['payment',{}]])assert.throws(()=>calculateAutomationEstimate({...input,[key]:value}));
});
test('server constructs authoritative prices and binds request id to enquiry content',()=>{
 const payload={name:'Example Customer',email:'customer@example.test',company:'Example',requestId:'1234567890ABCDEF1234',reference,selection:input,acceptedPrivacy:true,message:'tampered free quote',estimate:{subtotal:{min:0,max:0}}};
 const contact=prepareAutomationContact(payload);assert.equal(contact.service,'workflow-ai');assert.match(contact.message,/A\$800–A\$3,500/);assert.doesNotMatch(contact.message,/tampered/);
 assert.equal(contact.requestId,prepareAutomationContact(payload).requestId);
 assert.notEqual(contact.requestId,prepareAutomationContact({...payload,selection:{...input,notes:'Updated requirements'}}).requestId);
 assert.equal(contact.acceptedPrivacy,true);
 assert.throws(()=>prepareAutomationContact({...payload,reference:'bad'}));
});
test('maximum supported brief fits existing enquiry storage without truncation',()=>{
 const ids=[...services].sort((a,b)=>b.title.length-a.title.length).slice(0,8).map(s=>s.id);
 const e=calculateAutomationEstimate({...input,services:ids,tools:'x'.repeat(160),notes:'y'.repeat(400),payment:'instalments'});
 assert.ok(automationBrief(e,reference).length<=3000);
});
test('quote endpoint rejects unsupported methods, cross-origin, non-JSON and invalid selections without sending',async()=>{
 const previous=process.env.SITE_URL;process.env.SITE_URL='https://blackoak.example';
 try {
  assert.equal((await automationQuote(new Request('https://blackoak.example/api/automation-quote'))).status,405);
  const post=(body,headers={})=>new Request('https://blackoak.example/api/automation-quote',{method:'POST',headers:{origin:'https://blackoak.example','content-type':'application/json',...headers},body});
  assert.equal((await automationQuote(post('{}',{origin:'https://attacker.example'}))).status,403);
  assert.equal((await automationQuote(post('{}',{'content-type':'text/plain'}))).status,415);
  assert.equal((await automationQuote(post('{'))).status,400);
  assert.equal((await automationQuote(post(JSON.stringify({requestId:'1234567890ABCDEF1234',reference,selection:{...input,services:['unknown']}})))).status,400);
  const consent=await automationQuote(post(JSON.stringify({name:'Example Customer',email:'customer@example.test',requestId:'1234567890ABCDEF1234',reference,selection:input,acceptedPrivacy:false})),{deploy:{context:'deploy-preview'}});
  assert.equal(consent.status,400);assert.match((await consent.json()).error,/privacy/);
 } finally {if(previous===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=previous;}
});
test('published route is public and discoverable from main navigation, build and sitemap',async()=>{
 const [access,home,build,sitemap]=await Promise.all(['site-access.js','index.html','scripts/build.mjs','sitemap.xml'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
 assert.match(access,/'\/automation', '\/automation.html'/);assert.match(home,/href="automation.html"/);assert.match(build,/buildAutomation\(output\)/);assert.match(sitemap,/https:\/\/blvckoak.com.au\/automation.html/);
});
