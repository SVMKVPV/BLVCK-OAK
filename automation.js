import { services, serviceById, categories, goals, industries, recommendServices } from './automation-catalog.js';
import { calculateAutomationEstimate, automationBrief, moneyRange, MAX_SELECTION, timings, paymentOptions } from './automation-estimate.js';
import { quoteCatalog } from './quote-builder.js';
import { serviceCard, goalOptions, escape } from './automation-render.js';

const $=selector=>document.querySelector(selector);
const selected=new Set();
let visibleCount=9, currentService=null, demoStep=0, snapshot=null, sending=false, toastTimer;
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const goTo=node=>{node.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});};
function announce(message){clearTimeout(toastTimer);$('#toast').textContent=message;toastTimer=setTimeout(()=>{$('#toast').textContent='';},4500);}
function setStatus(node,message,error=false){node.textContent=message;node.classList.toggle('error',error);}
const finder=$('#finder-form'), estimateForm=$('#estimate-form'), enquiry=$('#quote-enquiry'), dialog=$('#service-dialog');
if(!$('#goal-options').querySelector('input')) $('#goal-options').innerHTML=goalOptions();
if($('#service-category').options.length===1) categories.forEach(category=>{const option=document.createElement('option');option.value=category.id;option.textContent=category.name;$('#service-category').append(option);});

