const form=document.getElementById('generator-form');
const industries={
  'Electrician':['Residential Electrical','Commercial Projects','Emergency & Repairs'],
  'Café / Restaurant':['Menu & Specials','Reservations','Functions & Catering'],
  'Landscaping':['Landscape Design','Construction','Garden Maintenance'],
  'Cleaning':['Home Cleaning','Commercial Cleaning','Deep Cleans'],
  'Mechanic / Automotive':['Logbook Servicing','Repairs & Diagnostics','Inspections'],
  'Construction / Trade':['New Builds','Renovations','Project Support'],
  'Beauty / Wellness':['Signature Services','Packages','Bookings'],
  'Professional Services':['Strategy','Advisory','Ongoing Support'],
  'E-commerce':['Best Sellers','New Arrivals','Customer Favourites'],
  'Other':['Core Service','Popular Service','Custom Solutions']
};
const headlineMap={
  'Electrician':'Powering better homes, businesses and builds.',
  'Café / Restaurant':'Good food. Great atmosphere. Worth coming back for.',
  'Landscaping':'Outdoor spaces designed to be lived in.',
  'Cleaning':'A cleaner space, without losing your time.',
  'Mechanic / Automotive':'Straight answers. Quality work. Back on the road.',
  'Construction / Trade':'Built properly. Managed clearly. Finished with pride.',
  'Beauty / Wellness':'Feel better. Look your best. Make time for you.',
  'Professional Services':'Clear thinking for your next business move.',
  'E-commerce':'Products people notice. An experience they remember.',
  'Other':'A sharper way to present what you do.'
};
const styleMap={
  dark:{a:'#d4ae58',b:'#f0d38c',light:false},
  light:{a:'#a77a2a',b:'#bf8e34',light:true},
  bold:{a:'#ff6a3d',b:'#ffb29a',light:false},
  natural:{a:'#9eb27c',b:'#d7e0c1',light:false}
};
function slugify(v){return v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'your-business'}
function esc(v){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function render(){
  const business=document.getElementById('business').value.trim()||'Your Business';
  const industry=document.getElementById('industry').value;
  const offer=document.getElementById('offer').value.trim()||'A better experience built around what your customers actually need.';
  const audience=document.getElementById('audience').value.trim()||'local customers';
  const cta=document.getElementById('cta').value.trim()||'Get started';
  const notes=document.getElementById('notes').value.trim();
  const style=styleMap[document.getElementById('style').value]||styleMap.dark;
  const preview=document.getElementById('site-preview');
  preview.style.setProperty('--accent',style.a);preview.style.setProperty('--accent2',style.b);preview.classList.toggle('light',style.light);
  document.getElementById('preview-logo').textContent=business.toUpperCase();
  document.getElementById('preview-address').textContent=slugify(business)+'.blvckoak-preview.com';
  document.getElementById('preview-industry').textContent=industry.toUpperCase()+' · BUILT FOR '+audience.toUpperCase().slice(0,42);
  document.getElementById('preview-headline').textContent=headlineMap[industry]||headlineMap.Other;
  document.getElementById('preview-copy').textContent=offer+'. '+(notes?notes+'. ':'')+'A focused experience designed to build trust and make the next step obvious.';
  document.getElementById('nav-cta').textContent=cta.toUpperCase();
  document.getElementById('hero-cta').textContent=cta;
  document.getElementById('final-cta').textContent=cta;
  document.getElementById('services-title').textContent='Built around what your customers need most.';
  document.getElementById('final-heading').textContent='Ready to choose '+business+'?';
  const services=industries[industry]||industries.Other;
  document.getElementById('service-cards').innerHTML=services.map((s,i)=>'<article class="card"><b>0'+(i+1)+'</b><strong>'+esc(s)+'</strong><p>Clear, professional and easy to understand — presented around the outcome your customer is looking for.</p></article>').join('');
  const params=new URLSearchParams({service:'ai-website-generator',business,industry,offer,cta});
  document.getElementById('contact-link').href='contact.html?'+params.toString()+'#contact-title';
}
form.addEventListener('submit',e=>{e.preventDefault();render();document.querySelector('.preview-shell').scrollIntoView({behavior:'smooth',block:'start'})});
render();