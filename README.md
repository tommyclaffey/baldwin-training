# Mise Academy

Menu, bar and service training for restaurant teams: a book of the menu, the bar, wine, beer and service, training programs with finals and certificates, job paths, team chat and a prep tracker, plus an admin at `/admin` where managers run their own book. Live at https://www.miseacademy.app. Was “The Baldwin Training Book” until Oct 28, 2026.

Every restaurant group is one account (a company with its stores). Every account gets the same app and the same features (the Foundation plan) in the Mise Academy look; a restaurant's own look is the Custom Brand plan. The first customer, Baldwin Restaurant Group, is one account on the Custom Brand plan. Its menu, documents, photos and its own pages are its account's content, kept on the server's volume, not in this repo (see *Account content*).

## Run it
```bash
npm install
npm run dev        # http://localhost:5181 (API on 4610, owner email owner@example.test)
npm test           # content checks + API tests on a temp database
npm run build && npm start   # production server on $PORT (default 8080)
```

## How it works
- `content/raw/layout*.json` is an export of every screen in Figma file `YEaa2NZIPbFqldCyUxrIEi`: frames, auto-layout, text styles, colours, icons (SVG) and image references.
- `public/img/` holds the original images, named by their Figma image hash.
- `scripts/build-content.mjs` writes one JSON per screen to `public/content/pages/`, plus `src/content/index.json` (routes and search), `svgs.json` and `sidebar.json`.
- `src/components/FigmaNode.tsx` turns each node into HTML: auto-layout becomes flexbox, fixed frames keep absolute positions.
- Layout: full design at 1440; laptops and tablets scale the page to fit and the sidebar becomes a menu; phones reflow rows into a single column.

## Server
- `server/index.mjs`: no dependencies. Sign-in (scrypt, HttpOnly cookie), invites, page edits, recipes and cocktails, uploads (streamed, Range support for video).
- `server/content.mjs` assembles each page: the design + added recipes/cocktails + saved edits. `server/templates.mjs` builds item pages from the Short Rib and Fuschia Satin layouts.
- `server/looks.mjs`: plans (`foundation`, `custom-brand`) and looks (`mise`, plus custom looks made for one company). `server/hq.mjs`: Mise Academy (HQ), Mise's own company, where a super admin works until they pick a customer.
- Env: `PORT`, `DATA_DIR` (database + uploads + account content), `OWNER_EMAIL` (the only email that can create the first company owner account), `SUPERADMIN_EMAIL` (that account becomes the primary super admin; on Railway it’s the same as `OWNER_EMAIL`). Email for Forgot Password?, invites and promotions (optional): `RESEND_API_KEY` + `MAIL_FROM`, see `docs/email.md`. `STORE_CAP`: how many stores an owner can add (default 25; 3 in a demo).

## Privacy, Terms and Help
`/privacy`, `/terms` and `/help` come from one file, `content/legal.md`: the words, plus four blanks at the top (`company`, `state`, `supportEmail`, `date`). While any blank is empty the pages aren't public (the public gets the usual "not found"; a super admin sees a preview marked "Draft · not public") and no links show. All four were filled Nov 16 (12 Tribes Media LLC, "doing business as Mise Academy"; Michigan; support@miseacademy.app; November 16, 2026), so they're public. Empty any one and they go back to hidden. Filled, they're public, with links on the sign-in screens, the book's sidebar, the admin and Your Account.

## Checks
- `node scripts/shots.mjs` (with the app running) screenshots screens at set widths and reports sideways overflow. `SCREENS=/,/classic/old-fashioned WIDTHS=1440,1024,390`.
- Add `?overflow` to any URL to list elements wider than the screen.

## Account content
A customer's own material lives in `DATA_DIR/accounts/<company id>/` on the volume (`server/account.mjs`): its menu seeds (`cms/`), its own versions of designed pages (`pages/`, e.g. Our Story and Floor Plan), its own program text (`programs/`) and the photos and logo those point at (`public/`, served at their `/img/` and `/icons/` addresses). Without the folder the app still starts: the database serves the account's book and the shared templates (`content/templates/`) fill the designed pages. Nothing is archived or deleted when a folder or a seed file is missing.
- Put a folder on the volume: `node scripts/account-content/copy-to-volume.mjs <folder> --company <id>` (makes a database snapshot first; `--local <DATA_DIR>` to try it).
- Tests give company 1 a made-up account (the demo's menu). `MISE_PRIVATE_ACCOUNT=<folder> npm test` runs them against a real account folder too, including the checks of that account's own content.

## Content status
Sample content is labelled on screen. Photos are Unsplash stand-ins (credited); video slots are marked "to film". Both demos (`/demo/brg`, `/demo/mise`) are made-up restaurants and say so.
