// One-time: reads the designed pages and writes CMS seed entries (content/cms/*.json).
// After this, the CMS is where content lives; Figma holds the templates.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'src/content/index.json'), 'utf8'));
const page = (file) => JSON.parse(fs.readFileSync(path.join(root, 'public/content/pages', file + '.json'), 'utf8'));
const find = (n, p) => { if (p(n)) return n; for (const c of n.c || []) { const r = find(c, p); if (r) return r; } return null; };
const findAll = (n, p, out = []) => { if (p(n)) out.push(n); for (const c of n.c || []) findAll(c, p, out); return out; };
const byName = (s) => (n) => n.n === s;
const texts = (n) => findAll(n, (x) => x.t === 'T').map((t) => t.s);
const imgOf = (n) => n?.f?.find((f) => f.img)?.img || '';

/* ---------- classic cocktails ---------- */
const FAMILY = { 'Stirred · spirit-forward': 'Stirred', 'Shaken · sours and more': 'Shaken', 'Tall and bubbly': 'Tall' };
const classics = index.filter((e) => e.slug.startsWith('classic/'));
const hub = page('14-2');
const dotColor = {};
for (const chip of findAll(page(classics[0].file).main, (n) => /^Classic · /.test(n.n || '') && n.c)) {
  const dot = find(chip, (x) => x.t === 'E'); if (dot?.f?.[0]?.c) dotColor[chip.n.slice(10)] = dot.f[0].c;
}
// The active chip on each page carries that page's own dot colour.
for (const e of classics) {
  const chip = find(page(e.file).main, (n) => n.n === 'Classic · ' + e.title && n.c);
  const dot = chip && find(chip, (x) => x.t === 'E');
  if (dot?.f?.[0]?.c && !dotColor[e.title]) dotColor[e.title] = dot.f[0].c;
}
const order = [];
const groups = find(hub.main, byName('Section · Classic cocktails'));
for (const r of (groups.c || []).filter((c) => (c.n || '').startsWith('Classic row · '))) order.push(r.n.slice(14));

