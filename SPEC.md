# Mise Academy: spec (was Lineup, and The Baldwin Training Book)

**Version:** 💼 an app to sell · **First customer:** Baldwin Restaurant Group (The Baldwin, J.Baldwin's, Testa Barra), one account on the Custom Brand plan
**Stage:** 9 · Public demo (a clickable build of the Figma design, with an admin for managers)

## Who it's for
- **New hires** at a full-service restaurant: servers, bartenders, hosts, runners.
- **Managers** who train them and sign them off.
- Read on a phone before a shift, or on a laptop during training.

## v1 demo: In
- Every screen in the Figma file (`YEaa2NZIPbFqldCyUxrIEi`, 222 desktop screens), rendered from the design and linked the same way as the prototype.
- The Book: Food Matrix, recipe (Short Rib), allergen guide, photo and video libraries.
- The Bar: cocktails (house + 20 classics), wine (5 styles, 3 countries, 46 grape/region pages, 6 service steps), beer (12 styles), spirits (15 categories, 79 sub-styles, liqueurs, bitters), bar basics (glassware, how guests order, shaken vs. stirred).
- Service: 9 steps of service, floor plan, safety, cleanliness. Company: Our Story.
- Search across every page. Phone, tablet and desktop layouts.
- **Admin (`/admin`, Oct 27):** invite-only sign-in (owner + editors). Videos are an uploaded file (MP4, MOV, WebM, up to 600 MB) or a YouTube link.
- **CMS (Oct 27):** pages are created and edited from a template form in the admin, never on the page itself. Collections so far: Classic Cocktails (22), House Cocktails (2), Recipes (every Food Matrix dish; a full recipe page is a toggle). Lists fill themselves: the classic strip on every classic page, the Classic cocktails and house tables on Cocktails, and the Food Matrix. Seeded from the design (`content/cms/*.json`, made by `scripts/cms/extract.mjs`); edits in the admin win over later seed changes.
- Videos and photos library, people (invites, remove), password change, activity log. Invites, promotions and Forgot Password? also go by email once Resend is set up (`docs/email.md`).

## v1 demo: Out
- Spirits, wine, beer, service and library pages still come from the design; they move into the CMS one page type at a time.
- Undo for a single page edit from the screen (the API supports it; no button yet).
- Real videos and dish photos until each restaurant uploads its own (Unsplash stand-ins now).
- Sign-up page and billing for new companies; prices for the plans.
- Prices and billing. Privacy, Terms and Help are written (`content/legal.md`) but stay hidden until their four blanks are filled.

## Roles (Oct 28)
- **Super admin:** Tommy (primary, set by `SUPERADMIN_EMAIL`) plus teammates he invites. Belongs to no company; sees and changes every company and person, signs in as someone for support (logged, banner shown), soft-deletes with 30 days to restore. Two-step sign-in (authenticator app) is required before the super admin opens. Only the primary adds or removes super admins. Hidden: everyone else gets “not found”.
- **Owner:** runs a company. Everything a manager does, plus inviting and removing owners and managers, and adding and renaming stores (Admin → Stores, Nov 16; up to 25).
- **Manager:** edits the book (CMS, media, wine videos, bottle scanner), signs people off, manages staff (reset PIN, remove) and the join code.
- **Staff:** reads the book and takes quizzes. Joins with the company’s join code, their name and a 4–6 digit PIN (5 wrong PINs locks that name for 15 minutes; a manager reset lets them pick a new one). Signed in for 90 days on their phone.
- **The book needs a sign-in.** Page files and the page index aren’t public anymore.
- **Companies (accounts):** each restaurant group is one company with its stores. People, quiz scores, sign-offs, sections, media and the activity log are per company, and tests prove companies can’t see each other. A new company starts with the shared library (classics, spirits, wine, beer, service, safety) and an empty menu, and adds its own. Baldwin Restaurant Group is company 1; its menu, documents, photos and own pages are its account content on the volume (`DATA_DIR/accounts/1`), not in this repo, and a test sweeps another company's whole book for anything of BRG's.
- **Plans and looks (Nov 16):** every company is on the Foundation plan (every feature) in the Mise Academy look. A restaurant's own look (logo, colours, type) comes with the Custom Brand plan, set by a super admin in Super Admin → Companies. The Baldwin's look is the first custom look; The Baldwin's demo (`/demo/brg`) shows it off with a made-up menu.
- **Mise Academy (HQ):** Mise's own company. A super admin works there until they pick a customer (Work Here), sees the book a new customer sees, and Mise's team will live there. Never shown to customers, never deleted.
## How the content gets here
`content/raw/` holds a full export of the Figma layout (auto-layout, text, colours, icons) and `public/img/` the original images.
`npm run content` turns it into one JSON file per screen; `src/components/FigmaNode.tsx` renders it.
To refresh after design changes, re-run the Figma export (see README).

## Data
- SQLite (`node:sqlite`) and uploaded files live in `DATA_DIR` (Railway volume at `/data`, 5 GB). Edits are stored as overrides on top of the design, keyed by layer names, so a re-export from Figma keeps them as long as layer names don't change.
