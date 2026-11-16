# Email: Forgot Password and invites

Everything works without email: every link the app makes (invites, password resets) is shown with
**Copy Link**, to send by hand. Once email is set up, the app also sends these itself:

- **Forgot Password?** on the sign-in page (since Nov 11). Until email is set up it shows the same message and sends nothing
  (the server logs a line, and the owner's Activity shows the ask).
- **Invites** (since Nov 16): an owner's invite to an owner or manager (People → Add a Person, or Owners, Managers and
  Invites), a super admin's owner invite (Super Admin → Companies → Add Company with an owner's email, or Invite Owner),
  and a Mise team invite (Super Admin → Mise Team).
- **Promote to Manager** sends nothing: since Nov 16 it happens straight away (the person keeps their PIN sign-in). Promotion
  links made before that still work until they expire.

After an invite the screen says **"Email sent to …"**, with the link and Copy Link still there. Without email
set up, the buttons say **Create Invite Link** and the screen says "Email isn't set up yet, so it wasn't emailed". Password
reset links an owner or super admin makes (Reset Password) are still copied by hand.

## Turn it on (Resend)

1. Make an account at [resend.com](https://resend.com).
2. **Domains → Add Domain**: add the sending domain (e.g. `miseacademy.app`). Resend shows the DNS records to add
   (for SPF and DKIM). Add them exactly as shown at the domain's DNS host (GoDaddy), then press **Verify** in Resend.
   Mail only sends once the domain shows **Verified**.
3. **API Keys → Create API Key**, permission **Sending access**, limited to that domain. Copy it (shown once).
4. In Railway → the app's service → **Variables**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `MAIL_FROM` = the sender, on the verified domain, e.g. `Mise Academy <hello@miseacademy.app>`
5. Railway redeploys. Test: sign-in page → Forgot Password? → your own email. Then invite yourself from People (use an
   address with no account) and check that "Email sent to …" shows and the email arrives.

Optional: `APP_URL` sets the address links point to (default `https://www.miseacademy.app`). Links never come from the
request's Host header.

## What the emails are

All from `MAIL_FROM`, plain text plus a simple HTML version in the same look (`server/mail.mjs`), each naming the restaurant:

- **Reset:** "Reset your password for The Baldwin on Mise Academy": first name, the link, "works once and expires in 24
  hours", "ignore this if you didn't ask".
- **Invite:** "You're invited to The Baldwin on Mise Academy" (the store for a store manager, else the company): who sent
  it, the role (owner or manager), an **Accept Invite** button, "works once and expires in 14 days". A Mise team invite says
  "You're invited to the Mise Academy team" and names no restaurant.

## Limits

- Forgot Password?: 10 asks an hour per address (then "Too many tries"), 3 emails an hour per email address (past that the
  same message, nothing sent). The answer is the same for real and unknown emails, so nobody can find out who has an account.
- Invites: 3 emails an hour per email address and 30 an hour per sender. Past that the link is still made,
  and the screen says it wasn't emailed.
- Staff aren't affected: they sign in with a PIN, and a manager uses **Reset PIN**.
- Never in a demo: Forgot Password? and invites are switched off there.
- A failed send is logged to the errors table, so the nightly ops check flags it; the invite screen says it didn't go
  through, and the link is there to copy.
