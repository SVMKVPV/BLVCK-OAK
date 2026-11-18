import { json } from './referrals.mjs';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileToken(body) {
  return String(body?.turnstileToken || body?.['cf-turnstile-response'] || '').slice(0, 2048);
}

// Spam check for public forms. Disabled until TURNSTILE_SECRET_KEY is configured.
export async function verifyTurnstile(body, context = {}, { fetchImpl = fetch } = {}) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return null;
  const token = turnstileToken(body);
  if (!token) return json({ error: 'Complete the spam check and try again.' }, 400);
  const form = new URLSearchParams({ secret, response: token });
  if (context?.ip) form.set('remoteip', String(context.ip));
  try {
    const response = await fetchImpl(VERIFY_URL, { method: 'POST', body: form });
    const result = await response.json();
    if (result?.success === true) return null;
  } catch (error) {
    console.error('Turnstile verification failed:', error.message);
    return json({ error: 'Spam check is temporarily unavailable. Please try again.' }, 503);
  }
  return json({ error: 'Spam check failed. Refresh the page and try again.' }, 400);
}
