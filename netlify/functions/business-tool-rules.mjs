import { getToolsPool, runRules } from '../lib/business-tools.mjs';
import { json } from '../lib/referrals.mjs';

// Netlify scheduled functions are not exposed to public HTTP invocation.
export const config = { schedule: '35 * * * *' };
export default async function handler() {
  try { return json(await runRules(getToolsPool())); }
  catch (error) { console.error('Business-tool rules failed:', error.name, error.code || ''); return json({ error: 'Internal task rules could not run.' }, 503); }
}
