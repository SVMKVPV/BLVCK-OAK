import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

export const upcoming = Object.freeze({
  'marketplace.html': ['Shops & businesses', 'Discover a business.<br>Find your next chapter.', 'A planned directory of active shops and businesses for sale, online and in the real world.', ['Active businesses', 'Businesses for sale', 'Online businesses', 'Physical shops']],
  'shops.html': ['Shops & businesses', 'Discover a business.<br>Find your next chapter.', 'A planned directory of active shops and businesses for sale, online and in the real world.', ['Active businesses', 'Businesses for sale', 'Online businesses', 'Physical shops']],
  'community.html': ['Design community', 'Good work deserves<br>to be seen.', 'A future home for designers and business owners to share website designs, build a portfolio and discover each other.', ['Website showcases', 'Creator portfolios', 'Discover & save', 'Share your work']],
  'nearby.html': ['Nearby business finder', 'Your next introduction<br>could be nearby.', 'The Google Maps-powered business finder is not available yet. Location searches are disabled while this feature is being prepared.', ['Local discovery', 'Business categories', 'Website information', 'Partner workspace']],
  'login.html': ['Owner dashboard', 'A new workspace<br>is on its way.', 'The redesigned owner dashboard and Google sign-in are not ready yet. Existing email-code access remains available through the partner workspace.', ['Owner overview', 'Project activity', 'Private insights', 'Google sign-in']],
  'coming-soon.html': ['In development', 'Something new.<br>Not quite live yet.', 'This feature is not available yet. Browse our existing portfolio or contact BLVCK OAK for help.', ['Thoughtful design', 'Work in progress', 'Not open for use', 'No launch date set']],
  '404.html': ['Page unavailable', 'This page is not<br>available yet.', 'Coming soon. This address may have changed or the feature may still be in development. Use the navigation below to return to a working page.', []],
});
const badge = '<span class="coming-soon-chip">Coming soon</span>';
const escape = (value) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export const releaseCss = `
.coming-soon-chip{display:inline-flex;align-items:center;gap:6px;vertical-align:middle;margin:4px 0 4px 8px;padding:5px 9px;border:1px solid #756443;border-radius:99px;background:#242016;color:#edcb86;font:600 10px/1.2 system-ui,sans-serif;letter-spacing:.07em;white-space:nowrap;text-transform:uppercase}
.coming-soon-banner{border:1px solid #756443;border-radius:14px;background:#1b1912;color:#f1d391;padding:20px 24px;margin:20px 0;line-height:1.65}.coming-soon-banner strong{display:block;font-size:18px}.coming-soon-banner p{margin:5px 0 0;color:#ccc4b6}
.upcoming-body{margin:0;background:#0b0d0e;color:#f6f2e8;font-family:'Plus Jakarta Sans',system-ui,sans-serif;min-height:100vh}.upcoming-body *{box-sizing:border-box}.upcoming-body a{color:inherit;text-decoration:none}.upcoming-nav{max-width:1280px;margin:auto;padding:28px 6%;display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid #262a29}.upcoming-brand{font-size:19px;letter-spacing:.15em;font-weight:800}.upcoming-nav nav{display:flex;gap:24px;font-size:13px;flex-wrap:wrap}.upcoming-nav a:focus-visible,.upcoming-actions a:focus-visible{outline:2px solid #dfbd7c;outline-offset:6px}
.upcoming-main{max-width:1160px;margin:auto;padding:75px 6% 90px}.upcoming-kicker{color:#c5ab77;font:600 11px/1.5 system-ui;letter-spacing:.2em;text-transform:uppercase}.upcoming-layout{display:grid;grid-template-columns:1.35fr 1fr;gap:60px;align-items:center}.upcoming-main h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(40px,5.6vw,72px);line-height:1.07;letter-spacing:-.04em;margin:26px 0}.upcoming-copy{font-size:16px;line-height:1.8;color:#b8bbb5;max-width:580px}.upcoming-main .coming-soon-chip{margin:10px 0}.upcoming-actions{display:flex;gap:16px;flex-wrap:wrap;margin-top:30px}.upcoming-actions a{padding:15px 22px;border:1px solid #5b5546;border-radius:6px;font-size:13px}.upcoming-actions a:first-child{background:#dec18b;color:#161713;border:0;font-weight:700}.upcoming-panel{border:1px solid #393b33;border-radius:24px;padding:30px;background:linear-gradient(140deg,#21241e,#0f1211);box-shadow:0 25px 60px #0005;transform:rotate(-3deg)}.upcoming-panel>p{font-size:10px;letter-spacing:.16em;color:#c5ab77;text-transform:uppercase}.upcoming-row{padding:22px 0;border-bottom:1px solid #ffffff15;display:flex;gap:18px;align-items:center}.upcoming-row:last-child{border-bottom:0}.upcoming-row span{font-family:Georgia,serif;font-size:24px;color:#b7a078}.upcoming-row strong{font-size:15px;font-weight:500}.upcoming-note{margin-top:65px;padding-top:24px;border-top:1px solid #292d28;color:#959b91;font-size:12px;line-height:1.8}.release-discover{margin:40px auto;padding:36px;max-width:1280px;border:1px solid #594c34;border-radius:16px;background:#101312}.release-discover h2{margin:0 0 12px}.release-discover p{color:#bcb9af;line-height:1.7}.release-discover nav{display:flex;gap:16px;flex-wrap:wrap}.release-discover a{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;color:#eee3c9;padding:12px 0}.release-notice{padding:14px 22px;border:1px solid #756443;background:#211e17;color:#edcf97;border-radius:10px;font-size:14px;line-height:1.6}.lead-search-form[hidden]{display:none!important}.site-header>nav{flex-wrap:wrap;justify-content:flex-end;gap:14px}
@media(max-width:760px){.upcoming-nav{align-items:flex-start;flex-direction:column;gap:18px}.upcoming-nav nav{gap:16px;font-size:12px}.upcoming-main{padding-top:40px}.upcoming-layout{grid-template-columns:1fr;gap:35px}.upcoming-panel{transform:none;padding:22px}.upcoming-note{margin-top:35px}.release-discover{margin:24px 16px;padding:24px}.upcoming-actions a{flex:1;text-align:center}.upcoming-main h1{font-size:clamp(36px,9vw,58px)}}
`;

