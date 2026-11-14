// Shared test helpers.
import { totpAt } from '../server/auth.mjs';

/** Super admins need two-step sign-in before they can work in any company (Nov 14, security review). Tests that sign up
 *  the owner email as the super admin turn it on straight after setup. `call(path, { method, body })` → { status, data }. */
export async function turnOnTwoStep(call) {
  const secret = (await call('/api/2fa/start', { method: 'POST' })).data?.secret;
  const r = await call('/api/2fa/enable', { method: 'POST', body: { code: totpAt(secret, Math.floor(Date.now() / 30000)) } });
  if (r.status !== 200) throw new Error('two-step sign-in didn’t turn on: ' + r.status);
  return secret;
}
