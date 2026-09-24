import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

// Confirmed by release smoke check: this external showcase returned HTTP 401.
export function isUnavailableLink(href, page = 'index.html') {
  try {
    const u = new URL(href, 'https://blvckoak.com.au/' + page);
    return u.hostname === 'lumera-beauty-store.samkapa3.chatgpt.site' ||
      (['blvckoak.com.au','www.blvckoak.com.au','blvckoak.netlify.app'].includes(u.hostname) && u.pathname === '/previews/ecommerce.html');
  } catch { return false; }
}
export function markUnavailableHtml(html, page, report = []) {
  return html.replace(/<a\b([^>]*?)\bhref=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi, (all,before,q,href,after,label) => {
    if (!isUnavailableLink(href,page)) return all;
    report.push({page,href,reason:'external preview requires sign-in (HTTP 401)'});
    return '<a' + before + 'href=' + q + '/coming-soon.html' + q + after + '>' + label + (label.includes('coming-soon-chip') ? '' : '<span class="coming-soon-chip">Coming soon</span>') + '</a>';
  });
}
export async function markUnavailableLinks(output) {
  const report = JSON.parse(await readFile(resolve(output,'release-status.json'),'utf8'));
  async function walk(dir) {
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      const path=resolve(dir,entry.name);
      if(entry.isDirectory()) await walk(path);
      else if(entry.name.endsWith('.html')) {
        const page=relative(output,path).replaceAll('\\','/');
        let html=markUnavailableHtml(await readFile(path,'utf8'),page,report.localLinksMarked);
        html=html.replace('</body>','<script src="/unavailable-links.js" defer></script>\n</body>');
        await writeFile(path,html);
      }
    }
  }
  await walk(output);
  await writeFile(resolve(output,'unavailable-links.js'), `(() => {
    function mark(root) {
      const links = root.matches?.('a[href]') ? [root] : [...(root.querySelectorAll?.('a[href]') || [])];
      for (const a of links) {
        const u = new URL(a.href, location.href);
        if (u.hostname !== 'lumera-beauty-store.samkapa3.chatgpt.site' && !(u.origin === location.origin && u.pathname === '/previews/ecommerce.html')) continue;
        a.href='/coming-soon.html';
        if(!a.querySelector('.coming-soon-chip')) { const tag=document.createElement('span'); tag.className='coming-soon-chip'; tag.textContent='Coming soon'; a.append(tag); }
      }
    }
    mark(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {if(node.nodeType===1) mark(node);}))).observe(document.body,{childList:true,subtree:true});
  })();\n`);
  await writeFile(resolve(output,'release-status.json'),JSON.stringify(report,null,2));
  console.log(`Unavailable link review: ${report.localLinksMarked.length} links labelled Coming soon.`);
}
