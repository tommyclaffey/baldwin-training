// Wine region and country pages in the approved layout (Nov 1; Figma 377:2 "Loire v2", layout 142):
// a photo first, "What They Make" (sourced styles), style dots on every neighbouring region, the key grape's profile,
// then the page's own taste, pairings, grapes, producers and the video. Content: content/wine/regions.json (taken from
// the old pages), content/wine/research/batch-*.json (styles + photos, with sources), content/wine/grape-profiles.json.
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, texts, setText, remove, fitTitle } from './templates.mjs';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../content/wine');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
let cache;
function data() {
  if (cache) return cache;
  const regions = new Map((readJson('regions.json', { regions: [] }).regions || []).map((r) => [r.slug, r]));
  const research = new Map();
  let files = [];
  try { files = fs.readdirSync(path.join(DIR, 'research')).filter((f) => /^batch-\d+\.json$/.test(f)); } catch { /* none yet */ }
  for (const f of files) for (const r of readJson('research/' + f, { regions: [] }).regions || []) research.set(r.slug, r);
  const grapes = readJson('grape-profiles.json', { grapes: [] }).grapes || [];
  // grape and style pages (Nov 1): same renderer, the Cabernet design (Figma 111:4)
  for (const g of readJson('grapes.json', { grapes: [] }).grapes || []) regions.set(g.slug, { ...g, isGrape: true });
  for (const r of readJson('research/grapes.json', { pages: [] }).pages || []) research.set(r.slug, r);
  return (cache = { regions, research, grapes });
}
export const regionData = (slug) => data().regions.get(slug);
export const regionResearch = (slug) => data().research.get(slug);

