
const device = document.querySelector('.device');
if (device && matchMedia('(pointer:fine)').matches) {
  device.addEventListener('mousemove', e => {
    const r=device.getBoundingClientRect(), x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    device.style.transform=`rotateY(${x*18}deg) rotateX(${-y*14}deg) translateY(-4px)`;
  });
  device.addEventListener('mouseleave',()=>device.style.transform='rotateY(-14deg) rotateX(8deg)');
}
document.querySelectorAll('[data-modal]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.modal)?.classList.add('open')));
document.querySelectorAll('.modal').forEach(m=>{
  m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('open')});
  m.querySelector('.close')?.addEventListener('click',()=>m.classList.remove('open'));
  m.querySelector('form')?.addEventListener('submit',e=>{
    e.preventDefault(); const box=m.querySelector('.modal-box');
    box.innerHTML='<h3>Demo confirmed ✓</h3><p>This is an interactive concept only. A real Black Oak build can connect this flow to your booking, CRM, payments or email system.</p><button class="btn" onclick="this.closest(\'.modal\').classList.remove(\'open\')">Done</button>';
  });
});
document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
  b.textContent='Added ✓'; b.disabled=true; setTimeout(()=>{b.textContent='Add to bag';b.disabled=false},1300)
}));
const cart={};
document.querySelectorAll('[data-menu-add]').forEach(b=>b.addEventListener('click',()=>{
  const name=b.dataset.menuAdd, price=Number(b.dataset.price||0); cart[name]=(cart[name]||{qty:0,price}); cart[name].qty++;
  renderCart(); b.textContent='Added ✓'; setTimeout(()=>b.textContent='Add',900);
}));
function renderCart(){
 const list=document.querySelector('.cart-list'), total=document.querySelector('[data-total]'); if(!list)return;
 list.innerHTML=Object.entries(cart).map(([n,v])=>`<div class="cart-line"><span>${v.qty}× ${n}</span><b>$${(v.qty*v.price).toFixed(2)}</b></div>`).join('')||'<span style="color:var(--muted)">Your table order is empty.</span>';
 total.textContent='$'+Object.values(cart).reduce((a,v)=>a+v.qty*v.price,0).toFixed(2);
}
