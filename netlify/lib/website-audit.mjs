const tag = (html, expression) => expression.test(html);

export function scoreWebsiteAudit(html, finalUrl, status = 200) {
  const source = String(html || '').slice(0, 1_000_000);
  const checks = [
    { key: 'secure', label: 'Secure HTTPS connection', points: 15, pass: String(finalUrl).startsWith('https://'), fix: 'Move the website to HTTPS so visitors and search engines can trust the connection.' },
    { key: 'reachable', label: 'Website responds correctly', points: 10, pass: status >= 200 && status < 400, fix: 'Fix the server response so the main page loads without an error.' },
    { key: 'title', label: 'Search-friendly page title', points: 10, pass: tag(source, /<title>\s*[^<]{8,70}\s*<\/title>/i), fix: 'Add a clear page title describing the business and its main service.' },
    { key: 'description', label: 'Meta description', points: 10, pass: tag(source, /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{50,180}["']/i) || tag(source, /<meta[^>]+content=["'][^"']{50,180}["'][^>]+name=["']description["']/i), fix: 'Write a useful search description of roughly 120–160 characters.' },
    { key: 'viewport', label: 'Mobile viewport', points: 10, pass: tag(source, /<meta[^>]+name=["']viewport["']/i), fix: 'Add the mobile viewport tag so the layout scales properly on phones.' },
    { key: 'heading', label: 'Clear main heading', points: 10, pass: tag(source, /<h1\b[^>]*>[\s\S]*?<\/h1>/i), fix: 'Use one clear H1 heading that explains the main offer.' },
    { key: 'canonical', label: 'Canonical page address', points: 5, pass: tag(source, /<link[^>]+rel=["']canonical["']/i), fix: 'Add a canonical URL to reduce duplicate-page SEO problems.' },
    { key: 'social', label: 'Social sharing preview', points: 5, pass: tag(source, /<meta[^>]+property=["']og:title["']/i) && tag(source, /<meta[^>]+property=["']og:image["']/i), fix: 'Add Open Graph title and image tags for professional link previews.' },
    { key: 'schema', label: 'Business structured data', points: 5, pass: tag(source, /application\/ld\+json/i), fix: 'Add structured business and service data to help search engines understand the company.' },
    { key: 'imageAlt', label: 'Accessible image descriptions', points: 10, pass: !tag(source, /<img\b/i) || !tag(source, /<img\b(?![^>]*\balt=)[^>]*>/i), fix: 'Add meaningful alt text to images that communicate information.' },
    { key: 'conversion', label: 'Clear contact action', points: 10, pass: tag(source, /href=["'](?:tel:|mailto:)|<form\b|book|quote|contact|get started|enquire/i), fix: 'Add a prominent call, booking, quote or enquiry action.' },
  ];
  const score = checks.reduce((total, check) => total + (check.pass ? check.points : 0), 0);
  return { score, checks: checks.map(({ key, label, points, pass, fix }) => ({ key, label, points, pass, fix })), fixes: checks.filter((check) => !check.pass).map((check) => check.fix).slice(0, 5) };
}

export function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  if (value === '::' || value === '::1' || value === '0.0.0.0' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('2001:db8:')) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
    (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113);
}
