import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnavailableLink, markUnavailableHtml } from '../scripts/unavailable-links.mjs';

test('the login-protected ecommerce preview is consistently marked unavailable', () => {
  assert.equal(isUnavailableLink('previews/ecommerce.html'),true);
  assert.equal(isUnavailableLink('/previews/ecommerce.html?source=portfolio'),true);
  assert.equal(isUnavailableLink('https://lumera-beauty-store.samkapa3.chatgpt.site/'),true);
  assert.equal(isUnavailableLink('previews/link-in-bio.html'),false);
  assert.equal(isUnavailableLink('https://example.com/previews/ecommerce.html'),false);
});
test('inaccessible links receive a real Coming soon destination and visible badge', () => {
  const report=[];
  const html=markUnavailableHtml('<a href="previews/ecommerce.html">Ecommerce preview</a><a href="portfolio.html">Portfolio</a>','index.html',report);
  assert.match(html,/href="\/coming-soon.html"/);
  assert.match(html,/coming-soon-chip">Coming soon/);
  assert.match(html,/href="portfolio.html">Portfolio<\/a>/);
  assert.equal(report.length,1);
  assert.match(report[0].reason,/401/);
});
test('existing Coming soon labels are not duplicated', () => {
  const html=markUnavailableHtml('<a href="previews/ecommerce.html">Example<span class="coming-soon-chip">Coming soon</span></a>','index.html');
  assert.equal((html.match(/coming-soon-chip/g)||[]).length,1);
});
