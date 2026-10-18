const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
(async () => {
 const root = process.cwd();
 const server = http.createServer(async (req,res) => {
  try {
   const filename = path.resolve(root, '.' + decodeURI(new URL(req.url, 'http://localhost').pathname));
   if (!filename.startsWith(root + path.sep)) {res.writeHead(403);return res.end();}
   const types = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
   res.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream');
   res.end(await fs.readFile(filename));
  } catch {res.writeHead(404);res.end();}
 });
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 const base = `http://127.0.0.1:${server.address().port}/`;
 const browser = await chromium.launch({args:['--no-sandbox']});
 let html = await fs.readFile('portfolio.html','utf8');
 const cards = [...html.matchAll(/<a\b[^>]*class="concept-card\b[^>]*>[\s\S]*?<\/a>/g)];
 await fs.mkdir('assets/portfolio/screenshots',{recursive:true});
 let captured = 0;
 for (const [i,match] of cards.entries()) {
  const card = match[0], href = card.match(/href="([^"]+)"/)?.[1];
  const name = card.match(/<h3>(.*?)<\/h3>/)?.[1] || 'Website';
  if (!href || /protected|Request preview|Preview by request/.test(card) || href.startsWith('marketplace')) continue;
  // Restricted Sites cannot supply a public homepage capture.
  if (href.includes('.chatgpt.site')) continue;
  let url = new URL(href,base).href;
  if (href.includes('qr-menu-ordering')) url = 'https://tablepulse-blackoak.netlify.app/';
  if (href.includes('aurora-cafe')) url = 'https://aurora-cafe-blackoak.netlify.app/';
  const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  try {
   const response = await page.goto(url,{waitUntil:'networkidle',timeout:45000}).catch(async error => {
    if (page.url() !== 'about:blank') return null;
    throw error;
   });
   if (response && response.status() >= 400) throw Error(`HTTP ${response.status()}`);
   await page.waitForTimeout(1800);
   await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => {img.onload=img.onerror=resolve;setTimeout(resolve,3000)})));
   });
   const title = await page.title();
   if (/site unavailable|access denied|not found|log in|sign in/i.test(title)) throw Error(`Unavailable page: ${title}`);
   const filename = `assets/portfolio/screenshots/homepage-${i+1}.jpg`;
   await page.screenshot({path:filename,type:'jpeg',quality:82,fullPage:false});
   const image = `<img class="concept-photo-cover" src="${filename}" alt="${name.replaceAll('"','&quot;')} website homepage preview" width="1440" height="900" loading="lazy" decoding="async">`;
   html = html.replace(card,card.replace(/<img\b[^>]*>/,image));
   console.log(`Captured ${name}: ${title}`); captured++;
  } catch (error) { console.error(`Capture unavailable for ${name}: ${error.message}`); }
  finally {await page.close();}
 }
 await browser.close(); await new Promise(resolve => server.close(resolve));
 if (captured < 15) throw Error(`Only ${captured} captures succeeded; refusing incomplete update`);
 html = html.replace('style.css?v=20','style.css?v=21');
 await fs.writeFile('portfolio.html',html);
 console.log(`Updated ${captured} homepage thumbnails.`);
})().catch(error => {console.error(error);process.exit(1)});
