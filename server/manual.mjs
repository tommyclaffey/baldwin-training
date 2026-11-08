// The Study Guide (Oct 31, Tommy: "build a training manual within that program so people who are studying for it can get
// more familiarized"). Twelve chapters in the order of the Court of Master Sommeliers' Level 1 course, one JSON file each
// in content/manual (format: content/manual/SCHEMA.md). Each chapter page is drawn from the France chapter's design
// (Figma 362:2); each chapter's 30 cards are a quiz (t:study:<slug>) whose misses go to the person's review queue.
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, startsWith, texts, setText, remove } from './templates.mjs';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../content/manual');
// Level 2 (Certified) chapters, Nov 2: same format plus "level": 2 and "part", written from the Court's resource library
const DIR2 = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../content/manual-l2');
export const GUIDE = 'sommelier-program/study-guide';
// The Cocktail Program (Nov 8, Tommy: "start building it in the app"): Level 1, Certified Bar Server, same lesson format.
const DIR_BAR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../content/bar');
export const BAR = 'cocktail-program';
export const BAR_BASE = 'cocktail-program/level-1';
// The levels (Nov 8, Tommy: "I went too deep into the Certified Bar Server … this might be a little intense for most people").
// Built like the Court, Cicerone and WSET: the same subjects at every level, deeper each time; Level 1 is a multiple-choice
// final, Level 2 adds a practical a manager signs off. Plan: vault › (C) Cocktail Program — Level Structure (Nov 8 2026).
export const BAR_LEVELS = [
  { level: 1, title: 'Certified Bar Server', slug: BAR, file: 'bar-1', final: 'final:bar-1', len: 30 },
  { level: 2, title: 'Certified Bartender', slug: BAR + '/level-2', file: 'bar-2', final: 'final:bar-2', len: 60, practical: 'program:bar-2:practical',
    practicalTitle: 'Build from our specs', practicalHow: 'Build drinks from our specs while a manager watches; they sign you off' },
  // Level 3 (Nov 8, Tommy: "do Advanced Mixologist"): the craft. Its practical is an original drink, specced, costed and built.
  { level: 3, title: 'Advanced Mixologist', slug: BAR + '/level-3', file: 'bar-3', final: 'final:bar-3', len: 60, practical: 'program:bar-3:practical',
    practicalTitle: 'Create an original cocktail', practicalHow: 'Write an original spec, cost it, and build it for the bar lead; they sign you off' },
];
export const barLevel = (c) => c?.barLevel || 1;
export const barLevelOf = (n) => BAR_LEVELS.find((x) => x.level === n);
export const L2_BASE = 'sommelier-program/level-2';
/** Where a chapter's lessons live: Level 1 under the Study Guide, Level 2 under the Level 2 page. */
export const chapterBase = (c) => (c?.program === 'bar' ? `${BAR}/level-${barLevel(c)}` : c?.level === 2 ? L2_BASE : GUIDE);
export const chapterSlug = (c) => `${chapterBase(c)}/${c.slug}`;
export const quizHref = (c) => `/quizzes?quiz=t:study:${c.slug}`;

function load(dir, level) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter((c) => c && c.slug && c.title && Array.isArray(c.sections) && c.sections.length && Array.isArray(c.cards))
    .map((c) => ({ ...c, level, cards: c.cards.filter((k) => k && k.q && k.answer && Array.isArray(k.wrong) && k.wrong.length >= 3) }))
    .sort((a, b) => a.number - b.number);
}
let cache, cache2;
/** The Level 1 chapters that exist, in order. */
export function chapters() {
  if (!cache) cache = load(DIR, 1);
  return cache;
}
/** The Level 2 chapters, in order (Part 1 → 3). */
export function chapters2() {
  if (!cache2) cache2 = load(DIR2, 2);
  return cache2;
}
/** Every chapter, both levels. */
let cacheBar;
/** The Cocktail Program's lessons, in order: one level, or every level (Level 1's first). */
export function chaptersBar(level) {
  if (!cacheBar) cacheBar = load(DIR_BAR, 1).map((c) => ({ ...c, program: 'bar', barLevel: c.barLevel || 1 })).sort((a, b) => a.barLevel - b.barLevel || a.number - b.number);
  return level ? cacheBar.filter((c) => c.barLevel === level) : cacheBar;
}
export const allChapters = () => [...chapters(), ...chapters2(), ...chaptersBar()];
/** "Sommelier · Level 1", "Cocktail Program · Level 1": the program a lesson belongs to. */
export const programOf = (c) => (c?.program === 'bar' ? `Cocktail Program · Level ${barLevel(c)}` : `Sommelier · Level ${c?.level || 1}`);
/** The chapters in the same level as this one. */
export const levelChapters = (c) => (c?.program === 'bar' ? chaptersBar(barLevel(c)) : c?.level === 2 ? chapters2() : chapters());
export const chapterBySlug = (slug) => allChapters().find((c) => c.slug === slug);

