import { json } from '../lib/referrals.mjs';
import { portfolioIdPattern, publicPortfolioItem } from '../lib/portfolio.mjs';
import { portalStore, quoteIdPattern } from '../lib/portal-auth.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 60 } };

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
  try {
    const store = portalStore();
    const { blobs } = await store.list({ prefix: 'portfolio-index/' });
    const ids = [...new Set((await Promise.all(blobs.map(async ({ key }) => {
      const portfolioId = key.split('/').at(-1);
      if (!portfolioIdPattern.test(portfolioId || '')) return null;
      const quoteId = await store.get(key, { type: 'text' });
      return quoteIdPattern.test(quoteId || '') ? quoteId : null;
    }))).filter(Boolean))];
    const projects = (await Promise.all(ids.map(async (id) => {
      const quote = await store.get(`quote/${id}`, { type: 'json' });
      return quote ? publicPortfolioItem(quote) : null;
    }))).filter(Boolean).sort((a, b) => String(b.publishedAt || b.completedAt || '').localeCompare(String(a.publishedAt || a.completedAt || '')));
    return json({ projects });
  } catch (error) {
    console.error('Portfolio request failed:', error.name);
    return json({ error: 'The portfolio is temporarily unavailable.' }, 503);
  }
}