function renderCatalogue(){
 const query=$('#service-search').value.trim().toLowerCase(), category=$('#service-category').value;
 const filtered=services.filter(service=>(category==='all'||service.category===category)&&`${service.title} ${service.description} ${service.input} ${categories.find(c=>c.id===service.category).name}`.toLowerCase().includes(query));
 $('#service-grid').innerHTML=filtered.slice(0,visibleCount).map(service=>serviceCard(service,selected.has(service.id))).join('');
 $('#result-count').textContent=`Showing ${Math.min(visibleCount,filtered.length)} of ${filtered.length} services`;
 $('#empty-state').hidden=filtered.length>0;$('#show-more').hidden=filtered.length<=visibleCount;
 $('#show-more').textContent=`Show more services (${Math.max(0,filtered.length-visibleCount)} remaining) ↓`;
}
function invalidateEstimate(){snapshot=null;$('#quote-result').hidden=true;setStatus($('#estimate-status'),'');}
function updateShortlist(){
 document.querySelectorAll('[data-selection-count]').forEach(node=>{node.textContent=selected.size;});
 $('#selection-bar').hidden=!selected.size;
 document.querySelectorAll('[data-add]').forEach(button=>{const active=selected.has(button.dataset.add);button.setAttribute('aria-pressed',String(active));button.textContent=active?'Added ✓':'Add +';button.setAttribute('aria-label',`${active?'Remove':'Add'} ${serviceById.get(button.dataset.add).title} ${active?'from':'to'} quote`);});
 const complex=estimateForm.elements.scope.value==='complex';
 $('#selected-services').innerHTML=selected.size?[...selected].map(id=>{const service=serviceById.get(id);return `<div class="selected-row"><div><strong>${escape(service.title)}</strong><small>${complex||service.scope==='platform'?'Scoped quote required':moneyRange(quoteCatalog.services.automation)+' · indicative setup'}</small></div><button class="remove-service" type="button" data-remove="${id}" aria-label="Remove ${escape(service.title)} from quote">×</button></div>`;}).join(''):'<p class="selection-empty">Your shortlist starts here. <a href="#services">Explore services ↑</a> or <a href="#finder">get a recommendation ↑</a>.</p>';
 if(currentService) updateDialogButton();
}
function toggleService(id,removeOnly=false){
 if(sending){announce('Please wait for your quote request to finish sending.');return;}
 if(!serviceById.has(id))return;
 const removing=selected.has(id);
 if(removing) selected.delete(id);
 else if(!removeOnly){if(selected.size>=MAX_SELECTION){announce(`Choose up to ${MAX_SELECTION} services. Remove one to add another.`);return;}selected.add(id);}
 invalidateEstimate();updateShortlist();announce(`${serviceById.get(id).title} ${removing?'removed from':'added to'} your quote.`);
}
document.addEventListener('click',event=>{
 const example=event.target.closest('[data-example]');if(example)openExample(example.dataset.example);
 const add=event.target.closest('[data-add]');if(add)toggleService(add.dataset.add);
 const remove=event.target.closest('[data-remove]');if(remove){const index=[...selected].indexOf(remove.dataset.remove);toggleService(remove.dataset.remove,true);const controls=$('#selected-services').querySelectorAll('[data-remove]');(controls[Math.min(index,controls.length-1)]||$('#selected-services').querySelector('a'))?.focus();}
});
$('#service-search').addEventListener('input',()=>{visibleCount=9;renderCatalogue();});
$('#service-category').addEventListener('change',()=>{visibleCount=9;renderCatalogue();});
$('#show-more').addEventListener('click',()=>{const old=visibleCount;visibleCount+=9;renderCatalogue();$('#service-grid').children[old]?.querySelector('[data-example]')?.focus({preventScroll:true});});
$('#reset-search').addEventListener('click',()=>{$('#service-search').value='';$('#service-category').value='all';visibleCount=9;renderCatalogue();$('#service-search').focus();});
finder.addEventListener('submit',event=>{
 event.preventDefault();const industry=finder.elements.industry.value,goal=finder.elements.goal.value;
 const recommendations=recommendServices(industry,goal);
 $('#recommendation-list').innerHTML=recommendations.map(service=>serviceCard(service,selected.has(service.id))).join('');
 $('#recommendation-reason').textContent=`Suggested for ${industries[industry].toLowerCase()} businesses that want to ${goals[goal].label.toLowerCase()}. Start with one, or choose a combination.`;
 $('#recommendations').hidden=false;goTo($('#recommendations'));$('#recommendation-title').focus({preventScroll:true});
});
finder.addEventListener('change',()=>{invalidateEstimate();$('#recommendations').hidden=true;});
estimateForm.addEventListener('input',invalidateEstimate);
estimateForm.addEventListener('change',()=>{invalidateEstimate();updateShortlist();});
function updateDialogButton(){const active=selected.has(currentService.id);$('#dialog-add').textContent=active?'Remove from my quote −':'Add to my quote +';$('#dialog-add').setAttribute('aria-pressed',String(active));}
function openExample(id){
 currentService=serviceById.get(id);if(!currentService)return;demoStep=0;
 $('#dialog-category').textContent=categories.find(c=>c.id===currentService.category).name.toUpperCase();
 $('#dialog-title').textContent=currentService.title;$('#dialog-description').textContent=currentService.description;
 $('#example-input').textContent=currentService.input;
 $('#demo-steps').innerHTML=currentService.stages.map(stage=>`<li>${escape(stage)}</li>`).join('');
 $('#demo-output').hidden=true;$('#example-output').textContent=currentService.output;
 $('#demo-status').textContent='Walk through the example to see what happens at each step.';
 $('#run-example').textContent='Run example ▷';
 $('#dialog-price').textContent=currentService.scope==='platform'?'Custom scoped quote':moneyRange(quoteCatalog.services.automation);
 $('#dialog-pricing-note').textContent=currentService.scope==='platform'?'A full application or specialist system needs discovery. Its price is not included in an instant subtotal.':'Indicative one-off setup for a focused workflow. Final scope, overlap and provider costs are reviewed before quoting.';
 updateDialogButton();dialog.showModal();dialog.scrollTop=0;
}
$('#close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
$('#run-example').addEventListener('click',()=>{
 if(demoStep===3){demoStep=0;$('#demo-output').hidden=true;}
 demoStep++;
 [...$('#demo-steps').children].forEach((node,index)=>{node.classList.toggle('active',index<demoStep);});
 $('#demo-status').textContent=`Step ${demoStep} of 3: ${currentService.stages[demoStep-1]}. ${demoStep===3?'Example complete. No real action was taken.':''}`;
 if(demoStep===3)$('#demo-output').hidden=false;
 $('#run-example').textContent=demoStep===3?'Replay example ↻':`Continue to step ${demoStep+1} →`;
});
$('#dialog-add').addEventListener('click',()=>toggleService(currentService.id));
$('#dialog-to-quote').addEventListener('click',()=>{dialog.close();goTo($('#quote'));});

function currentSelection(){const data=new FormData(estimateForm);return {services:[...selected],industry:finder.elements.industry.value,goal:finder.elements.goal.value,scope:data.get('scope'),tools:data.get('tools'),timing:data.get('timing'),payment:data.get('payment'),notes:data.get('notes')};}
function reference(){const bytes=crypto.getRandomValues(new Uint8Array(8));return 'BOA-'+[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();}
estimateForm.addEventListener('submit',event=>{
 event.preventDefault();if(sending)return;
 try{
  const selection=currentSelection(),estimate=calculateAutomationEstimate(selection),ref=reference();
  snapshot={selection,estimate,reference:ref,requestId:'automation-'+reference()};
  $('#quote-reference').textContent=ref;$('#quote-date').textContent=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium'}).format(new Date());
  $('#quote-context').textContent=`${industries[estimate.industry]} · ${goals[estimate.goal].label}. ${timings[estimate.timing]}. ${paymentOptions[estimate.payment]}.`;
  $('#quote-lines').innerHTML=estimate.items.map(item=>`<div class="quote-line"><div>${escape(item.title)}<small>${item.custom?'Custom scope · excluded from any instant subtotal':'Focused workflow · indicative one-off setup'}</small></div><strong>${item.custom?'Price to confirm':moneyRange(item.range)}</strong></div>`).join('');
  $('#total-label').textContent=estimate.customCount?'Priced workflows subtotal only':'Indicative implementation total';
  $('#quote-total').textContent=estimate.pricedCount?moneyRange(estimate.subtotal):'Scoped quote required';
  $('#custom-note').textContent=estimate.customCount?`${estimate.customCount} custom ${estimate.customCount===1?'item needs':'items need'} a separate scoped price. The full project total is not yet priced.`:'AUD · final scope and price confirmed before work begins.';
  $('#payment-note').hidden=estimate.payment!=='instalments';
  $('#payment-note').textContent=estimate.instalments?`15-part illustration: A$${(estimate.instalments.min[14]/100).toFixed(2)}–A$${(estimate.instalments.max[0]/100).toFixed(2)} per part. The full implementation estimate is ${moneyRange(estimate.subtotal)}. Availability and schedule are agreed in your final quote; ongoing costs are separate.`:'You requested a 15-part plan. Amounts can be calculated once the custom scope and full project price are confirmed.';
  setStatus($('#estimate-status'),'');setStatus($('#enquiry-status'),'');$('#enquiry-fields').disabled=false;
  $('#quote-result').hidden=false;goTo($('#quote-result'));$('#result-title').focus({preventScroll:true});
 }catch(error){setStatus($('#estimate-status'),error.message,true);}
});
$('#print-quote').addEventListener('click',()=>{if(snapshot)window.print();});
$('#download-brief').addEventListener('click',()=>{
 if(!snapshot)return;
 const blob=new Blob([automationBrief(snapshot.estimate,snapshot.reference)],{type:'text/plain;charset=utf-8'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=snapshot.reference+'-automation-brief.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
enquiry.addEventListener('submit',async event=>{
 event.preventDefault();if(sending||!snapshot||!enquiry.reportValidity())return;
 const data=new FormData(enquiry),status=$('#enquiry-status'),payload={...snapshot,name:data.get('name'),email:data.get('email'),company:data.get('company'),website:data.get('website'),acceptedPrivacy:data.get('privacy')==='on'};
 delete payload.estimate;
 sending=true;$('#enquiry-fields').disabled=true;estimateForm.querySelectorAll('fieldset,button[type=submit]').forEach(control=>{control.disabled=true;});finder.querySelectorAll('input,select,button').forEach(control=>{control.disabled=true;});
 setStatus(status,'Sending your quote request…');
 try{
  const response=await fetch('/api/automation-quote',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.message)throw new Error(result?.error||'Your request could not be confirmed. Please try again. Your estimate is still available to download.');
  setStatus(status,`Your quote request has been sent. Reference ${snapshot.reference}. We aim to reply within two business days. You can keep a copy using Download brief.`);
 }catch(error){$('#enquiry-fields').disabled=false;setStatus(status,error.name==='TimeoutError'?'Sending took longer than expected. Delivery is not confirmed. Please retry; the same request reference will be reused.':error.message||'Unable to confirm delivery. Please retry or download your brief.',true);}
 finally{sending=false;estimateForm.querySelectorAll('fieldset,button[type=submit]').forEach(control=>{control.disabled=false;});finder.querySelectorAll('input,select,button').forEach(control=>{control.disabled=false;});}
});
renderCatalogue();updateShortlist();
const requested=new URLSearchParams(location.search).get('service');
if(serviceById.has(requested))openExample(requested);
