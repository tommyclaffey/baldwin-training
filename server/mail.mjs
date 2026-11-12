// Email (Nov 11): only the Forgot Password? link sends mail, through Resend's HTTP API (plain fetch, no package).
// Off until both Railway variables are set: RESEND_API_KEY (from resend.com → API Keys) and MAIL_FROM
// (e.g. "Mise Academy <hello@miseacademy.app>", on a domain verified in Resend). See docs/email.md.
// APP_URL is the address links point to (default https://www.miseacademy.app). Links never use the request's Host header,
// so a forged Host can't send someone a reset link to another site.

const API = process.env.RESEND_API_URL || 'https://api.resend.com/emails'; // tests point this at a fake
export const APP_URL = (process.env.APP_URL || 'https://www.miseacademy.app').replace(/\/+$/, '');
export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail({ to, subject, text, html }) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The reset email: who it's for, the link, and when it stops working. */
export function resetEmail({ name, email, url, hours }) {
  const first = String(name || '').split(' ')[0] || 'there';
  const subject = 'Reset your Mise Academy password';
  const text = [
    `Hi ${first},`,
    '',
    `Someone asked to reset the password for your Mise Academy account (${email}). Pick a new one here:`,
    '',
    url,
    '',
    `The link works once and expires in ${hours} hours. If you didn’t ask for this, ignore this email and your password stays the same.`,
    '',
    'Mise Academy',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1b18">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5c564d">Mise Academy</p>
<p style="margin:0 0 12px;font-size:16px;line-height:1.5">Hi ${esc(first)},</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">Someone asked to reset the password for your Mise Academy account (${esc(email)}). Pick a new one here:</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#1d1b18;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Pick a New Password</a></p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#5c564d">The link works once and expires in ${hours} hours. If you didn’t ask for this, ignore this email and your password stays the same.</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#5c564d;word-break:break-all">${esc(url)}</p>
</div></body></html>`;
  return { subject, text, html };
}
