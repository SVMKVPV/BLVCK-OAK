import { randomBytes } from 'node:crypto';
import { PortalError } from './portal-auth.mjs';
import { readProjectProgress } from './project-progress.mjs';

export const portfolioIdPattern = /^[a-f0-9]{20}$/;

function cleanText(value, label, min, max) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new PortalError(`${label} must be ${min}–${max} characters.`);
  return text;
}

function cleanWebsiteUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 2048) throw new PortalError('The live website link is too long.');
  let url;
  try { url = new URL(text); } catch { throw new PortalError('Enter a complete live website link, including https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new PortalError('The live website link must use https:// and cannot contain sign-in details.');
  url.hash = '';
  return url.href;
}

export function readPortfolio(quote) {
  const stored = quote?.portfolio;
  if (!stored || !Number.isInteger(stored.revision)) {
    return {
      revision: 0,
      id: null,
      published: false,
      title: String(quote?.service || '').trim().slice(0, 100),
      category: 'Website design',
      summary: '',
      websiteUrl: '',
      publishedAt: null,
      updatedAt: null,
    };
  }
  return {
    revision: Math.max(0, stored.revision),
    id: portfolioIdPattern.test(stored.id || '') ? stored.id : null,
    published: stored.published === true,
    title: String(stored.title || '').trim().slice(0, 100),
    category: String(stored.category || '').trim().slice(0, 60),
    summary: String(stored.summary || '').trim().slice(0, 800),
    websiteUrl: String(stored.websiteUrl || '').trim().slice(0, 2048),
    publishedAt: typeof stored.publishedAt === 'string' ? stored.publishedAt : null,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

export function applyPortfolio(quote, input, accountId, now = new Date().toISOString(), createId = () => randomBytes(10).toString('hex')) {
  const progress = readProjectProgress(quote);
  if (progress.stage !== 'completed' || progress.percentage !== 100) throw new PortalError('Mark the project 100% complete before adding it to the portfolio.', 409);
  const current = readPortfolio(quote);
  if (!Number.isInteger(input.portfolioRevision) || input.portfolioRevision !== current.revision) throw new PortalError('This portfolio listing changed. Refresh before saving.', 409);
  const published = input.published === true;
  const title = cleanText(input.title, 'Public project title', 3, 100);
  const category = cleanText(input.category, 'Project category', 2, 60);
  const summary = cleanText(input.summary, 'Public project summary', 20, 800);
  const websiteUrl = cleanWebsiteUrl(input.websiteUrl);
  const id = current.id || createId();
  if (!portfolioIdPattern.test(id)) throw new PortalError('Could not create the portfolio listing. Try again.', 503);
  return {
    ...quote,
    portfolio: {
      revision: current.revision + 1,
      id,
      published,
      title,
      category,
      summary,
      websiteUrl,
      publishedAt: published ? (current.publishedAt || now) : current.publishedAt,
      updatedAt: now,
      updatedBy: accountId,
    },
  };
}

export function publicPortfolioItem(quote) {
  const progress = readProjectProgress(quote);
  const listing = readPortfolio(quote);
  if (!listing.published || !listing.id || progress.stage !== 'completed' || progress.percentage !== 100) return null;
  return {
    id: listing.id,
    title: listing.title,
    category: listing.category,
    summary: listing.summary,
    websiteUrl: listing.websiteUrl || null,
    completedAt: progress.updatedAt,
    publishedAt: listing.publishedAt,
  };
}