export function landingPage(filename) {
  const [name, title, description, features] = upcoming[filename];
  const is404 = filename === '404.html';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0d0e"><meta name="robots" content="noindex,follow"><meta name="description" content="${escape(description)}"><title>${escape(name)} — Coming soon | BLVCK OAK</title><link rel="stylesheet" href="/release.css"></head>
<body class="upcoming-body"><header class="upcoming-nav"><a class="upcoming-brand" href="/index.html">BLVCK OAK</a><nav aria-label="Primary navigation"><a href="/portfolio.html">Portfolio</a><a href="/shops.html">Shops</a><a href="/community.html">Community</a><a href="/contact.html">Contact</a></nav></header><main class="upcoming-main"><p class="upcoming-kicker">BLVCK OAK / ${escape(name)}</p><div class="upcoming-layout"><div>${badge}<h1>${title}</h1><p class="upcoming-copy">${escape(description)}</p><div class="upcoming-actions"><a href="/portfolio.html">Explore our portfolio ↗</a><a href="${filename === 'login.html' ? '/partners.html' : '/contact.html'}">${filename === 'login.html' ? 'Email-code workspace' : 'Contact BLVCK OAK'} ↗</a></div></div><aside class="upcoming-panel" aria-label="Planned features"><p>${is404 ? 'Find your way back' : 'In development / not live'}</p>${(features.length ? features : ['Website portfolio', 'Get in touch', 'Return to the homepage']).map((f,i)=>`<div class="upcoming-row"><span>0${i+1}</span><strong>${escape(f)}</strong></div>`).join('')}</aside></div><p class="upcoming-note">${filename === 'shops.html' || filename === 'marketplace.html' ? 'Listings and business-sale enquiries are not open. No active or for-sale businesses are being advertised here yet.' : filename === 'community.html' ? 'Posting, profiles, comments and messaging are not open. The prototype is being developed privately.' : 'No launch date has been announced.'} ${is404 ? '<a href="/index.html">Return to the homepage ↗</a>' : 'This page is an announcement, not an operational feature.'}</p></main><script src="/release.js" defer></script></body></html>`;
}

export const releaseJs = `(() => {
  'use strict';
  // A disabled feature must never request the visitor's location.
  document.querySelectorAll('[data-lead-search]').forEach(form => {
    form.hidden = true;
    form.querySelectorAll('input,select,button').forEach(control => { control.disabled = true; });
    form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  });
  // Known feature errors get an honest availability message, never a fake success.
  const message = node => {
    if (/GOOGLE_MAPS_API_KEY|lead finder is not configured/i.test(node.textContent || '')) {
      node.textContent = 'Coming soon — the nearby business finder is not available yet.';
    }
  };
  document.querySelectorAll('[data-lead-status]').forEach(node => {
    message(node);
    new MutationObserver(() => message(node)).observe(node, { childList: true, subtree: true, characterData: true });
  });
})();\n`;

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}

export function removeStartupVideo(html) {
  return html.replace(/<script\b[^>]*\bsrc=["'][^"']*intro-video[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<video\b[\s\S]*?<\/video>/gi, block => /black-oak-brand-film|data-intro|startup/i.test(block) ? '' : block)
    .replace(/<link\b[^>]*href=["'][^"']*black-oak-brand-film\.mp4[^"']*["'][^>]*>/gi, '');
}

export function gateLeadFinder(html) {
  if (!html.includes('data-lead-search')) return html;
  return html.replace(/(<section\b[^>]*class="[^"]*lead-finder[^"]*"[^>]*>)/, '$1<div class="coming-soon-banner" role="status"><strong>Coming soon</strong><p>The Google Maps-powered nearby business finder is not available yet. Location searches are disabled.</p></div>')
    .replace(/<form\b([^>]*data-lead-search[^>]*)>/, '<form$1 hidden aria-disabled="true"><fieldset disabled>')
    .replace(/(<form\b[^>]*data-lead-search[^>]*>[\s\S]*?)<\/form>/, '$1</fieldset></form>')
    .replace(/(<p\b[^>]*data-lead-status[^>]*>)[\s\S]*?<\/p>/, '$1Coming soon — location search is not available yet.</p>')
    .replace('Use your current location to find nearby operating businesses that do not list a website on Google Maps.', 'Discover nearby businesses when this feature launches. No location access is requested while it is unavailable.');
}

export function rewriteLinks(html, file, documents, available, report) {
  const origin = 'https://blvckoak.com.au';
  const owned = new Set([origin, 'https://www.blvckoak.com.au', 'https://blvckoak.netlify.app']);
  return html.replace(/<a\b([^>]*?)\bhref=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi, (full,before,quote,href,after,label) => {
    if (/^(?:mailto:|tel:|data:)/i.test(href)) return full;
    let url;
    try { url = new URL(href.replace(/&amp;/g, '&'), origin + '/' + file); }
    catch { return full; }
    if (!owned.has(url.origin) || !/^https?:$/.test(url.protocol)) return full;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return full;
    let path;
    try { path = decodeURIComponent(url.pathname).replace(/^\//, ''); } catch { return full; }
    if (!path || path.endsWith('/')) path += 'index.html';
    if (!available.has(path) && !extname(path) && available.has(path + '.html')) path += '.html';
    const target = documents.get(path);
    const hash = url.hash.slice(1);
    let anchorExists = true;
    if (hash && target) {
      let id; try { id = decodeURIComponent(hash); } catch { id = hash; }
      anchorExists = [...target.matchAll(/\b(?:id|name)=(["'])(.*?)\1/gi)].some(m => m[2] === id);
    }
    const missing = !available.has(path) || !anchorExists;
    const planned = Object.hasOwn(upcoming, path);
    if (!missing && !planned) return full;
    if (missing) report.push({ page: file, href, reason: available.has(path) ? 'missing fragment' : 'missing local page' });
    const dest = missing ? '/coming-soon.html' : href;
    return '<a' + before + 'href=' + quote + escape(dest) + quote + after + '>' + label + (label.includes('coming-soon-chip') ? '' : badge) + '</a>';
  });
}

export async function prepareRelease(output) {
  await writeFile(resolve(output, 'release.css'), releaseCss);
  await writeFile(resolve(output, 'release.js'), releaseJs);
  for (const name of Object.keys(upcoming)) await writeFile(resolve(output, name), landingPage(name));
  // The actual new prototypes are NOT stored in this public repository or site.
  for (const name of ['assets/black-oak-brand-film.mp4', 'intro-video.js', 'marketplace.js']) await rm(resolve(output, name), { force: true });
  const paths = await filesBelow(output);
  const available = new Set(paths.map(path => relative(output,path).replaceAll('\\','/')));
  const documents = new Map();
  for (const path of paths.filter(p => p.endsWith('.html'))) {
    const key = relative(output,path).replaceAll('\\','/');
    let html = gateLeadFinder(removeStartupVideo(await readFile(path,'utf8')));
    if (!html.includes('/release.css')) html = html.replace('</head>', '<link rel="stylesheet" href="/release.css">\n<script src="/release.js" defer></script>\n</head>');
    if (key === 'index.html') {
      const section = '<section class="release-discover" aria-labelledby="discover-next"><p class="section-label">The next chapter</p><h2 id="discover-next">Discover. Connect. Grow.</h2><p>We are building new ways to find businesses and share great website design.</p><nav aria-label="Upcoming features"><a href="/shops.html">Shops &amp; businesses</a><a href="/community.html">Design community</a><a href="/nearby.html">Nearby business finder</a></nav></section>';
      html = html.replace(/<section\b[^>]*id="approach"[^>]*>/, match => section + '\n' + match);
      html = html.replace(/(<a\b[^>]*href="portfolio\.html"[^>]*>[\s\S]*?<\/a>)/g, '$1<a href="/shops.html">Shops</a><a href="/community.html">Community</a>');
    }
    documents.set(key, html);
  }
  const report = [];
  for (const [file, html] of documents) await writeFile(resolve(output,file), rewriteLinks(html,file,documents,available,report));
  const home = await readFile(resolve(output,'index.html'),'utf8');
  if (/intro-video\.js|<video\b[^>]*autoplay|black-oak-brand-film\.mp4/i.test(home)) throw new Error('Startup video must not ship in the public homepage.');
  if (!home.includes('discover-next')) throw new Error('Upcoming feature entry points were not added to the homepage.');
  await writeFile(resolve(output,'release-status.json'), JSON.stringify({ version: 'coming-soon-2026-09-25', commit: process.env.COMMIT_REF || process.env.GITHUB_SHA || null, nearby: 'coming_soon', shops: 'coming_soon', community: 'coming_soon', startupVideo: false, localLinksMarked: report },null,2));
  console.log(`Public release prepared: ${documents.size} HTML pages; ${report.length} unavailable local links marked Coming soon. Private prototypes excluded.`);
}