const classicSeed = classics.map((e) => {
  const m = page(e.file).main;
  const hero = find(m, byName('Hero'));
  const copy = find(hero, byName('Copy'));
  const ct = (copy.c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const tags = find(hero, byName('Tags'));
  const fam = texts(tags.c[1])[0];
  const stat = (k) => texts(find(find(copy, byName('Stats')), byName(k)))[1] || '';
  const tiles = (find(find(m, byName('Build band')), byName('Ingredients')).c || []);
  const build = tiles.map((t, i) => { const x = texts(t); return { amount: x[0], ingredient: x[1], spirit: i === 0 && x.includes('THE SPIRIT'), link: t.to || '' }; });
  const how = find(m, byName('How to make it'));
  const steps = (how.c || []).filter((c) => /^Step \d+$/.test(c.n || '')).map((r) => texts(r)[1]);
  const taste = find(m, byName('Taste'));
  const flavors = (find(taste, byName('Flavors')).c || []).map((p) => texts(p)[0]);
  const tl = (taste.c || []).filter((c) => c.t === 'T');
  const riffs = (find(m, byName('Riffs')).c || []).filter((c) => (c.n || '').startsWith('Riff · ')).map((r) => { const x = texts(r); return { name: x[0], note: x[1] || '', link: r.to || '' }; });
  const fs_ = find(m, byName('Featured spirit'));
  const fst = (fs_.c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const btn = find(fs_, byName('Button · Learn spirit'));
  const pour = texts(find(fs_, byName('Our pour')) || {})[1] || '';
  const links = (find(find(m, byName('What’s in it')), byName('Links')).c || []).map((l) => ({ label: texts(l)[0], link: l.to || '' }));
  const say = texts(find(m, byName('Say it')))[1] || '';
  const story = find(m, byName('The story'));
  const sc = (find(story, byName('Copy')).c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const slot = find(story, (n) => (n.n || '').startsWith('Video slot'));
  const row = find(hub.main, byName('Classic row · ' + e.title));
  const gcard = find(m, byName('The glass'));
  const egg = find(hero, (n) => (n.n || '').startsWith('Pill · Contains'));
  const anote = find(m, byName('Allergen note'));
  const rt = row ? texts(row) : [];
  return {
    key: e.slug,
    slug: e.slug,
    data: {
      name: e.title, family: FAMILY[fam] || 'Shaken', tagline: ct[0], description: ct[2],
      photo: imgOf(find(hero, (n) => (n.n || '').startsWith('IMG/'))), photoCredit: (find(hero, (n) => (n.n || '').startsWith('IMG/')).n || '').replace(/^IMG\/[^·]*·\s*/, ''),
      color: dotColor[e.title] || '#C49A6C',
      glass: stat('Glass'), method: stat('Method'), ice: stat('Ice'), garnish: stat('Garnish'),
      tableBase: rt[2] || '',
      build, steps, flavors, tasteLine: tl[tl.length - 1]?.s || '', riffs,
      spiritName: fst[1] || '', spiritLine: fst[2] || '', spiritLinkLabel: btn ? texts(btn)[0] : '', spiritLink: btn?.to || '', pour,
      links, say, story: sc[sc.length - 1] || '', video: slot?.vid || null,
      glassCard: gcard ? texts(find(gcard, byName('Top')))[0] : '',
      allergyTag: egg ? texts(egg)[0] : '', allergyNote: anote ? texts(anote).join(' ') : '',
    },
    sort: order.indexOf(e.title),
  };
}).sort((a, b) => a.sort - b.sort);

// Keep videos already in the seed (they were placed before the CMS existed).
const oldSeed = fs.existsSync(path.join(root, 'content/cms/classic.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'content/cms/classic.json'), 'utf8')) : [];
for (const c of classicSeed) { const o = oldSeed.find((x) => x.key === c.key); if (!c.data.video && o?.data.video) c.data.video = o.data.video; }
// The Pisco Sour has raw egg white too.
const ps = classicSeed.find((c) => c.data.name === 'Pisco Sour');
if (ps && !ps.data.allergyTag) Object.assign(ps.data, { allergyTag: 'Contains egg white', allergyNote: 'Egg white is raw. Ask every guest, and note it on the ticket.' });
fs.writeFileSync(path.join(root, 'content/cms/classic.json'), JSON.stringify(classicSeed, null, 1));
console.log('classics:', classicSeed.length, classicSeed.map((c) => `${c.data.name}(${c.data.family}, ${c.data.build.length} build, video ${c.data.video ? 'yes' : 'no'})`).join(', '));

/* ---------- house cocktails (same layout as classics, plus the tasting) ---------- */
const houseSeed = ['87-12', '87-440'].map((file, i) => {
  const e = index.find((x) => x.file === file);
  const m = page(file).main;
  const hero = find(m, byName('Hero'));
  const copy = find(hero, byName('Copy'));
  const ct = (copy.c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const stat = (k) => texts(find(find(copy, byName('Stats')), byName(k)))[1] || '';
  const tiles = (find(m, byName('Ingredients')).c || []);
  const build = tiles.map((t, j) => { const x = texts(t); return { amount: x[0], ingredient: x[1], spirit: x.includes('THE SPIRIT'), link: t.to || '' }; });
  const steps = (find(m, byName('How to make it')).c || []).filter((c) => /^Step \d+$/.test(c.n || '')).map((r) => texts(r)[1]);
  const taste = find(m, byName('Taste'));
  const tl = (taste.c || []).filter((c) => c.t === 'T');
  const tasting = find(m, byName('From the tasting'));
  const st = texts(find(tasting, byName('Score')));
  const status = /Status: ([^·]+)·\s*Pairs with: (.*)$/.exec(st[2] || '') || [];
  const fs_ = find(m, byName('Featured spirit'));
  const fst = (fs_.c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const btn = find(fs_, byName('Button · Learn spirit'));
  const story = find(m, byName('The story'));
  const sc = (find(story, byName('Copy')).c || []).filter((c) => c.t === 'T').map((t) => t.s);
  const trow = texts(find(find(hub.main, byName('Cocktail matrix')), byName('Row · ' + e.title)) || {});
  return {
    key: e.slug, slug: e.slug, sort: i, table: { tableLine: trow[1] || '', tableIce: trow[4] || '' },
    data: {
      name: e.title, tagline: ct[0], description: ct[2], photo: imgOf(find(hero, (n) => (n.n || '').startsWith('IMG/'))),
      glass: stat('Glass'), method: stat('Method'), ice: stat('Ice'), garnish: stat('Garnish'),
      build, steps, tags: (find(taste, byName('Flavors')).c || []).map((p) => texts(p)[0]), tasteLine: tl[tl.length - 1]?.s || '',
      score: st[0] === '—' ? '' : st[0], status: (status[1] || '').trim(), pairs: (status[2] || '').trim() === 'Ask the bar' ? '' : (status[2] || '').trim(),
      note: texts(find(tasting, byName('Note')))[0] || '',
      spiritName: fst[1] || '', spiritLine: fst[2] || '', spiritLinkLabel: btn ? texts(btn)[0] : '', spiritLink: btn?.to || '',
      say: texts(find(m, byName('Say it')))[1] || '', story: sc[sc.length - 1] || '', video: null,
    },
  };
}).map(({ table, ...h }) => ({ ...h, data: { ...h.data, ...table } }));
fs.writeFileSync(path.join(root, 'content/cms/house.json'), JSON.stringify(houseSeed, null, 1));
console.log('house:', houseSeed.map((h) => h.data.name).join(', '));

/* ---------- recipes: every dish in the Food Matrix; the Short Rib has a full page ---------- */
const matrix = find(page('13-2').main, byName('Matrix table'));
let course = 'Plates';
const COURSE = { 'Group · PASSED BITES': 'Passed Bites', 'Group · PLATES': 'Plates', 'Group · DESSERT': 'Dessert', 'Group · BAR': 'Bar' };
const recipeSeed = [];
for (const r of matrix.c || []) {
  if (COURSE[r.n]) { course = COURSE[r.n]; continue; }
  if (!(r.n || '').startsWith('Row · ') || course === 'Bar') continue;
  const dish = find(r, byName('Dish'));
  const dt = texts(dish);
  const refining = dt.includes('Being refined');
  const desc = dt.filter((t) => t !== dt[0] && t !== 'Being refined')[0] || '';
  const val = (k) => texts(find(r, byName(k)) || {})[0] || '';
  recipeSeed.push({
    key: 'recipe/' + r.n.slice(6).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    slug: 'recipe/' + r.n.slice(6).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    sort: recipeSeed.length,
    data: {
      name: dt[0], course, description: desc === 'Chef to add description' ? '' : desc, photo: imgOf(find(r, (n) => (n.n || '').startsWith('IMG/'))),
      station: val('Station'), allergens: texts(find(r, byName('Allergens')) || {}).filter((a) => a !== 'None listed'),
      pairing: val('Pairing') === '—' ? '' : val('Pairing'), score: val('Tasting'), refining, fullPage: false,
    },
  });
}
// Short Rib: the full recipe page.
{
  const m = page('9-2').main;
  const sr = recipeSeed.find((x) => x.data.name === 'Short Rib');
  const header = find(m, byName('Header'));
  const info = find(header, byName('Info'));
  const comps = (find(m, byName('Components')).c || []).filter((c) => (c.n || '').startsWith('Row · ')).map((row) => { const t = texts(row); return { component: t[0], portion: t[1], hold: t[2] }; });
  const steps = (find(m, byName('Steps')).c || []).filter((c) => /^Step \d+$/.test(c.n || '')).map((row) => { const t = texts(row); return { title: t[1], detail: t[2], time: t[3] || '' }; });
  const plating = (find(m, byName('Legend')).c || []).map((k) => { const s2 = texts(k)[1] || ''; const [nm, ...rest] = s2.split('  '); return { name: nm, note: rest.join('  ') }; });
  const table = find(m, byName('At the table'));
  const pairT = texts(find(table, byName('Pairing')));
  const watch = find(m, byName('Watch it made'));
  const player = find(watch, byName('Player'));
  const wc = (find(watch, byName('Copy')).c || []).filter((c) => c.t === 'T').map((t) => t.s);
  Object.assign(sr.data, {
    fullPage: true, signature: true, tagline: texts(find(info, byName('Titles')))[0],
    photo: imgOf(find(header, (n) => (n.n || '').startsWith('IMG/'))),
    stats: (find(info, byName('Stats')).c || []).map((st) => { const t = texts(st); return { value: t[0], label: t[1] }; }),
    components: comps, steps, plating, platePhoto: imgOf(find(find(m, byName('Plate photo')), (n) => (n.n || '').startsWith('IMG/'))),
    say: texts(table)[1], pairingNote: pairT[2] || '',
    videoTitle: texts(player).find((t) => t.includes('·')) || '', videoStill: imgOf(find(player, (n) => (n.n || '').startsWith('IMG/'))),
    videoHeading: wc[1], videoNote: wc[2], videoDuration: (texts(player).find((t) => t.includes(' / ')) || '').split(' / ')[1] || '',
    chapters: (find(watch, byName('Chapters')).c || []).map((ch) => { const t = texts(ch); return { time: t[0], label: t[1] }; }),
    photos: (find(find(m, byName('Section · Photos')), byName('Photos')).c || []).map((ph) => ({ img: imgOf(find(ph, (n) => (n.n || '').startsWith('IMG/'))), caption: texts(ph)[0] })),
    video: null,
  });
}
fs.writeFileSync(path.join(root, 'content/cms/recipe.json'), JSON.stringify(recipeSeed, null, 1));
console.log('recipes:', recipeSeed.map((r) => `${r.data.name} (${r.data.course}${r.data.fullPage ? ', full page' : ''})`).join(', '));
