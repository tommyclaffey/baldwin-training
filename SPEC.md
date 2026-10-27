# The Baldwin Training Book: spec

**Version:** 💼 an app to sell · **Client zero:** Baldwin Restaurant Group (The Baldwin, J.Baldwin's, Testa Barra)
**Stage:** 9 · Public demo (a read-only, clickable build of the Figma design)

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

## v1 demo: Out
- Accounts and sign-in, roles, quizzes that score, sign-offs that save, progress tracking.
- Editing content in the app (content comes from Figma for now).
- Real videos (slots are marked "to film"); real dish photos (Unsplash stand-ins).
- Multiple restaurant groups.

## Roles (for the full product, not built yet)
- **New hire:** reads, watches, takes quizzes.
- **Manager:** assigns training, signs off dishes and steps.
- **Owner/admin:** edits content, menus and bar program.
- **Super admin:** Tommy only (see App Buildout Standard, stage 7).

## How the content gets here
`content/raw/` holds a full export of the Figma layout (auto-layout, text, colours, icons) and `public/img/` the original images.
`npm run content` turns it into one JSON file per screen; `src/components/FigmaNode.tsx` renders it.
To refresh after design changes, re-run the Figma export (see README).
