import { categories, goals } from './automation-catalog.js';
import { quoteCatalog } from './quote-builder.js';
import { moneyRange } from './automation-estimate.js';
export const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function serviceCard(service, selected=false) {
 const category=categories.find(item=>item.id===service.category);
 return `<article class="service-card" data-service-card="${service.id}"><div class="card-top"><span class="service-symbol" aria-hidden="true">${category.symbol}</span><span class="scope-label">${category.short.toUpperCase()} / ${service.scope==='platform'?'CUSTOM BUILD':'WORKFLOW'}</span></div><h3>${escape(service.title)}</h3><p class="description">${escape(service.description)}</p><p class="card-price">${service.scope==='platform'?'Scoped quote':moneyRange(quoteCatalog.services.automation)}<small>${service.scope==='platform'?'Complexity and requirements confirmed first':'Indicative setup · final scope confirmed first'}</small></p><div class="card-actions"><button class="example-link" type="button" data-example="${service.id}" aria-label="See example: ${escape(service.title)}">See how it works ↗</button><button class="add-service" type="button" data-add="${service.id}" aria-label="${selected?'Remove':'Add'} ${escape(service.title)} ${selected?'from':'to'} quote" aria-pressed="${selected}">${selected?'Added ✓':'Add +'}</button></div></article>`;
}
export function goalOptions() {
 return Object.entries(goals).map(([id,goal],i)=>`<label class="goal-card"><input type="radio" name="goal" value="${id}" ${i===0?'checked':''}><span><strong>${escape(goal.label)}</strong><small>${escape(goal.description)}</small></span></label>`).join('\n');
}
