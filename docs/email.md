# Email: turning on Forgot Password emails

Password reset works without email: an owner (People → Owners and Managers → **Reset Password**) or a super admin
(Super Admin → People → **Reset Password**) makes a one-time link and sends it by hand. It works once and expires in 24 hours.

**Forgot Password?** on the sign-in page only sends a link once email is set up. Until then it shows the same message and
sends nothing (the server logs a line, and the owner's Activity shows the ask).

## Turn it on (Resend)

1. Make an account at [resend.com](https://resend.com).
2. **Domains → Add Domain**: add the sending domain (e.g. `miseacademy.app`). Resend shows the DNS records to add
   (for SPF and DKIM). Add them exactly as shown at the domain's DNS host (GoDaddy), then press **Verify** in Resend.
   Mail only sends once the domain shows **Verified**.
3. **API Keys → Create API Key**, permission **Sending access**, limited to that domain. Copy it (shown once).
4. In Railway → the app's service → **Variables**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `MAIL_FROM` = the sender, on the verified domain, e.g. `Mise Academy <hello@miseacademy.app>`
5. Railway redeploys. Test: sign-in page → Forgot Password? → your own email.

Optional: `APP_URL` sets the address links point to (default `https://www.miseacademy.app`). Links never come from the
request's Host header.

## What the email is

From `MAIL_FROM`, subject "Reset your Mise Academy password": the person's first name, the link, "works once and expires in
24 hours", and "ignore this if you didn't ask". Plain text and a simple HTML version (`server/mail.mjs`).

## Limits

- 10 Forgot Password asks an hour per address (then "Too many tries"), 3 emails an hour per email address (past that the
  same message, nothing sent).
- The answer is the same for real and unknown emails, so nobody can find out who has an account.
- Staff aren't affected: they sign in with a PIN, and a manager uses **Reset PIN**.
- Switched off in the demo.
- A failed send is logged to the errors table, so the nightly ops check flags it.
