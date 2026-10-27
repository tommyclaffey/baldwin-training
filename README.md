# The Baldwin Training Book

Menu, bar and service training for Baldwin Restaurant Group. This repo is the **live demo**: a clickable build of the Figma design, with every screen, every link and search.

## Run it
```bash
npm install
npm run dev        # http://localhost:5181
npm test           # content checks: links, images, every page reachable
npm run build && npm start   # production server on $PORT (default 8080)
```

## How it works
- `content/raw/layout*.json` is an export of every screen in Figma file `YEaa2NZIPbFqldCyUxrIEi`: frames, auto-layout, text styles, colours, icons (SVG) and image references.
- `public/img/` holds the original images, named by their Figma image hash.
- `scripts/build-content.mjs` writes one JSON per screen to `public/content/pages/`, plus `src/content/index.json` (routes and search), `svgs.json` and `sidebar.json`.
- `src/components/FigmaNode.tsx` turns each node into HTML: auto-layout becomes flexbox, fixed frames keep absolute positions.
- Layout: full design at 1440; laptops and tablets scale the page to fit and the sidebar becomes a menu; phones reflow rows into a single column.

## Checks
- `node scripts/shots.mjs` (with the app running) screenshots screens at set widths and reports sideways overflow. `SCREENS=/,/classic/old-fashioned WIDTHS=1440,1024,390`.
- Add `?overflow` to any URL to list elements wider than the screen.

## Content status
Sample content is labelled on screen. Photos are Unsplash stand-ins; video slots are marked "to film". Recipes, pours, wine list and policies wait on the Baldwin team.
