import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profiles } from '../community/profiles.mjs';
import { buildCommunity } from '../scripts/build-community.mjs';
test('100 distinct fictional profiles have unique offerings and cannot transact',()=>{
 assert.equal(profiles.length,100);
 for(const key of ['id','slug','name']) assert.equal(new Set(profiles.map(p=>p[key])).size,100);
 assert.equal(new Set(profiles.map(p=>p.category)).size,10);
 assert.equal(new Set(profiles.flatMap(p=>p.offerings)).size,300);
 for(const p of profiles){assert.equal(p.aiGenerated,true);assert.equal(p.fictional,true);assert.equal(p.transactionsEnabled,false);assert.equal(p.offerings.length,3);assert.match(p.slug,/^[a-z0-9-]+$/);}
});
test('every discover card resolves to a labelled public profile and local artwork',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'community-'));
 try{await buildCommunity(dir);const feed=await readFile(join(dir,'community.html'),'utf8');assert.equal((feed.match(/data-profile=/g)||[]).length,100);
 for(const p of profiles){const html=await readFile(join(dir,'community',p.slug,'index.html'),'utf8');assert.match(html,/AI concept/);assert.match(html,/No checkout or bookings/);assert.match(html,/id="collection"/);assert.doesNotMatch(html,/data-package=|api\/checkout/);assert.match(await readFile(join(dir,'community/art',p.slug+'.svg'),'utf8'),/<svg/);}
 assert.equal(JSON.parse(await readFile(join(dir,'community/profiles.json'),'utf8')).length,100);
 }finally{await rm(dir,{recursive:true,force:true});}
});
