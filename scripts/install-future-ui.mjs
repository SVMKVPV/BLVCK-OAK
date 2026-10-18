import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// An explicit root whitelist keeps customer websites and generated previews independent.
export const futurePages = Object.freeze([
  'index.html', 'referrals.html', 'contact.html', 'privacy.html', 'terms.html', 'refunds.html',
  'portfolio.html', 'marketplace.html', 'quote.html', 'partners.html', 'pay.html', 'progress.html',
  'audit.html', 'book.html', 'oakpay.html', 'oakpay-app.html', 'community.html', 'ai-generator.html',
  'nearby.html', 'login.html', 'coming-soon.html', '404.html', 'shops.html',
]);

export async function installFutureUi(directory) {
  for (const name of futurePages) {
    const path = resolve(directory, name);
    let html;
    try { html = await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    html = html.replace(/<body\b([^>]*)>/i, (tag, attributes) => /\bdata-future-ui(?:\s|=|$)/i.test(attributes) ? tag : `<body${attributes} data-future-ui>`);
    html = html.replace(/(<meta\b[^>]*name=["']theme-color["'][^>]*content=["'])[^"']*(["'])/i, '$1#07090c$2');
    const additions = [];
    if (!/<link\b[^>]*href=["'][^"']*\bfuture-ui\.css(?:[?"'])/i.test(html)) additions.push('<link rel="stylesheet" href="/future-ui.css?v=1">');
    if (!/<script\b[^>]*src=["'][^"']*\bfuture-ui\.js(?:[?"'])/i.test(html)) additions.push('<script src="/future-ui.js?v=1" defer></script>');
    if (additions.length) html = html.replace(/<\/head>/i, additions.join('\n') + '\n</head>');
    await writeFile(path, html);
  }
}
