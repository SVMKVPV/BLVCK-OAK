import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { emailKey, generateReferralCode, referralsStore, isValidCode } from './referrals.mjs';

export const SESSION_COOKIE = '__Host-blackoak-session';
export const SESSION_SECONDS = 12 * 60 * 60;
export const portalStore = () => getStore({ name: 'black-oak-partner-portal', consistency: 'strong' });
export const secretToken = () => randomBytes(32).toString('base64url');
export const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
export const validEmail = (value) => typeof value === 'string' && value.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const quoteIdPattern = /^[a-f0-9]{32}$/;

export class PortalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function siteOrigin() {
  const configured = process.env.SITE_URL;
  if (!configured) throw new PortalError('The site address is not configured. Contact Black Oak.', 503);
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password) throw new PortalError('A secure SITE_URL is required.', 503);
  return url.origin;
}

export function assertSameOrigin(request) {
  if (request.headers.get('origin') !== siteOrigin()) throw new PortalError('This request must come from the Black Oak website.', 403);
}

export async function readBody(request, limit = 16000) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) throw new PortalError('Use a JSON request.', 415);
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw new PortalError('Request is too large.', 413);
  try { return JSON.parse(text); } catch { throw new PortalError('Invalid request.'); }
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a); const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function consumeChallenge(token, code, store = portalStore()) {
  if (!tokenPattern.test(token || '') || !/^\d{6}$/.test(String(code || ''))) throw new PortalError('Enter the six-digit code.');
  const key = 'challenge/' + hash(token);
  const entry = await store.getWithMetadata(key, { type: 'json' });
  const challenge = entry?.data;
  if (!challenge || challenge.used || !Number.isFinite(challenge.expiresAt) || challenge.expiresAt <= Date.now() || challenge.attempts >= 5) throw new PortalError('This code expired or was used. Request a new code.', 401);
  const correct = safeEqual(hash(token + ':' + code), challenge.codeHash);
  const claim = await store.setJSON(key, { ...challenge, attempts: challenge.attempts + 1, used: correct }, { onlyIfMatch: entry.etag });
  if (!claim.modified) throw new PortalError('Another sign-in attempt is processing. Try again.', 409);
  if (!correct) throw new PortalError('Incorrect code. Please try again.', 401);
  return challenge;
}

export async function createSession(account, store = portalStore()) {
  const token = secretToken();
  const session = { accountId: account.id, csrf: secretToken(), expiresAt: Date.now() + SESSION_SECONDS * 1000 };
  await store.setJSON(`session/${hash(token)}`, session, { onlyIfNew: true });
  return { cookie: sessionCookie(token), session };
}

export async function requireAccount(request, store = portalStore()) {
  const cookies = String(request.headers.get('cookie') || '').split(';').map((part) => part.trim());
  const token = cookies.find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || '';
  if (!tokenPattern.test(token)) throw new PortalError('Sign in to your partner account.', 401);
  const sessionKey = `session/${hash(token)}`;
  const session = await store.get(sessionKey, { type: 'json' });
  if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw new PortalError('Your session expired. Sign in again.', 401);
  const account = await store.get(`account/${session.accountId}`, { type: 'json' });
  if (!account || account.disabled) throw new PortalError('This account is unavailable.', 403);
  const ownerEmail = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  return { account, session, sessionKey, isOwner: Boolean(ownerEmail && account.email === ownerEmail) };
}

export function assertCsrf(request, auth) {
  assertSameOrigin(request);
  if (!safeEqual(request.headers.get('x-csrf-token'), auth.session.csrf)) throw new PortalError('Refresh the page and try again.', 403);
}

export async function ensureReferral(account, store = referralsStore()) {
  const emailIndex = `email/${emailKey(account.email)}`;
  let code = await store.get(emailIndex, { type: 'text' });
  if (!code) {
    const generated = generateReferralCode();
    const reserved = await store.set(emailIndex, generated, { onlyIfNew: true });
    code = reserved.modified ? generated : await store.get(emailIndex, { type: 'text' });
  }
  if (!isValidCode(code)) throw new PortalError('Your referral record needs an owner review.', 409);
  let referral = await store.get(`code/${code}`, { type: 'json' });
  if (!referral) {
    const value = { code, email: account.email, name: account.name, status: 'onboarding', emailVerifiedAt: account.verifiedAt, acceptedTermsAt: account.acceptedTermsAt, termsVersion: '2026-09-02', createdAt: new Date().toISOString() };
    await store.setJSON(`code/${code}`, value, { onlyIfNew: true });
    referral = await store.get(`code/${code}`, { type: 'json' });
  }
  if (referral.email !== account.email || ['closed', 'suspended'].includes(referral.status)) throw new PortalError('Your referral profile needs an owner review.', 403);
  return referral;
}

export function clientError(error) {
  return { error: error instanceof PortalError ? error.message : 'The service is temporarily unavailable. Please try again.', status: error instanceof PortalError ? error.status : 503 };
}