export const STYLE_COLORS = { Red: '#6B1F2E', White: '#E6DCA0', 'Rosé': '#EEBFAE', Sparkling: '#F6EFD6', Sweet: '#C98F2E' };
const STYLE_ORDER = ['Red', 'White', 'Rosé', 'Sparkling', 'Sweet'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const T = (n) => (n?.c || []).filter((c) => c.t === 'T');
const styleName = (s) => { const k = STYLE_ORDER.find((x) => norm(x) === norm(s)); return k || null; };

/** The key grape's profile (Wine Folly), by name or alias. */
function profileFor(grapeName) {
  const g = norm(grapeName);
  return data().grapes.find((x) => [x.name, ...(x.aka || [])].some((n) => norm(n) === g || (g.length > 4 && norm(n).startsWith(g))));
}
function slugOf(to) { return to && to.startsWith('/') ? to.slice(1) : null; }

export function regionPage(tpl, base, slug, ctx) {
  const d = regionData(slug);
  if (!d || !tpl) return null;
  const rs = regionResearch(slug);
  const main = clone(tpl.main);
  // the page keeps its own top bar and breadcrumb
  for (const keep of ['Top bar', 'Breadcrumb']) {
    const mine = base?.main?.c?.find((c) => c.n === keep); const at = main.c.findIndex((c) => c.n === keep);
    if (mine && at >= 0) main.c[at] = clone(mine);
  }

  // hero: the photo, pills, name, line, four facts
  const hero = find(main, byName('Hero'));
  const img = find(hero, (n) => (n.n || '').startsWith('IMG/'));
  const photo = rs?.photo?.file || d.photo;
  if (img) { if (photo) { img.f = [{ img: photo, m: 'FILL' }]; img.n = 'IMG/' + d.name + (rs?.photo ? ` · ${rs.photo.photographer} · Unsplash (stand-in)` : ''); } else remove(hero, find(hero, byName('Liquid'))); }
  const copy = find(hero, byName('Copy'));
  const tags = find(copy, byName('Tags'));
  if (tags) { const protos = tags.c; tags.c = (d.pills || []).slice(0, 2).map((p, i) => { const c = clone(protos[Math.min(i, protos.length - 1)]); c.n = 'Pill · ' + p; setText(texts(c)[0], p); return c; }); }
  const ct = T(copy);
  setText(ct[0], d.script || ''); if (!d.script) copy.c = copy.c.filter((x) => x !== ct[0]);
  fitTitle(ct[1], d.name.toUpperCase(), 600);
  setText(ct[2], d.description || '');
  const styles = (rs?.styles || []).map((s) => ({ ...s, style: styleName(s.style) })).filter((s) => s.style);
  const stats = find(copy, byName('Stats'));
  if (d.isGrape && stats) {
    // the grape's four quick facts, as on its old page (body, color, tannin, serve at)
    stats.c = stats.c.slice(0, (d.facts || []).length).map((cell, i) => { const t = texts(cell); setText(t[0], d.facts[i].label); setText(t[1], d.facts[i].value); return cell; });
  }
  const setStat = (name, label, value) => { const s = find(stats, byName(name)); if (!s) return; if (!value) { stats.c = stats.c.filter((x) => x !== s); return; } const t = texts(s); setText(t[0], label); setText(t[1], value); };
  const keyGrapes = d.stats.keyGrape || (d.grapes || []).slice(0, 2).map((g) => g.name).join(', ');
  if (!d.isGrape) {
    setStat('Key grape', /,/.test(keyGrapes) ? 'KEY GRAPES' : 'KEY GRAPE', keyGrapes);
    setStat('Color', styles[0]?.main ? 'MAIN COLOR' : 'COLOR', styles[0]?.main ? (styles[0].style === 'Sparkling' ? 'Sparkling' : styles[0].style) : d.stats.color);
    setStat('Climate', 'CLIMATE', d.stats.climate);
    setStat('Look for', 'LOOK FOR', d.stats.lookFor);
  }

  // what they make
  const make = find(main, byName('What they make'));
  if (make && styles.length) {
    const head = find(make, byName('Head')); const ht = T(head);
    setText(ht[1], styles[0].main ? `Most made first. ${d.name.charAt(0) + d.name.slice(1).toLowerCase()} is known for ${styles.length > 1 ? 'more than one style' : 'one style'}.` : 'The styles this place is known for.');
    const row = find(make, byName('Styles')); const dark = row.c[0], light = row.c[1];
    row.c = styles.map((s, i) => {
      const isMain = i === 0 && s.main; const c = clone(isMain ? dark : light); c.n = 'Style · ' + s.style;
      const top = find(c, byName('Top'));
      const dot = top.c.find((x) => (x.n || '').startsWith('Dot · ')); dot.n = 'Dot · ' + s.style; dot.f = [{ c: STYLE_COLORS[s.style] }];
      if (s.style === 'White' || s.style === 'Sparkling') { dot.st = '#B8A76A'; dot.sw = 1; } else { delete dot.st; delete dot.sw; }
      setText(T(top)[0], s.style);
      const pill = find(top, (x) => (x.n || '').startsWith('Pill · '));
      if (pill) { if (isMain) setText(texts(pill)[0], s.share ? s.share.toUpperCase() : 'MAIN'); else top.c = top.c.filter((x) => x !== pill); }
      setText(T(c)[0], s.examples || '');
      return c;
    });
  } else if (make) remove(main, make);

  // where it sits: every neighbour with its own style dots
  const where = find(main, byName('Where it sits'));
  const sibsNode = find(where, byName('Siblings'));
  if (where && (d.siblings || []).length > 1) {
    setText(T(where)[0], d.siblingsTitle || 'WHERE IT SITS');
    const here = sibsNode.c.find((x) => x.f?.[0]?.c === '#1E1C1A'); const other = sibsNode.c.find((x) => x !== here);
    const width = Math.floor((sibsNode.w - 8 * 5) / 6);
    sibsNode.c = d.siblings.map((s) => {
      const c = clone(s.here ? here : other); c.n = 'Sibling · ' + s.name; if (s.to) c.to = s.to; else delete c.to;
      c.w = width;
      setText(T(find(c, byName('Top')))[0], s.name); setText(T(c)[0], s.note || '');
      const dots = c.c.find((x) => (x.n || '').startsWith('Styles · '));
      const sst = (regionResearch(slugOf(s.to) || slug)?.styles || []).map((x) => styleName(x.style)).filter(Boolean);
      const own = s.here ? styles.map((x) => x.style) : sst;
      if (dots) { if (own.length) { const proto = dots.c[0]; dots.c = own.map((st) => { const e = clone(proto); e.n = 'Dot · ' + st; e.f = [{ c: STYLE_COLORS[st] }]; if (st === 'White' || st === 'Sparkling') { e.st = '#B8A76A'; e.sw = 1; } else { delete e.st; delete e.sw; } return e; }); dots.n = 'Styles · ' + own.join(', '); } else c.c = c.c.filter((x) => x !== dots); }
      return c;
    });
  } else if (where) remove(main, where);

  // the key grape's profile
  const prof = find(main, byName('Section · The profile'));
  const firstGrape = d.isGrape ? d.name : (keyGrapes || '').split(/,| and /)[0].trim() || d.grapes?.[0]?.name;
  const pf = firstGrape && profileFor(firstGrape);
  if (prof && pf) {
    const head = find(prof, byName('Head'));
    setText(T(head)[0], d.isGrape ? `Where ${pf.name} sits on the four scales · Wine Folly` : `Where ${d.name.charAt(0) + d.name.slice(1).toLowerCase()} ${pf.name} sits on the four scales · Wine Folly`);
    const letter = pf.name.charAt(0).toUpperCase();
    for (const [scale, key] of [['Scale · BODY', 'body'], ['Scale · SWEETNESS', 'sweetness'], ['Scale · ACIDITY', 'acidity'], ['Scale · TANNIN', 'tannin']]) {
      const sc = find(prof, byName(scale)); const bar = find(sc, byName('Bar')); const track = find(bar, byName('Track'));
      const m = bar.c.find((x) => (x.n || '').startsWith('Marker'));
      const v = pf.scale?.[key];
      if (v == null) { bar.c = bar.c.filter((x) => x !== m); continue; }
      m.n = 'Marker · ' + pf.name; setText(texts(m)[0], letter);
      m.x = Math.round(Math.max(track.x - 2, Math.min(track.x + track.w - m.w + 2, track.x + v * track.w - m.w / 2)));
    }
  } else if (prof) remove(main, prof);

  // the page's own taste, pairings, grapes and producers
  const body = main.c.find((c) => c.n === 'Body');
  const taste = find(body, byName('Taste'));
  if (taste && (d.taste?.flavors || []).length) {
    const fl = find(taste, byName('Flavors')); const pp = fl.c[0];
    fl.c = d.taste.flavors.map((f) => { const c = clone(pp); c.n = 'Pill · ' + f; setText(texts(c)[0], f); return c; });
    setText(T(taste).pop(), d.taste.line || '');
  } else if (taste) remove(body, taste);
  const pairs = find(body, byName('Pairs with'));
  if (pairs && (d.pairs || []).length) {
    const protos = pairs.c.filter((x) => (x.n || '').startsWith('Pair · ')); const at = pairs.c.indexOf(protos[0]);
    const built = d.pairs.map((p, i) => { const c = clone(protos[Math.min(i, protos.length - 1)]); c.n = 'Pair · ' + p.name; if (p.to) c.to = p.to; const t = texts(c); setText(t[0], p.name); setText(t[1], p.why || ''); return c; });
    pairs.c = [...pairs.c.slice(0, at).filter((x) => !protos.includes(x)), ...built, ...pairs.c.slice(at).filter((x) => !protos.includes(x))];
  } else if (pairs) remove(body, pairs);
  const gg = find(body, byName('Grapes grown here')) || find(body, byName('Where it grows'));
  if (gg && (d.grapes || []).length) {
    const links = find(gg, byName('Links')); const linked = links.c.find((x) => x.c?.length > 1) || links.c[0]; const plain = links.c.find((x) => !(x.c?.length > 1)) || links.c[0];
    links.c = d.grapes.map((g) => { const c = clone(g.to ? linked : plain); c.n = 'Link · ' + g.name; if (g.to) c.to = g.to; else delete c.to; setText(texts(c)[0], g.name); return c; });
  } else if (gg) remove(body, gg);
  const br = find(body, byName('Brands to know'));
  if (br && (d.producers || []).length) {
    const box = find(br, byName('Brands')); const bp = box.c[0];
    box.c = d.producers.map((p) => { const c = clone(bp); c.n = 'Brand · ' + p; setText(texts(c)[0], p); return c; });
  } else if (br) remove(body, br);
  const say = find(body, byName('Say it'));
  if (say && d.sayIt) setText(texts(say)[1], d.sayIt); else if (say) remove(body, say);
  const good = find(body, byName('Good to know'));
  if (good && d.goodToKnow) setText(texts(find(good, byName('Copy')))[1], d.goodToKnow); else if (good) remove(body, good);
  const part = find(body, byName('Back to parent'));
  if (part && d.partOf?.name) { const row = find(part, byName('Row')); setText(texts(row)[0], d.partOf.name); part.to = d.partOf.to || undefined; if (row) row.to = undefined; } else if (part) remove(body, part);

  // the glass card waits for a sourced glass per grape
  const glass = find(body, byName('The glass')); if (glass) remove(body, glass);
  // the story: the page's video
  const story = find(main, byName('The story'));
  const rec = ctx.video;
  if (story && rec?.video) {
    const slot = find(story, (n) => (n.n || '').startsWith('Video slot')); slot.vid = rec.video;
    if (rec.video.youtubeId) slot.f = [{ img: `https://i.ytimg.com/vi/${rec.video.youtubeId}/mqdefault.jpg`, m: 'FILL' }];
    const sc = find(story, byName('Copy')); const t = T(sc);
    setText(t[1], 'WATCH IT');
    const nm = d.name.charAt(0) + d.name.slice(1).toLowerCase();
    setText(t[2], rec.note || (d.isGrape ? `A short video on ${nm}: how it tastes, where it grows, and how to talk about it with a guest.` : `A short video on ${nm}: where it is, what grows there, and how to talk about its wines with a guest.`));
    const cr = find(sc, byName('Video credit')); if (cr) { const ctx2 = texts(cr); setText(ctx2[0], 'VIDEO · ' + (rec.video.by || 'WINE FOLLY').toUpperCase()); setText(ctx2[1], (rec.video.title || '').replace(/ · Wine Folly$/, '')); }
  } else if (story) remove(main, story);

  // previous / next
  const sub = find(main, byName('Sub nav'));
  if (sub) {
    const btns = sub.c.filter((x) => (x.n || '').startsWith('Button · '));
    const prev = (d.nav || []).find((n) => /PREV/i.test(n.label || '')), next = (d.nav || []).find((n) => /NEXT/i.test(n.label || ''));
    for (const [b, n] of [[btns[0], prev], [btns[1], next]]) { if (!b) continue; if (!n?.to) { sub.c = sub.c.filter((x) => x !== b); continue; } b.to = n.to; setText(texts(b)[1], n.name); }
    if (!sub.c.some((x) => (x.n || '').startsWith('Button · '))) remove(main, sub);
  }
  return { id: base?.id || tpl.id, name: base?.name || d.name, bg: base?.bg || tpl.bg, main, v2: true };
}
