(() => {
 'use strict';
 const keys={saved:'bo-community-saved-v1',following:'bo-community-following-v1'};
 const read=key=>{try{const data=JSON.parse(localStorage.getItem(keys[key])||'[]');return new Set(Array.isArray(data)?data.filter(x=>typeof x==='string'):[]);}catch{return new Set();}};
 const state={saved:read('saved'),following:read('following')};
 let category='', timer;
 const toast=message=>{const box=document.querySelector('.toast');box.textContent=message;box.hidden=false;clearTimeout(timer);timer=setTimeout(()=>box.hidden=true,4500);};
 const search=document.querySelector('#community-search'),style=document.querySelector('#style-filter'),collection=document.querySelector('#collection-filter');
 function filter(){if(!search)return;let count=0;const query=search.value.trim().toLowerCase(),view=collection.value;
  document.querySelectorAll('[data-profile]').forEach(card=>{const visible=(!category||card.dataset.category===category)&&(!style.value||card.dataset.style===style.value)&&(!query||card.dataset.search.includes(query))&&(view==='all'||state[view].has(card.dataset.profile));card.hidden=!visible;if(visible)count++;});
  document.querySelector('#result-count').textContent=`${count} ${count===1?'concept':'concepts'} to explore`;
  document.querySelector('.empty-state').hidden=count!==0;
 }
 function paint(){document.querySelectorAll('[data-save],[data-follow]').forEach(button=>{const follow=button.hasAttribute('data-follow'),slug=follow?button.dataset.follow:button.dataset.save,active=state[follow?'following':'saved'].has(slug);button.setAttribute('aria-pressed',String(active));button.textContent=button.classList.contains('save-button')?(active?'★':'☆'):follow?(active?'Following ✓':'Follow concept'):(active?'Saved ✓':'Save concept');});}
 document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-category-filter')){category=button.dataset.categoryFilter;document.querySelectorAll('[data-category-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filter();}
  if(button.hasAttribute('data-save')||button.hasAttribute('data-follow')){const follow=button.hasAttribute('data-follow'),key=follow?'following':'saved',slug=follow?button.dataset.follow:button.dataset.save;const active=state[key].has(slug);active?state[key].delete(slug):state[key].add(slug);let persisted=true;try{localStorage.setItem(keys[key],JSON.stringify([...state[key]]));}catch{persisted=false;}paint();filter();toast(persisted?(active?'Removed from your browser collection.':follow?'Following in this browser.':'Saved in this browser.'):'Storage unavailable. This change lasts only while this page is open.');}
  if(button.hasAttribute('data-share')){const url=location.origin+location.pathname;try{if(navigator.share)await navigator.share({title:document.title,url});else{await navigator.clipboard.writeText(url);toast('Profile link copied.');}}catch(error){if(error.name!=='AbortError')toast('Copy this profile’s address from your browser to share it.');}}
 });
 if(search){const view=new URLSearchParams(location.search).get('view');if(['saved','following'].includes(view))collection.value=view;search.addEventListener('input',filter);style.addEventListener('change',filter);collection.addEventListener('change',filter);filter();}
 window.addEventListener('storage',event=>{for(const key of Object.keys(keys))if(event.key===keys[key])state[key]=read(key);paint();filter();});
 paint();
})();
