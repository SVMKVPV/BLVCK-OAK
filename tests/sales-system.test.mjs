import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, scoreWebsiteAudit } from '../netlify/lib/website-audit.mjs';

test('website audit rewards useful conversion and SEO fundamentals', () => {
  const html = '<html><head><title>Trusted Sydney Electrician Services</title><meta name="description" content="Licensed Sydney electricians for homes and businesses, with clear pricing, fast bookings and dependable local service today."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com"><meta property="og:title" content="Example"><meta property="og:image" content="image.jpg"><script type="application/ld+json">{}</script></head><body><h1>Electrician Sydney</h1><img src="team.jpg" alt="Electrician team"><a href="tel:0212345678">Call now</a></body></html>';
  const report = scoreWebsiteAudit(html, 'https://example.com', 200);
  assert.equal(report.score, 100);
  assert.equal(report.fixes.length, 0);
});

test('website audit produces priority fixes for a weak page', () => {
  const report = scoreWebsiteAudit('<html><body><img src="x.jpg"></body></html>', 'http://example.com', 500);
  assert.ok(report.score < 30);
  assert.equal(report.fixes.length, 5);
});

test('private and loopback addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1']) assert.equal(isPrivateAddress(address), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});
