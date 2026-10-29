import { serviceById, industries, goals } from './automation-catalog.js';
import { quoteCatalog, splitInstalmentAmounts } from './quote-builder.js';
export const MAX_SELECTION = 8;
export const timings = Object.freeze({exploring:'Still exploring', flexible:'Flexible timing', month:'Ideally within one month', urgent:'Urgent — feasibility to confirm'});
export const paymentOptions = Object.freeze({discuss:'Discuss the best option', staged:'Deposit / staged payments', instalments:'Ask about 15-part payments'});
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
export function calculateAutomationEstimate(input = {}) {
 if (!Array.isArray(input.services) || input.services.length > MAX_SELECTION || !input.services.length) throw new Error(`Choose between 1 and ${MAX_SELECTION} services for this quote.`);
 const ids = [...new Set(input.services)];
 if (ids.some(id => typeof id !== 'string' || !serviceById.has(id))) throw new Error('One of your selected services is no longer available. Please refresh and choose again.');
 const industry = input.industry || 'other', goal = input.goal || 'admin', timing = input.timing || 'exploring', payment = input.payment || 'discuss';
 for (const [value, catalog] of [[industry,industries],[goal,goals],[timing,timings],[payment,paymentOptions]]) {
   if (typeof value !== 'string' || !Object.hasOwn(catalog,value)) throw new Error('Choose valid project details.');
 }
 const scope = input.scope || 'focused';
 if (!['focused','complex'].includes(scope)) throw new Error('Choose a valid project complexity.');
 const items = ids.map(id => {
   const service=serviceById.get(id);
   const custom = scope === 'complex' || service.scope === 'platform';
   return {id,title:service.title,custom,range: custom ? null : {min:quoteCatalog.services.automation.min,max:quoteCatalog.services.automation.max}};
 });
 const priced = items.filter(item => !item.custom);
 const subtotal = priced.reduce((sum,item) => ({min:sum.min+item.range.min,max:sum.max+item.range.max}),{min:0,max:0});
 const customCount = items.length-priced.length;
 return {items,subtotal,customCount,pricedCount:priced.length,industry,goal,timing,payment,scope,tools:clean(input.tools,160),notes:clean(input.notes,400),
   instalments: payment==='instalments' && !customCount && subtotal.max ? {
     min:splitInstalmentAmounts(subtotal.min*100),max:splitInstalmentAmounts(subtotal.max*100)
   }:null};
}
export const money = value => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(value).replace('$','A$');
export const moneyRange = range => `${money(range.min)}–${money(range.max)}`;
export function automationBrief(estimate, reference) {
 const e=estimate;
 return [
 'BLVCK OAK — AUTOMATION QUOTE REQUEST', `Reference: ${reference}`, 'Indicative planning estimate, not a final quote or offer.',
 ...e.items.map((item,i)=>`${i+1}. ${item.title}: ${item.custom?'Custom scope — price to confirm':moneyRange(item.range)}`),
 e.pricedCount ? `${e.customCount?'Priced workflows subtotal ONLY':'Indicative implementation total'}: ${moneyRange(e.subtotal)} AUD.` : 'All selected work requires a scoped quote.',
 ...(e.customCount?[`${e.customCount} custom item(s) NOT included in the subtotal. Full project total is not yet priced.`]:[]),
 `Business type: ${industries[e.industry]}. Goal: ${goals[e.goal].label}.`,
 `Timing: ${timings[e.timing]}. Payment: ${paymentOptions[e.payment]}.`,
 `Complexity: ${e.scope==='complex'?'Multiple systems, migration or custom requirements':'Focused workflows using supported tools'}.`,
 `Existing tools: ${e.tools||'To confirm'}.`,
 `Other requirements: ${e.notes||'None supplied'}`,
 ...(e.instalments?[`15-part illustration: A$${(e.instalments.min[14]/100).toFixed(2)}–A$${(e.instalments.max[0]/100).toFixed(2)} per part. Subject to final price and payment agreement.`]:[]),
 'Assumption: each priced line is a separate focused workflow using the existing A$800–A$3,500 workflow range. Shared work, existing package inclusions and complex integrations are reviewed before a final quote.',
 'Hosting, software subscriptions, AI, SMS/call usage, advertising and ongoing support are excluded and quoted separately. GST treatment and delivery dates are confirmed in writing. No payment is collected here.'
 ].join('\n');
}
