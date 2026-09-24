import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const expected = process.env.RELEASE_HEAD || process.env.GITHUB_SHA;
const repository = process.env.GITHUB_REPOSITORY || 'SVMKVPV/BLVCK-OAK';
const isPreview = process.env.RELEASE_EVENT === 'pull_request';
const result = { expectedCommit: expected, environment: isPreview ? 'preview' : 'production', checks: [], externalLinks: [] };
function trusted(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (['blvckoak.com.au','www.blvckoak.com.au','blvckoak.netlify.app'].includes(u.hostname) || /^deploy-preview-\d+--blvckoak\.netlify\.app$/.test(u.hostname) || /^deploy-preview-\d+\.blvckoak\.site\.blvckoak\.com\.au$/.test(u.hostname));
  } catch { return false; }
}
async function request(url, options={}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000), headers: { 'User-Agent':'BLVCK-OAK-release-verification', ...options.headers } });
}
async function deployment() {
  if (!/^[a-f0-9]{40}$/i.test(expected || '')) throw new Error('An exact release commit is required.');
  for (let attempt=0; attempt<42; attempt++) {
    const candidates = [];
    if (isPreview) {
      const headers = process.env.GH_TOKEN ? {Authorization: `Bearer ${process.env.GH_TOKEN}`} : {};
      const response = await request(`https://api.github.com/repos/${repository}/commits/${expected}/status`, {headers});
      if (!response.ok) throw new Error(`Cannot read deployment status: ${response.status}`);
      const status = await response.json();
      for (const item of status.statuses || []) if (item.state === 'success' && item.context.includes('netlify') && trusted(item.target_url)) candidates.push(new URL(item.target_url).origin);
      if (/^\d+$/.test(process.env.RELEASE_PR || '')) candidates.push(`https://deploy-preview-${process.env.RELEASE_PR}--blvckoak.netlify.app`);
    } else candidates.push('https://blvckoak.com.au');
    for (const candidate of [...new Set(candidates)]) {
      try {
        const response = await request(candidate + '/release-status.json');
        if (!response.ok) continue;
        const metadata = await response.json();
        if (metadata.commit === expected && metadata.version === 'coming-soon-2026-09-25') {
          result.metadata = metadata;
          return candidate;
        }
      } catch { /* Deployment or DNS propagation not ready yet. */ }
    }
    console.log(`Waiting for the exact ${isPreview ? 'preview' : 'production'} release (${attempt+1}/42).`);
    await delay(7000);
  }
  throw new Error('The exact deployed release could not be verified; do not claim it is live.');
}
async function check(base,path,allowed,pattern,options={}) {
  const response = await request(base + path,options);
  const text = await response.text();
  const ok = allowed.includes(response.status) && (!pattern || pattern.test(text));
  result.checks.push({path,status:response.status,ok});
  console.log(`${ok ? 'PASS' : 'FAIL'} ${options.method || 'GET'} ${path}: ${response.status}`);
  if (!ok) throw new Error(`Unexpected deployed response for ${path}`);
  return text;
}
async function allHtml(directory) {
  const list=[];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path=resolve(directory,entry.name);
    if(entry.isDirectory()) list.push(...await allHtml(path));
    else if(entry.name.endsWith('.html')) list.push(await readFile(path,'utf8'));
  }
  return list;
}
async function externalLinks() {
  const html = (await allHtml(resolve('dist'))).join('\n');
  const config = await readFile('netlify.toml','utf8');
  const urls = new Set([...html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["']/g)].map(m=>m[1].replaceAll('&amp;','&')));
  for(const match of config.matchAll(/to\s*=\s*"(https:\/\/[^\"]+)"/g)) urls.add(match[1]);
  for(const value of [...urls].filter(u=>!trusted(u)).slice(0,60)) {
    const url = new URL(value);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname) || url.username || url.password || url.port) continue;
    try {
      const response = await request(value);
      await response.body?.cancel();
      const item = {url:url.origin+url.pathname,status:response.status,confirmedBroken:[401,403,404,410].includes(response.status)};
      result.externalLinks.push(item);
      console.log(`External link ${item.status}: ${item.url}`);
    } catch { result.externalLinks.push({url:url.origin+url.pathname,status:null,confirmedBroken:false,unverified:true}); }
  }
}
try {
  const base = await deployment(); result.baseUrl=base;
  const home = await check(base,'/',[200],/discover-next/);
  if (/intro-video\.js|black-oak-brand-film\.mp4|<video\b[^>]*autoplay/i.test(home)) throw new Error('The deployed homepage still references a startup video.');
  for(const path of ['/shops.html','/marketplace.html','/community.html','/nearby.html','/login.html','/coming-soon.html']) await check(base,path,[200],/Coming soon/);
  await check(base,'/partners.html',[200],/data-lead-search[^>]+hidden/);
  await check(base,'/portfolio.html',[200],/<!doctype html>/i);
  await check(base,'/previews/ecommerce.html',[200],/Coming soon/);
  await check(base,'/release.css',[200],/coming-soon-chip/);
  await check(base,'/release.js',[200],/data-lead-search/);
  await check(base,'/unavailable-links.js',[200],/coming-soon-chip/);
  await check(base,'/api/partners/auth',[405]);
  await check(base,'/api/partners',[401,403]);
  await check(base,'/api/contact',[405]);
  await check(base,'/api/stripe/webhook',[405]);
  await check(base,'/api/businesses/nearby',[503],/COMING_SOON/,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:'{}'});
  await check(base,'/release-verification-missing-page',[404],/Coming soon/);
  await externalLinks();
  if(result.externalLinks.some(item=>item.confirmedBroken)) throw new Error('A confirmed broken or inaccessible external link needs a Coming soon treatment.');
  result.ok=true;
  console.log(`Release smoke checks passed for ${expected} at ${base}. No payment, email or account was created.`);
} catch(error) { result.ok=false; result.error=error.message; console.error(error.message); process.exitCode=1; }
finally { await writeFile('release-smoke-results.json',JSON.stringify(result,null,2)); }
