import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { prepareRelease, removeStartupVideo, gateLeadFinder, rewriteLinks, landingPage, upcoming } from '../scripts/prepare-release.mjs';
import { NEARBY_BUSINESSES_ENABLED, SHOPS_ENABLED, COMMUNITY_ENABLED } from '../netlify/lib/launch-flags.mjs';

test('unfinished features are explicitly disabled in every deployment', () => {
  assert.equal(NEARBY_BUSINESSES_ENABLED,false);
  assert.equal(SHOPS_ENABLED,false);
  assert.equal(COMMUNITY_ENABLED,false);
});
test('startup video and bootstrap are absent; unrelated videos remain', () => {
  const result = removeStartupVideo('<script src="intro-video.js" defer></script><video autoplay><source src="assets/black-oak-brand-film.mp4"></video><video controls src="demo.mp4"></video>');
  assert.doesNotMatch(result, /intro-video|black-oak-brand-film|autoplay/);
  assert.match(result, /demo.mp4/);
});
test('Maps search is unavailable without JavaScript and retains portal hooks', () => {
  const result = gateLeadFinder('<section class="workspace-card lead-finder"><form data-lead-search><select name="category"></select><button data-lead-submit>Search</button></form><p data-lead-status>Share your location.</p><div data-lead-results></div></section>');
  assert.match(result, /Coming soon/);
  assert.match(result, /<form[^>]+data-lead-search[^>]+hidden/);
  assert.match(result, /<fieldset disabled>/);
  assert.match(result, /data-lead-results/);
  assert.doesNotMatch(result, /Share your location/);
});
test('missing pages and fragments get banners; real links and API routes survive', () => {
  const docs = new Map([['index.html','<h1 id="top">Home</h1>'],['portfolio.html','<h1 id="work">Work</h1>']]);
  const files = new Set([...docs.keys(),'shops.html']);
  const report = [];
  const html = '<a href="missing.html">Missing</a><a href="portfolio.html#gone">Gone</a><a href="portfolio.html#work">Work</a><a href="shops.html">Shops</a><a href="/api/partners">API</a><a href="mailto:hello@example.com">Email</a><a href="https://example.com">External</a>';
  const result = rewriteLinks(html,'index.html',docs,files,report);
  assert.equal(report.length,2);
  assert.equal((result.match(/coming-soon-chip/g)||[]).length,3);
  assert.match(result,/href="portfolio.html#work">Work<\/a>/);
  assert.match(result,/href="\/api\/partners">API<\/a>/);
  assert.match(result,/href="mailto:hello@example.com"/);
  assert.match(result,/href="https:\/\/example.com"/);
});
test('public shop and community pages contain no fake listings or posting UI', () => {
  for (const filename of Object.keys(upcoming)) {
    const page = landingPage(filename);
    assert.match(page,/Coming soon/);
    assert.doesNotMatch(page,/<form\b|contenteditable|type="file"|localStorage|fetch\(/i);
    assert.doesNotMatch(page,/marketplace\.js/);
  }
  assert.match(landingPage('shops.html'), /Active businesses/);
  assert.match(landingPage('shops.html'), /Businesses for sale/);
  assert.match(landingPage('shops.html'), /Physical shops/);
  assert.match(landingPage('community.html'), /developed privately/);
});
test('release builds mark unavailable links and exclude startup assets', async () => {
  const dir = await mkdtemp(join(tmpdir(),'blvck-oak-release-'));
  try {
    await mkdir(join(dir,'assets'));
    await writeFile(join(dir,'assets/black-oak-brand-film.mp4'),'fixture');
    await writeFile(join(dir,'marketplace.js'),'must not ship');
    await writeFile(join(dir,'index.html'),'<html><head></head><body><nav><a href="portfolio.html">Portfolio</a><a href="gone.html">Unavailable</a></nav><main><section id="approach">Hello</section></main></body></html>');
    for (const name of ['portfolio.html','partners.html','contact.html']) await writeFile(join(dir,name),'<html><head></head><body><main>Existing page</main></body></html>');
    await prepareRelease(dir);
    const home = await readFile(join(dir,'index.html'),'utf8');
    assert.match(home,/discover-next/);
    assert.match(home,/href="\/coming-soon.html"/);
    assert.match(home,/release\.js/);
    const report = JSON.parse(await readFile(join(dir,'release-status.json'),'utf8'));
    assert.equal(report.startupVideo,false);
    assert.equal(report.localLinksMarked.length,1);
    await assert.rejects(readFile(join(dir,'assets/black-oak-brand-film.mp4')),{code:'ENOENT'});
    await assert.rejects(readFile(join(dir,'marketplace.js')),{code:'ENOENT'});
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('disabled Maps endpoint never reads coordinates, keys or private stores', async () => {
  const file = new URL('../netlify/functions/nearby-businesses.mjs',import.meta.url);
  const source = (await readFile(file,'utf8')).replace(/^import .*;\n/gm,'').replace('export const config','const config').replace('export default async function handler','async function handler');
  let calls = 0;
  const forbidden = () => { calls++; throw new Error('Disabled integration was called'); };
  const handler = runInNewContext(source+'\nhandler;', { NEARBY_BUSINESSES_ENABLED, json:(body,status=200)=>new Response(JSON.stringify(body),{status}), portalStore:forbidden, runtimeEnv:forbidden, requireAccount:forbidden, assertCsrf:forbidden, validateLeadSearch:forbidden, readBody:forbidden, consumeLeadSearchQuota:forbidden, searchNearbyBusinesses:forbidden, console });
  const post = await handler(new Request('https://blvckoak.com.au/api/businesses/nearby',{method:'POST',body:'not even JSON'}));
  assert.equal(post.status,503);
  assert.equal((await post.json()).code,'COMING_SOON');
  assert.equal((await handler(new Request('https://blvckoak.com.au/api/businesses/nearby'))).status,405);
  assert.equal(calls,0);
});
