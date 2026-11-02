// Pulls each wine region and country page's content out of its Figma layout into content/wine/regions.json (Nov 1),
// so the new region design (Figma 377:2) can draw all of them from data.
import fs from 'node:fs';
const idx = JSON.parse(fs.readFileSync('src/content/index.json', 'utf8'));
const page = (f) => JSON.parse(fs.readFileSync(`public/content/pages/${f}.json`, 'utf8'));
const find = (n, name) => { if (!n) return null; if (n.n === name) return n; for (const c of n.c || []) { const r = find(c, name); if (r) return r; } return null; };
const texts = (n) => { const o = []; (function w(x) { if (!x) return; if (x.t === 'T') o.push(x.s); (x.c || []).forEach(w); })(n); return o; };
const kids = (n, pre) => (n?.c || []).filter((c) => (c.n || '').startsWith(pre));
const GRAPE = /^wine\/(red|white|rose|orange|sparkling)(\/|$)/;
const out = [], grapesOut = [];
for (const e of idx.filter((x) => /^wine\//.test(x.slug) && x.slug.split('/').length >= 2 && !/^wine\/(red|white|rose|orange|sparkling)$/.test(x.slug))) {
  const isGrape = GRAPE.test(e.slug);
  const p = page(e.file); const m = p.main;
  const hero = find(m, 'Hero'); const copy = find(hero, 'Copy');
  const ct = (copy?.c || []).filter((c) => c.t === 'T').map((c) => c.s);
  const stat = (k) => { const s = find(copy, k); return s ? texts(s)[1] || '' : ''; };
  const photo = (() => { let u = null; (function w(x) { if (!x || u) return; if (x.f && x.w >= 200 && x.h >= 200) { const f = x.f.find((y) => y.img); if (f) u = f.img; } (x.c || []).forEach(w); })(hero); return u; })();
  const where = find(m, 'Where it sits');
  const sibs = kids(find(where, 'Siblings'), 'Sibling · ').map((s) => ({ name: texts(s)[0], note: texts(s)[1], to: s.to || null, here: (s.f || []).some((f) => f.c === '#1E1C1A') }));
  const body = m.c.find((c) => c.n === 'Body');
  const taste = find(body, 'Taste');
  const pairs = kids(find(body, 'Pairs with'), 'Pair · ').map((x) => ({ name: texts(x)[0], why: texts(x)[1], to: x.to || null }));
  const grapes = kids(find(find(body, isGrape ? 'Where it grows' : 'Grapes grown here'), 'Links'), 'Link · ').map((x) => ({ name: texts(x)[0], to: x.to || null }));
  const brands = kids(find(find(body, 'Brands to know'), 'Brands'), 'Brand · ').map((x) => texts(x)[0]);
  const part = find(body, 'Back to parent');
  const sub = find(m, 'Sub nav');
  const nav = (sub?.c || []).map((x) => ({ label: texts(x)[0], name: texts(x)[1], to: x.to || null }));
  (isGrape ? grapesOut : out).push({
    slug: e.slug, file: e.file, name: ct[1] || e.title,
    pills: kids(find(copy, 'Tags'), 'Pill · ').map((x) => texts(x)[0]), script: ct[0], description: ct[2],
    stats: { keyGrape: stat('Key grape'), color: stat('Color'), climate: stat('Climate'), lookFor: stat('Look for') },
    facts: (find(copy, 'Stats')?.c || []).map((c) => ({ label: texts(c)[0], value: texts(c)[1] })),
    glass: texts(find(hero, 'Liquid'))[0] || null, photo,
    siblingsTitle: texts(where)[0] || null, siblings: sibs,
    taste: { flavors: kids(find(taste, 'Flavors'), 'Pill · ').map((x) => texts(x)[0]), line: (taste?.c || []).filter((c) => c.t === 'T').map((c) => c.s).pop() || '' },
    pairs, grapes, producers: brands, sayIt: texts(find(body, 'Say it'))[1] || '', goodToKnow: texts(find(find(body, 'Good to know'), 'Copy'))[1] || '',
    partOf: part ? { name: texts(part)[1], to: find(part, 'Row')?.to || part.to || null } : null, nav,
  });
}
fs.writeFileSync('content/wine/regions.json', JSON.stringify({ _source: 'Extracted Nov 1 2026 from the Figma region and country pages (scripts/extract-regions.mjs). Facts on France/Italy/USA pages written from memory (Oct 27); world and US-state pages from Wine Folly (Oct 31).', regions: out }, null, 1) + '\n');
fs.writeFileSync('content/wine/grapes.json', JSON.stringify({ _source: 'Extracted Nov 1 2026 from the Figma grape and style pages (scripts/extract-regions.mjs). Written from memory Oct 27 (Jeffrey to check).', grapes: grapesOut }, null, 1) + '\n');
console.log(out.length, 'regions,', grapesOut.length, 'grapes');