/** One person's progress: chapters opened, cards known cold, cards to review (from their quiz marks). */
export function progress(db, userId, store) {
  const out = { read: new Set(), known: {}, review: {} };
  if (!userId) return out;
  for (const r of db.prepare('SELECT slug FROM manual_reads WHERE user_id = ?').all(userId)) out.read.add(r.slug);
  for (const r of db.prepare("SELECT ref, mark FROM quiz_marks WHERE user_id = ? AND store_id = ? AND ref LIKE 'study:%'").all(userId, store)) {
    const slug = r.ref.split(':')[1];
    if (r.mark === 'green') out.known[slug] = (out.known[slug] || 0) + 1; else out.review[slug] = (out.review[slug] || 0) + 1;
  }
  return out;
}
export function markRead(db, userId, slug) {
  if (userId) db.prepare('INSERT OR IGNORE INTO manual_reads(user_id, slug, at) VALUES (?,?,?)').run(userId, slug, new Date().toISOString());
}

/* ---- seeded order for the sample card ---- */
function seedOf(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function shuffleSeeded(arr, key) {
  let a = seedOf(key); const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const b = [...arr]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b;
}

const T = (n) => (n.c || []).filter((c) => c.t === 'T');
const pad2 = (n) => String(n).padStart(2, '0');

/** The visual building blocks (scale, tiles, pyramid…), drawn from the France chapter's design (Figma 362:2). */
export function blockBuilder(main) {
  const V = {
    scale: find(main, byName('Sweetness scale')), tiles: find(main, byName('Producer codes')), pyramid: find(main, byName('Burgundy pyramid')),
    names: find(main, byName('Chablis and Beaujolais')), compare: find(main, byName('Banks')), list: find(main, byName('First Growths')),
    river: find(main, byName('River')), stat: find(main, byName('Alsace facts')),
  };
  const loireVisual = find(find(main, byName('Region · Loire')), byName('Visual'));
  V.stepsLabel = loireVisual && T(loireVisual)[0];
  return (b) => {
    if (!b || !b.type) return [];
    if (b.type === 'scale' && V.scale) {
      const p = clone(V.scale); const pt = T(p); setText(pt[0], (b.title || '').toUpperCase());
      const sc = find(p, byName('Scale')); const proto = sc.c[0];
      sc.c = (b.rows || []).map((r) => { const c = clone(proto); c.n = 'Level · ' + r.name; const t = texts(c); setText(t[0], r.name); setText(t[t.length - 1], r.value || ''); const tr = find(c, byName('Track')); if (tr?.c?.[0]) tr.c[0].w = Math.max(8, Math.round((tr.w || 200) * Math.min(1, Math.max(0, Number(r.pct) || 0)))); return c; });
      if (b.note) setText(pt[1], b.note); else p.c = p.c.filter((x) => x !== pt[1]);
      return [p];
    }
    if (b.type === 'tiles' && V.tiles) {
      const p = clone(V.tiles); setText(T(p)[0], (b.title || '').toUpperCase());
      const codes = find(p, byName('Codes')); const proto = codes.c[0];
      codes.c = (b.items || []).slice(0, 4).map((it) => { const c = clone(proto); c.n = 'Tile · ' + it.name; const t = texts(c); setText(t[0], it.name); setText(t[1], it.text || ''); return c; });
      return [p];
    }
    if (b.type === 'pyramid' && V.pyramid) {
      const p = clone(V.pyramid); setText(T(p)[0], (b.title || '').toUpperCase());
      const py = find(p, byName('Pyramid')); const protos = py.c; const k = (b.rows || []).length;
      py.c = (b.rows || []).map((r, i) => { const c = clone(protos[Math.min(protos.length - 1, Math.round((i * (protos.length - 1)) / Math.max(1, k - 1)))]); c.n = 'Level · ' + r.name; const t = texts(c); setText(t[0], r.name); setText(t[1], r.note || ''); c.w = k > 1 ? Math.round(230 + (300 * i) / (k - 1)) : 380; return c; });
      return [p];
    }
    if (b.type === 'names' && V.names) {
      const row = clone(V.names); const cards = row.c;
      row.c = (b.items || []).slice(0, 2).map((it, i) => { const c = clone(cards[Math.min(i, cards.length - 1)]); c.n = it.title; const t = texts(c); setText(t[0], (it.title || '').toUpperCase()); setText(t[1], it.text || ''); return c; });
      return [row];
    }
    if (b.type === 'compare' && V.compare) {
      const row = clone(V.compare); const cards = row.c;
      row.c = (b.items || []).slice(0, 2).map((it, i) => { const c = clone(cards[i]); c.n = it.label || 'Side ' + (i + 1); const t = texts(c); setText(t[0], (it.label || '').toUpperCase()); setText(t[1], it.title || ''); setText(t[2], it.text || ''); return c; });
      return [row];
    }
    if (b.type === 'list' && V.list) {
      const p = clone(V.list); const pt = T(p); setText(pt[0], (b.title || '').toUpperCase());
      const list = find(p, byName('List')); const first = list.c[0], rest = list.c[1] || list.c[0];
      const long = (b.rows || []).some((r) => String(r.meta || '').length > 24);
      list.c = (b.rows || []).map((r, i) => {
        const c = clone(i ? rest : first); c.n = 'Row · ' + r.name; const t = texts(c); setText(t[0], r.name); setText(t[1], r.meta || '');
        // long notes go under the name, full width, instead of a narrow right-hand column
        if (long) { c.lm = 'V'; c.pa = undefined; c.gap = 2; c.sh = 'L'; for (const x of t) { x.ar = 'H'; x.sh = 'L'; x.ta = undefined; } }
        return c;
      });
      if (long) { list.sh = 'L'; p.sh = 'L'; }
      if (b.note) setText(pt[1], b.note); else p.c = p.c.filter((x) => x !== pt[1]);
      return [p];
    }
    if (b.type === 'steps' && V.river) {
      const out = [];
      if (V.stepsLabel && b.title) { const l = clone(V.stepsLabel); setText(l, b.title.toUpperCase()); out.push(l); }
      const river = clone(V.river); const plain = river.c[0], last = river.c[river.c.length - 1]; const k = (b.items || []).length;
      river.c = (b.items || []).slice(0, 5).map((it, i) => { const c = clone(i === k - 1 ? last : plain); c.n = 'Step · ' + it.name; const t = texts(c); setText(t[0], String(i + 1)); setText(t[1], it.name); setText(t[2], it.text || ''); setText(t[3], it.meta || ''); if (!it.meta) c.c = c.c.filter((x) => x !== t[3]); else if (i === k - 1) t[3].f = [{ c: '#C49A6C' }]; return c; });
      out.push(river); return out;
    }
    if (b.type === 'stat' && V.stat) {
      const row = clone(V.stat); row.c = [row.c[0]];
      const t = texts(row.c[0]); setText(t[0], String(b.number ?? '')); setText(t[1], b.title || ''); setText(t[2], b.text || '');
      return [row];
    }
    return [];
  };
}

/** A chapter page, drawn from the France design. */
export function chapterPage(tpl, ch, ctx) {
  const main = clone(tpl.main);
  const n = ch.cards.length;
  const known = ctx.prog.known[ch.slug] || 0;
  const bc = find(main, byName('Breadcrumb'));
  const bt = T(bc); setText(bt[1], `Chapter ${ch.number}`); setText(bt[3], ch.title);
  const copy = find(find(main, byName('Header')), byName('Copy'));
  const ct = T(copy); setText(ct[0], ch.script || `Chapter ${ch.number}`); setText(ct[1], ch.title.toUpperCase()); setText(ct[2], ch.lead || '');
  ct[1].ar = 'H'; ct[1].sh = 'F'; if (ch.title.length > 18) ct[1].z = Math.min(ct[1].z || 44, 38);
  const side = find(main, byName('Side'));
  const st = T(side); setText(st[1], `About ${ch.minutes || 20} minutes · ${n} cards`);
  setText(st[2], known ? `Your cards: ${known} known cold, ${n - known} to go` : 'You haven’t practised these yet');
  for (const b of findAll(main, (x) => (x.n || '').startsWith('Button · Practise'))) { b.to = quizHref(ch); setText(T(b)[0] || texts(b)[0], `Practise ${n} Cards`); }

  // Start here
  const intro = find(main, byName('Start here · the label tiers'));
  if (ch.intro && (ch.intro.tiers || []).length) {
    const ic = T(find(intro, byName('Copy')));
    setText(ic[0], ch.intro.script || 'Start here'); setText(ic[1], (ch.intro.title || '').toUpperCase()); setText(ic[2], ch.intro.text || '');
    const py = find(intro, byName('Pyramid')); const protos = py.c; const k = ch.intro.tiers.length;
    py.c = ch.intro.tiers.map((t, i) => {
      const r = clone(protos[i === 0 ? 0 : i === k - 1 ? protos.length - 1 : 1]);
      r.n = 'Tier · ' + t.name; const tt = texts(r); setText(tt[0], t.name); setText(tt[1], t.note || '');
      r.w = k > 1 ? Math.round(300 + (280 * i) / (k - 1)) : 440;
      return r;
    });
  } else remove(main, intro);

  const block = blockBuilder(main);

  // sections: the France regions become this chapter's sections
  const regions = (main.c || []).filter(startsWith('Region · '));
  const proto = regions[0];
  const at = main.c.indexOf(proto);
  const built = ch.sections.map((sec, i) => {
    const s = clone(proto); s.n = 'Section · ' + sec.name;
    const head = find(s, byName('Head')); const ht = texts(find(head, byName('Name'))); setText(ht[0], pad2(i + 1)); setText(ht[1], (sec.name || '').toUpperCase());
    const ob = find(head, byName('Open in the book'));
    if (sec.book && ctx.slugs.has(sec.book)) { ob.to = '/' + sec.book; setText(texts(ob)[0], sec.name.length > 16 ? 'Open in the Book' : `Open ${sec.name} in the Book`); } else head.c = head.c.filter((x) => x !== ob);
    const left = find(s, byName('Left'));
    const lineP = find(left, byName('Climate')), chipsP = find(left, byName('Grapes')), knowP = find(left, byName('Know these'));
    const lines = (sec.lines || []).map((l) => { const c = clone(lineP); c.n = 'Line · ' + l.label; const t = texts(c); setText(t[0], (l.label || '').toUpperCase()); setText(t[1], l.text || ''); return c; });
    let chips = null;
    if (sec.chips?.items?.length) {
      chips = clone(chipsP); setText(T(chips)[0], (sec.chips.label || 'Grapes').toUpperCase());
      const box = find(chips, byName('Chips')); const cp = box.c[0];
      box.c = sec.chips.items.map((x) => { const c = clone(cp); c.n = 'Chip · ' + x; setText(texts(c)[0], x); return c; });
    }
    let know = null;
    if (sec.know?.length) {
      know = clone(knowP); const item = know.c.find((x) => x.n === 'Item'); const lab = T(know)[0];
      know.c = [lab, ...sec.know.map((k) => { const c = clone(item); setText(texts(c)[0], k); return c; })];
    }
    left.c = [...lines, chips, know].filter(Boolean);
    const vis = find(s, byName('Visual'));
    vis.c = (sec.visuals || []).flatMap(block);
    // "Body" two-column frames get evened out in the browser; a section's left column must stay as written.
    const body = find(s, byName('Body')); body.n = 'Section body';
    if (!vis.c.length) { body.c = body.c.filter((x) => x !== vis); left.sh = 'F'; }
    // titles in cards wrap instead of running out of the card
    for (const t of findAll(vis, (x) => x.t === 'T' && x.ar === 'W' && (x.s || '').length > 18)) { t.ar = 'H'; t.sh = 'F'; }
    // tile and step titles wrap too: four tiles share a row
    for (const c of findAll(vis, (x) => /^(Tile|Step) · /.test(x.n || ''))) for (const t of texts(c)) { t.ar = 'H'; t.sh = 'F'; }
    return s;
  });
  main.c = [...main.c.slice(0, at).filter((x) => !regions.includes(x)), ...built, ...main.c.slice(at).filter((x) => !regions.includes(x))];

  // easy to mix up
  const mix = find(main, byName('Easy to mix up'));
  if (ch.mixups?.length) {
    const pairs = find(mix, byName('Pairs')); const pp = pairs.c[0];
    pairs.c = ch.mixups.slice(0, 4).map((m) => { const c = clone(pp); c.n = 'Pair · ' + m.a; const t = texts(c); setText(t[0], m.a); setText(t[2], m.b); setText(t[3], m.why || ''); return c; });
  } else remove(main, mix);

  // check yourself: the first card, in exam format
  const chk = find(main, byName('Check yourself'));
  const card = ch.cards[0];
  if (card) {
    const sc = find(chk, byName('Sample card'));
    const top = texts(find(sc, byName('Top'))); setText(top[0], ch.title.toUpperCase()); setText(top[1], `Card 1 of ${n}`);
    setText(T(sc)[0], card.q);
    const opts = find(sc, byName('Options')); const right = opts.c.find((o) => o.n === 'Option · C') || opts.c[0]; const plain = opts.c.find((o) => o !== right);
    const order = shuffleSeeded([card.answer, ...card.wrong.slice(0, 3)], 'study:' + ch.slug + ':0');
    opts.c = order.map((o, i) => { const c = clone(o === card.answer ? right : plain); const L = 'ABCD'[i]; c.n = 'Option · ' + L; const t = texts(c); setText(t[0], L); setText(t[1], o); return c; });
    const why = find(sc, byName('Why')); setText(texts(why)[0], `Right answer: ${card.answer}.`);
  } else remove(main, chk);

  setText(texts(find(main, byName('Sources')))[1], ch.sources || '');

  // previous / next chapter
  const nav = find(main, byName('Sub nav'));
  const all = ctx.all; const k = all.findIndex((x) => x.slug === ch.slug);
  const prev = all[k - 1], next = all[k + 1];
  const pb = find(nav, byName('Button · Previous')), nb = find(nav, byName('Button · Next'));
  const fillBtn = (b, c) => { const t = texts(b); setText(t[0], `CHAPTER ${c.number}`); setText(t[1], c.title); b.to = '/' + chapterSlug(c); };
  nav.c = [prev ? (fillBtn(pb, prev), pb) : { t: 'F', n: 'Spacer', w: 1, h: 1 }, next ? (fillBtn(nb, next), nb) : null].filter(Boolean);
  if (!prev && !next) remove(main, nav);
  return { id: 'm-' + ch.slug, name: 'Study Guide · ' + ch.title, bg: tpl.bg, main };
}

/** The Study Guide's front page: every chapter with this person's progress. */
export function guideIndex(page, ctx) {
  const m = page.main;
  const all = chapters(); const bySlugNum = new Map(all.map((c) => [c.number, c]));
  const p = ctx.prog;
  const totalCards = all.reduce((s, c) => s + c.cards.length, 0);
  const known = Object.values(p.known).reduce((s, x) => s + x, 0), review = Object.values(p.review).reduce((s, x) => s + x, 0);
  const side = find(m, byName('Side'));
  const stats = find(side, byName('Stats'));
  if (stats) { const v = stats.c.map((c) => texts(c)); setText(v[0][0], `${p.read.size} of 12`); setText(v[1][0], String(known)); setText(v[2][0], String(review)); }
  const bar = find(side, byName('Progress bar')); if (bar?.c?.[0]) bar.c[0].w = Math.max(0, Math.round((bar.w || 340) * Math.min(1, known / Math.max(1, totalCards))));
  const rv = find(side, (x) => (x.n || '').startsWith('Button · Review'));
  if (rv) { rv.to = '/quizzes?quiz=review'; setText(texts(rv)[0], review ? `Review ${review} Card${review === 1 ? '' : 's'}` : 'Open My Review Queue'); }
  // the twelve chapter cards
  const grid = find(m, byName('Grid'));
  const cards = (grid?.c || []).filter(startsWith('Chapter · '));
  const proto = { done: cards[0], progress: cards.find((c) => /· 4 ·/.test(c.n)) || cards[3], new: cards.find((c) => /· 5 ·/.test(c.n)) || cards[4] };
  grid.c = cards.map((c, i) => {
    const num = i + 1; const ch = bySlugNum.get(num);
    const k = ch ? (p.known[ch.slug] || 0) : 0, n = ch ? ch.cards.length : 30;
    const state = !ch ? 'new' : k >= n && n ? 'done' : p.read.has(ch.slug) || k ? 'progress' : 'new';
    const out = clone(proto[state]); out.n = c.n;
    const own = texts(c), t = texts(out);
    // number, status, name, line, actions: keep this card's own words from the design, then the chapter's title
    setText(t[0], pad2(num)); setText(t[2], ch ? ch.title : own[2]?.s || ''); setText(t[3], own[3]?.s || '');
    setText(t[1], !ch ? 'Coming soon' : state === 'done' ? `✓ All ${n} known` : state === 'progress' ? `${k} of ${n} known` : 'Not started');
    const acts = find(out, byName('Actions'));
    if (ch) {
      out.to = '/' + chapterSlug(ch);
      const read = find(acts, (x) => (x.n || '').startsWith('Action · Read')); if (read) read.to = '/' + chapterSlug(ch);
      const prac = find(acts, (x) => (x.n || '').startsWith('Action · Practise')); if (prac) { prac.to = quizHref(ch); setText(texts(prac)[0], `Practise ${n} Cards`); }
    } else if (acts) out.c = out.c.filter((x) => x !== acts);
    return out;
  });
  return page;
}
