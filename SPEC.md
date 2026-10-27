# The Baldwin Training Book: spec

**Version:** 💼 an app to sell · **Client zero:** Baldwin Restaurant Group (The Baldwin, J.Baldwin's, Testa Barra)
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
- **Admin (`/admin`, Oct 27):** invite-only sign-in (owner + editors). Edit any page in place: click text to change it, replace any photo, add a video to any video slot. Every video is an uploaded file (MP4, MOV, WebM, up to 600 MB) or a YouTube link.
- **Recipes and house cocktails from a form:** each one gets its own page (built from the Short Rib and Fuschia Satin layouts), a row in the Food Matrix or on Cocktails, and shows in search.
- Videos and photos library, people (invites, remove), password change, activity log.

## v1 demo: Out
- Staff accounts, quizzes that score, sign-offs that save, progress tracking. Staff read without signing in.
- Adding whole new pages other than recipes and house cocktails (new classics, spirits and wine pages still come from Figma).
- Undo for a single page edit from the screen (the API supports it; no button yet).
- Real videos and dish photos until the Baldwin team uploads them (Unsplash stand-ins now).
- Multiple restaurant groups.

## Roles
Built: **Owner** (everything, plus people and activity) · **Editor** (edits content). Set up with `OWNER_EMAIL`; the owner invites the rest.

For the full product, not built yet:
- **New hire:** reads, watches, takes quizzes.
- **Manager:** assigns training, signs off dishes and steps.
- **Owner/admin:** edits content, menus and bar program.
- **Super admin:** Tommy only (see App Buildout Standard, stage 7).

## How the content gets here
`content/raw/` holds a full export of the Figma layout (auto-layout, text, colours, icons) and `public/img/` the original images.
`npm run content` turns it into one JSON file per screen; `src/components/FigmaNode.tsx` renders it.
To refresh after design changes, re-run the Figma export (see README).

## Data
- SQLite (`node:sqlite`) and uploaded files live in `DATA_DIR` (Railway volume at `/data`, 5 GB). Edits are stored as overrides on top of the design, keyed by layer names, so a re-export from Figma keeps them as long as layer names don't change.
