import { randomInt } from 'node:crypto';
import { emailKey, json } from '../lib/referrals.mjs';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.mjs';
import { PortalError, assertSameOrigin, clientError, consumeChallenge, createSession, ensureReferral, hash, portalStore, readBody, secretToken, validEmail } from '../lib/portal-auth.mjs';

export const config = { rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 10 } };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    assertSameOrigin(request);
    const body = await readBody(request, 4096);
    const store = portalStore();
    if (body.action === 'start') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      if (!validEmail(email)) throw new PortalError('Enter a valid email address.');
      if (body.website) throw new PortalError('Request could not be completed.');
      if (!['signup', 'login'].includes(body.mode)) throw new PortalError('Choose sign in or create account.');
      if (body.mode === 'signup' && (name.length < 2 || name.length > 100 || body.acceptedTerms !== true)) throw new PortalError('Enter your name and accept the terms.');
      const id = emailKey(email);
      const rateKey = `login-rate/${id}`;
      const rate = await store.getWithMetadata(rateKey, { type: 'json' });
      if (rate?.data?.at > Date.now() - 60_000) throw new PortalError('Please wait one minute before requesting another code.', 429);
      const limited = await store.setJSON(rateKey, { at: Date.now() }, rate?.etag ? { onlyIfMatch: rate.etag } : { onlyIfNew: true });
      if (!limited.modified) throw new PortalError('Please wait before requesting another code.', 429);
      const account = await store.get(`account/${id}`, { type: 'json' });
      const owner = email === String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
      const challenge = secretToken();
      if (account?.disabled || (!account && body.mode === 'login' && !owner)) return json({ challenge, message: 'If this email has access, a sign-in code is on its way.' });
      const code = String(randomInt(100000, 1000000));
      const key = `challenge/${hash(challenge)}`;
      await store.setJSON(key, { email, name: account?.name || name || 'Black Oak owner', signup: body.mode === 'signup' || owner, codeHash: hash(`${challenge}:${code}`), attempts: 0, used: false, expiresAt: Date.now() + 10 * 60_000, acceptedTermsAt: account?.acceptedTermsAt || (body.acceptedTerms === true ? new Date().toISOString() : null) }, { onlyIfNew: true });
      try {
        await sendEmail({ to: email, subject: 'Your Black Oak sign-in code', text: `Your Black Oak sign-in code is ${code}. It expires in 10 minutes. Never share this code.`, html: emailShell('Your sign-in code', `<p style="color:#b6b5ae">Use this code in the Black Oak partner sign-in screen:</p><p style="font-size:36px;letter-spacing:10px;color:#f1d48c">${escapeHtml(code)}</p><p style="color:#b6b5ae">Expires in 10 minutes. Never share this code. Ignore this email if you did not request it.</p>`), idempotencyKey: `partner-login-${hash(challenge)}` });
      } catch (error) { await store.delete(key); throw error; }
      return json({ challenge, message: 'Check your email for a six-digit sign-in code.' });
    }
    if (body.action === 'verify') {
      const challenge = await consumeChallenge(body.challenge, body.code, store);
      const id = emailKey(challenge.email);
      let account = await store.get(`account/${id}`, { type: 'json' });
      if (!account) {
        if (!challenge.signup) throw new PortalError('Create an account first.', 403);
        await store.setJSON(`account/${id}`, { id, email: challenge.email, name: challenge.name, verifiedAt: new Date().toISOString(), acceptedTermsAt: challenge.acceptedTermsAt, createdAt: new Date().toISOString() }, { onlyIfNew: true });
        account = await store.get(`account/${id}`, { type: 'json' });
      }
      if (account.disabled) throw new PortalError('This account is unavailable.', 403);
      await ensureReferral(account);
      const result = await createSession(account, store);
      return json({ signedIn: true }, 200, { 'set-cookie': result.cookie });
    }
    throw new PortalError('Unknown sign-in action.');
  } catch (error) {
    console.error('Partner sign-in failed:', error.name);
    const result = clientError(error); return json({ error: result.error }, result.status);
  }
}
