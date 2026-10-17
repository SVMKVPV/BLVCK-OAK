import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const publicPages = [
  'portfolio.html',
  'marketplace.html',
  'audit.html',
  'quote.html',
  'ai-generator.html',
  'contact.html',
  'book.html',
  'referrals.html',
  'privacy.html',
  'terms.html',
  'refunds.html',
];

test('public pages use self-canonicals and production Open Graph URLs', async () => {
  const pages = await Promise.all(publicPages.map(async (file) => [file, await read(file)]));

  for (const [file, html] of pages) {
    const pageUrl = `https://blvckoak.com.au/${file}`;
    assert.ok(html.includes(`<link rel="canonical" href="${pageUrl}">`), `${file} should self-canonicalize`);
    assert.ok(html.includes(`<meta property="og:url" content="${pageUrl}">`), `${file} should publish its canonical Open Graph URL`);
    assert.ok(html.includes('<meta property="og:image" content="https://blvckoak.com.au/og.png">'), `${file} should use the production social image`);
    assert.doesNotMatch(html, /https:\/\/blvckoak\.netlify\.app\/og\.png/i, `${file} should not advertise the legacy social image origin`);
  }
});

test('lead forms submit by POST and retain privacy and bot controls', async () => {
  const forms = [
    ['audit.html', 'audit', 'companyWebsite'],
    ['book.html', 'booking', 'website'],
    ['contact.html', 'contact', 'website'],
  ];

  for (const [file, hook, honeypot] of forms) {
    const html = await read(file);
    const openingTag = html.match(new RegExp(`<form\\b[^>]*data-${hook}-form[^>]*>`, 'i'))?.[0];
    assert.ok(openingTag, `${file} should retain its JavaScript form hook`);
    assert.match(openingTag, /\bmethod="post"/i, `${file} must not put personal data in a query string`);
    assert.ok(html.includes(`name="${honeypot}"`), `${file} should retain its honeypot field`);
    assert.ok(html.includes('name="privacy"'), `${file} should retain explicit privacy consent`);
  }
});
