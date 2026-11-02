// The Sommelier Program, video first (Nov 1, Tommy: "add more photos, video, and flow … it feels very blocky and wordy").
// Figma section 17: hub 391:32, Level 1 course 392:31, lesson 403:45 (watch → swipe → read → check), Level 2 394:31.
// Lessons are one per chapter section (content/manual/<slug>.json → "v3", format in SCHEMA.md). The old long chapter
// page stays at <chapter>/whole-chapter, and the old hub / Level 1 / Level 2 pages stay as "Exam Details".
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, texts, setText, remove } from './templates.mjs';
import { chapters, GUIDE, quizHref, shuffleSeeded, blockBuilder } from './manual.mjs';

export const HUB = 'sommelier-program';
export const L1 = 'sommelier-program/level-1';
export const L2 = 'sommelier-program/level-2';
export const REGISTER = {
  1: 'https://portal.mastersommeliers.org/register?sgid=202565d15858479b9a1411d9db112f5e',
  2: 'https://portal.mastersommeliers.org/register?sgid=c6f9912b50984cdf8aaf65b76099975a',
};
export const DETAILS = { hub: 'sommelier-program/about', 1: 'sommelier-program/level-1/exam-details', 2: 'sommelier-program/level-2/exam-details' };

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Lesson addresses: the chapter's first section at /<guide>/<chapter>, the rest at /<guide>/<chapter>/<section>. */
export const lessonSlug = (ch, i) => (i === 0 ? `${GUIDE}/${ch.slug}` : `${GUIDE}/${ch.slug}/${slugify(ch.sections[i].name)}`);
export const wholeChapterSlug = (ch) => `${GUIDE}/${ch.slug}/whole-chapter`;
export const doneKey = (ch, i) => `${ch.slug}#${i}`;
export const lessonFile = (ch, i) => `l-${ch.slug}~${i}`;
const v3Of = (ch, i) => (ch.v3?.sections || []).find((x) => x.name === ch.sections[i].name) || {};
const thumb = (v) => (v?.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg` : null);
const asVid = (v) => (v?.youtubeId ? { kind: 'youtube', youtubeId: v.youtubeId, title: v.title } : null);
const T = (n) => (n?.c || []).filter((c) => c.t === 'T');
const setImg = (node, url) => { if (node && url) node.f = [{ img: url, m: 'FILL' }]; };

// Progress (Nov 1, Tommy: "show a completed section, like a percentage of the course … check it off, gray it out … with a green check mark")
const GREEN = '#2E7D45';
export function courseProgress(done) {
  const all = chapters(); const total = all.reduce((a, c) => a + c.sections.length, 0);
  const k = all.reduce((a, c) => a + c.sections.filter((_, i) => done.has(doneKey(c, i))).length, 0);
  return { k, total, pct: total ? Math.round((100 * k) / total) : 0 };
}
const txt = (s, o = {}) => ({ t: 'T', n: s.slice(0, 40), s, ff: 'Archivo', fs: o.fs || 'Bold', z: o.z || 12, f: [{ c: o.c || '#C49A6C' }], ar: 'W', ...(o.ls ? { ls: o.ls } : {}), sh: 'H', sv: 'H' });
/** "34% DONE · 31 of 90 sections" over a copper bar. */
function progressBlock(p, w, dark = true) {
  const bar = { t: 'F', n: 'Bar', w, h: 6, r: 3, f: [{ c: dark ? '#3A3632' : '#E4DCCF' }], sh: 'F', sv: 'F', c: [{ t: 'R', n: 'Done', x: 0, y: 0, w: Math.max(p.k ? 6 : 0, Math.round((w * p.pct) / 100)), h: 6, r: 3, f: [{ c: p.pct === 100 ? GREEN : '#C49A6C' }] }] };
  return { t: 'F', n: 'Course progress', lm: 'V', gap: 8, w, h: 30, sh: 'F', sv: 'H', c: [txt(`${p.pct}% DONE · ${p.k} OF ${p.total} SECTIONS`, { ls: '12%', c: p.pct === 100 ? '#7FCB93' : '#C49A6C' }), bar] };
}
/** Gray a finished thumbnail and put a green check on it. */
function markDone(th, check = true) {
  if (!th) return;
  th.c = [...(th.c || []).filter((x) => x.n !== 'Play'), { t: 'R', n: 'Done shade', x: 0, y: 0, w: th.w, h: th.h, abs: 1, f: [{ c: '#F2EEE7', o: 0.55 }] },
    ...(check ? [{ t: 'F', n: 'Done check', x: th.w - 34, y: 8, w: 26, h: 26, r: 13, abs: 1, f: [{ c: GREEN }], lm: 'H', pa: 'C', ca: 'C', c: [txt('✓', { z: 14, c: '#FFFFFF', fs: 'ExtraBold' })] }] : [])];
}
// photos for lessons without a video (Unsplash stand-ins, content/research/study-photos.json)
let PHOTOS;
const photoOf = (ch, sec) => {
  if (!PHOTOS) { try { PHOTOS = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../content/research/study-photos.json'), 'utf8')).photos || []; } catch { PHOTOS = []; } }
  return PHOTOS.find((p) => p.chapter === ch.slug && p.section === sec.name)?.file || null;
};

/** Text with **bold** words: plain text plus style runs (Figma segments) covering the whole string. */
function setMd(node, md) {
  if (!node) return;
  const parts = String(md || '').split(/\*\*(.+?)\*\*/g);
  // the plain style is the template's non-bold run (a paragraph that starts with a bold word exports as "Bold")
  const base = (node.segs || []).map((x) => x[2]).find((st) => !/Bold/.test(st)) || (/Bold/.test(node.fs || '') ? 'Regular' : node.fs || 'Regular');
  node.fs = base;
  let s = '', segs = [];
  parts.forEach((p, i) => { if (!p) return; const a = s.length; s += p; segs.push([a, s.length, i % 2 ? 'Bold' : base, null]); });
  node.s = s;
  if (segs.some((x) => x[2] === 'Bold')) node.segs = segs; else delete node.segs;
}

/** Sections each person has finished (3 cards right), from manual_reads rows like "france#3". */
export function sectionsDone(db, userId) {
  const done = new Set();
  if (!userId) return done;
  for (const r of db.prepare("SELECT slug FROM manual_reads WHERE user_id = ? AND slug LIKE '%#%'").all(userId)) done.add(r.slug);
  return done;
}
const chapterState = (ch, done) => {
  const n = ch.sections.length; const k = ch.sections.filter((_, i) => done.has(doneKey(ch, i))).length;
  return { n, k, state: k === n ? 'done' : k ? 'half' : 'todo', next: Math.max(0, ch.sections.findIndex((_, i) => !done.has(doneKey(ch, i)))) };
};
/** Where to pick up: the first unfinished section of the first chapter that isn't finished. */
export function nextLesson(done) {
  for (const ch of chapters()) { const s = chapterState(ch, done); if (s.state !== 'done') return { ch, i: s.next, started: s.k > 0 || done.size > 0 }; }
  return null;
}

/* ---------------- lesson ---------------- */
export function lessonPage(tpl, chTpl, ch, si, ctx) {
  const main = clone(tpl.main);
  const sec = ch.sections[si]; const v = v3Of(ch, si); const r = v.read || {};
  const n = ch.sections.length; const all = chapters();
  const href = (c, i) => '/' + lessonSlug(c, i);

  // breadcrumb: Level 1 / Lesson N · Chapter / Section
  const bc = find(main, byName('Breadcrumb'));
  if (bc) { const t = texts(bc); setText(t[0], 'Level 1'); setText(t[2], `Lesson ${ch.number} · ${ch.title}`); setText(t[4], sec.name); const back = find(bc, byName('Back')); if (back) back.to = '/' + L1; }

  // the video, or nothing when there isn't a good one
  const slot = find(main, byName('Video slot · Lesson'));
  const under = find(main, byName('Under the video'));
  if (v.video?.youtubeId) {
    slot.vid = asVid(v.video);
    setImg(slot, thumb(v.video));
  } else if (photoOf(ch, sec)) {
    slot.n = 'IMG/Section photo'; slot.f = [{ img: photoOf(ch, sec), m: 'FILL' }]; slot.c = [];
  } else remove(main, slot);
  if (under) {
    const tt = T(find(under, byName('Titles')));
    setText(tt[0], `SECTION ${si + 1} OF ${n} · ${ch.title.toUpperCase()}${ctx.done.has(doneKey(ch, si)) ? ' · DONE ✓' : ''}`);
    setText(tt[1], sec.name.toUpperCase()); tt[1].ar = 'H'; tt[1].sh = 'L'; if (sec.name.length > 22) tt[1].z = 26;
    find(under, byName('Titles')).c = [tt[0], tt[1]];
    find(under, byName('Titles')).sh = 'L';
    const credit = T(under)[0];
    if (v.video?.youtubeId) setText(credit, `Video: ${v.video.by} · ${v.video.length}`); else under.c = under.c.filter((x) => x !== credit);
  }

  // key points: cards that scroll sideways
  const kp = find(main, byName('Key points'));
  const pts = v.keyPoints || [];
  if (pts.length) {
    const head = find(kp, byName('Head'));
    head.c = head.c.filter((x) => !(x.n || '').startsWith('Arrow'));
    setText(T(head)[0], 'KEY POINTS'); setText(T(head)[1], pts.length > 3 ? `${pts.length} cards · swipe` : `${pts.length} cards`);
    const cards = find(kp, byName('Cards')); const protos = cards.c;
    cards.c = pts.map((p, i) => { const c = clone(protos[i % protos.length]); c.n = 'Point · ' + p.big; const t = texts(c); setText(t[0], p.big); setText(t[1], p.line); t[0].ar = 'H'; t[0].sh = 'F'; if (pts.length > 3) { c.sh = 'F'; c.w = 220; } return c; });
    cards.n = 'Cards';
  } else remove(main, kp);

  // read it: big idea → where → stops → the visual → don't mix up → say it
  const read = find(main, byName('Read it'));
  if (r.bigIdea || r.where) {
    const kids = read.c;
    const tag = find(read, byName('Tag')); setText(T(tag)[1], `about ${Math.max(1, Math.round(((r.where || '').length + (r.stops || []).reduce((a, s) => a + (s.text || '').length, 0)) / 900))} minute${''}s`.replace('about 1 minutes', 'about 1 minute'));
    const [bigT, whereT, stopsTitleT] = kids.filter((c) => c.t === 'T');
    setText(bigT, r.bigIdea || sec.name);
    setMd(whereT, r.where || '');
    const stops = find(read, byName('Stops'));
    if (r.stops?.length) {
      setText(stopsTitleT, r.stopsTitle || '');
      if (!r.stopsTitle) read.c = read.c.filter((x) => x !== stopsTitleT);
      const first = stops.c[0], last = stops.c[stops.c.length - 1];
      stops.c = r.stops.map((s, i) => {
        const c = clone(i === r.stops.length - 1 ? last : first); c.n = `Stop ${i + 1} · ${s.name}`;
        const num = find(c, byName('Number')); setText(T(num)[0], String(i + 1));
        // the dark dot marks the last stop; every other dot is copper
        const body = find(c, byName('Body')); const h = T(find(body, byName('Head'))); setText(h[0], s.name); setText(h[1], s.note || '');
        if (!s.note) find(body, byName('Head')).c = [h[0]];
        setMd(T(body)[0], s.text || '');
        return c;
      });
    } else { read.c = read.c.filter((x) => x !== stops && x !== stopsTitleT); }
    // the visual sits right where it's explained
    const scriptAfter = read.c.filter((c) => c.t === 'T')[r.stops?.length && r.stopsTitle ? 3 : 2];
    const introT = read.c.filter((c) => c.t === 'T')[r.stops?.length && r.stopsTitle ? 4 : 3];
    const vis = find(read, byName('Visual'));
    const b = Number.isInteger(r.visual) ? (sec.visuals || [])[r.visual] : null;
    const built = b ? blockBuilder(chTpl.main)(b) : [];
    read.c = read.c.filter((x) => x !== scriptAfter);
    if (built.length) {
      vis.lm = 'V'; vis.gap = 12; vis.c = built.map((x) => { x.sh = 'L'; return x; });
      for (const t of findAll(vis, (x) => x.t === 'T' && x.ar === 'W' && (x.s || '').length > 18)) { t.ar = 'H'; t.sh = 'F'; }
      for (const c of findAll(vis, (x) => /^(Tile|Step) · /.test(x.n || ''))) for (const t of texts(c)) { t.ar = 'H'; t.sh = 'L'; }
      // rows of steps or tiles share the reading column (628 wide); five or more wrap three to a row instead of running off
      for (const row of findAll(vis, (x) => x.lm === 'H' && (x.c || []).length >= 2 && x.c.every((c) => /^(Tile|Step) · /.test(c.n || '')))) {
        const k = row.c.length; const per = k <= 4 ? k : 3; const gap = row.gap || 8; const w = Math.floor((628 - gap * (per - 1)) / per);
        row.wrap = 1; row.cg = gap; row.sh = 'L'; row.n = `Grid · ${per}`; for (const c of row.c) { c.sh = 'F'; c.w = w; }
      }
      if (r.visualIntro) setText(introT, r.visualIntro); else read.c = read.c.filter((x) => x !== introT);
    } else read.c = read.c.filter((x) => x !== vis && x !== introT);
    const mix = find(read, byName('Easy to mix up'));
    if (r.mixup) setMd(T(mix)[1], r.mixup); else remove(read, mix);
    const say = find(read, byName('Say it at the table'));
    if (r.sayIt) setText(T(say)[1], `“${r.sayIt.replace(/^“|”$/g, '')}”`); else remove(read, say);
    const src = read.c.filter((c) => c.t === 'T').pop();
    setText(src, ch.sources ? `Sources: ${ch.sources}` : '');
  } else remove(main, read);

  // quick check: 3 cards, live (QuickCheck in the browser); misses go to the review queue
  const qc = find(main, byName('Quick check'));
  const picks = (v.check || []).filter((k) => ch.cards[k]).slice(0, 3);
  if (picks.length) {
    qc.meta = { ...(qc.meta || {}), check: {
      key: doneKey(ch, si), done: ctx.done.has(doneKey(ch, si)),
      items: picks.map((k) => { const c = ch.cards[k]; const opts = shuffleSeeded([c.answer, ...c.wrong.slice(0, 3)], `${ch.slug}:${k}`); return { ref: `study:${ch.slug}:${k}`, q: c.q, options: opts, answer: opts.indexOf(c.answer) }; }),
    } };
  } else remove(main, qc);

  // the playlist: every section of this chapter
  const pl = find(main, byName('Playlist'));
  const ph = find(pl, byName('Head')); const pt = T(ph);
  const k = ch.sections.filter((_, i) => ctx.done.has(doneKey(ch, i))).length;
  setText(pt[0], `LESSON ${ch.number} · ${ch.title.toUpperCase()}`); setText(pt[1], `${n} sections · ${k} done`);
  const bar = find(ph, byName('Progress')); if (bar?.c?.[0]) bar.c[0].w = Math.round((bar.w || 300) * (k / n));
  const rows = pl.c.filter((c) => (c.n || '').startsWith('Section · '));
  const P = { done: rows.find((x) => x.n.endsWith('· done')), here: rows.find((x) => x.n.endsWith('· here')), todo: rows.find((x) => !/· (done|here)$/.test(x.n)) };
  const built = ch.sections.map((s, i) => {
    const state = i === si ? 'here' : ctx.done.has(doneKey(ch, i)) ? 'done' : 'todo';
    const c = clone(P[state]); c.n = 'Section · ' + s.name; c.to = href(ch, i);
    const sv = v3Of(ch, i).video;
    const th = c.c.find((x) => (x.n || '').startsWith('IMG/'));
    if (th) {
      th.n = 'IMG/Section thumbnail';
      if (sv?.youtubeId) setImg(th, thumb(sv)); else if (photoOf(ch, s)) setImg(th, photoOf(ch, s)); else th.f = [{ c: state === 'here' ? '#3A3632' : '#2A2724' }];
      const d = find(th, byName('Duration'));
      // no video: the section is read, not watched
      if (d) { if (sv?.youtubeId && sv.length) setText(T(d)[0], sv.length); else if (sv?.youtubeId) th.c = (th.c || []).filter((x) => x !== d); else setText(T(d)[0], 'Read'); }
    }
    if (state === 'done') {
      markDone(th, false);
      const ck = find(c, byName('Done')); if (ck) { ck.f = [{ c: GREEN }]; for (const t of texts(ck)) t.f = [{ c: '#FFFFFF' }]; }
    }
    const copy = find(c, byName('Copy')); const cp = T(copy);
    if (state === 'done') { cp[0].s = 'DONE'; cp[0].f = [{ c: GREEN }]; cp[1].f = [{ c: '#5E574F' }]; }
    if (state !== 'done') setText(cp[0], state === 'here' ? 'NOW PLAYING' : `SECTION ${i + 1}`); setText(cp[1], s.name);
    copy.sh = 'F'; copy.w = 172; cp[1].ar = 'H'; cp[1].sh = 'F'; cp[1].w = 172;
    return c;
  });
  const at = pl.c.indexOf(rows[0]);
  pl.c = [...pl.c.slice(0, at), ...built, ...pl.c.slice(at).filter((x) => !rows.includes(x))];
  const whole = find(pl, byName('Item · Easy to Mix Up'));
  if (whole) { whole.n = 'Row · Read Whole Chapter'; whole.to = '/' + wholeChapterSlug(ch); const t = T(whole); setText(t[0], 'Read Whole Chapter'); setText(t[1], `${ch.minutes || 20} min`); }
  const chk = find(pl, byName('Item · Check Yourself'));
  if (chk) { chk.n = 'Row · Check Yourself'; chk.to = quizHref(ch); setText(T(chk)[1], `${ch.cards.length} cards`); }
  const next = find(pl, byName('Button · Next: Alsace'));
  if (next) {
    const nc = all[all.indexOf(ch) + 1];
    if (si < n - 1) { next.to = href(ch, si + 1); setText(texts(next)[0], `Next: ${ch.sections[si + 1].name}`); }
    else if (nc) { next.to = href(nc, 0); setText(texts(next)[0], `Next Lesson: ${nc.title}`); }
    else { next.to = '/' + L1; setText(texts(next)[0], 'Back to Level 1'); }
    next.n = 'Button · Next';
  }
  return { id: tpl.id, name: `Study Guide · ${ch.title} · ${sec.name}`, bg: tpl.bg, main };
}

/* ---------------- Level 1: the course ---------------- */
export function level1Page(page, ctx) {
  const main = page.main; const all = chapters();
  const nx = nextLesson(ctx.done);
  for (const b of findAll(main, (x) => (x.n || '').startsWith('Button · Continue'))) {
    if (nx) { b.to = '/' + lessonSlug(nx.ch, nx.i); setText(texts(b)[0], nx.started ? `Continue Lesson ${nx.ch.number}` : 'Start Lesson 1'); } else { b.to = '/' + lessonSlug(all[0], 0); setText(texts(b)[0], 'Watch Again'); }
  }
  for (const b of findAll(main, (x) => (x.n || '').startsWith('Button · Book'))) b.to = REGISTER[1];
  // the hero video
  const hv = find(main, (x) => (x.n || '').includes('YouTube R6ESxHbDSrg'));
  if (hv) { hv.n = 'Video · Your Study Schedule'; hv.vid = { kind: 'youtube', youtubeId: 'R6ESxHbDSrg', title: 'Your Sommelier Exam Study Schedule · Court of Master Sommeliers, Americas' }; }
  // the exam details (the old Level 1 page) stay one tap away
  const btns = find(find(main, byName('Hero')), byName('Buttons'));
  const book = btns && btns.c.find((x) => (x.n || '').startsWith('Button · Book'));
  if (book) { const d = clone(book); d.n = 'Button · Exam Details'; d.to = '/' + DETAILS[1]; setText(texts(d)[0], 'Exam Details'); btns.c.push(d); btns.wrap = 1; btns.cg = 8; btns.sh = 'L'; }
  const lead = find(find(main, byName('Hero')), (x) => x.t === 'T' && /video lessons/.test(x.s || ''));
  if (lead) { setText(lead, 'Twelve video lessons with practice cards, then two days with us.'); lead.n = 'Lead'; }
  for (const t of findAll(find(main, byName('Hero')) || { c: [] }, (x) => x.t === 'T' && (x.z || 0) >= 36)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  for (const t of findAll(find(main, byName('How it works')) || { c: [] }, (x) => x.t === 'T' && (x.s || '').length > 2)) { t.ar = 'H'; t.sh = 'L'; }
  const prog = courseProgress(ctx.done);
  const heroCopy = find(find(main, byName('Hero')), byName('Copy'));
  if (heroCopy) { const at = heroCopy.c.findIndex((x) => x.n === 'At a glance'); heroCopy.c.splice(at + 1, 0, progressBlock(prog, 398)); }
  // twelve lessons
  const grid = find(main, byName('Lessons')); const tiles = grid.c;
  const P = { done: tiles[0], half: tiles[3], todo: tiles[4] };
  let finished = 0;
  grid.c = all.map((ch) => {
    const s = chapterState(ch, ctx.done); if (s.state === 'done') finished++;
    const c = clone(P[s.state]); c.n = `Lesson ${String(ch.number).padStart(2, '0')} · ${ch.title}`; c.to = '/' + lessonSlug(ch, s.state === 'done' ? 0 : s.next);
    const th = c.c.find((x) => (x.n || '').startsWith('IMG/'));
    const vid = ch.v3?.video || v3Of(ch, 0).video;
    if (th) {
      th.n = 'IMG/Lesson thumbnail';
      const ph = !vid?.youtubeId && ch.sections.map((x) => photoOf(ch, x)).find(Boolean);
      if (vid?.youtubeId) setImg(th, thumb(vid)); else if (ph) setImg(th, ph); else th.f = [{ c: '#2A2724' }];
      const d = find(th, byName('Duration')); if (d) { if (vid?.length) setText(T(d)[0], vid.length); else th.c = th.c.filter((x) => x !== d); }
      const num = find(th, byName('Number')); if (num) setText(T(num)[0], (s.state === 'done' ? '✓ ' : '') + String(ch.number).padStart(2, '0'));
      const w = find(th, byName('Watched')); if (w) w.w = Math.round((th.w || 250) * (s.k / s.n));
      if (!vid?.youtubeId) th.c = (th.c || []).filter((x) => x.n !== 'Play');
    }
    if (s.state === 'done' && th) markDone(th);
    const t = T(c); setText(t[0], ch.title);
    if (s.state === 'done') { setText(t[1], `✓ Done · ${s.n} sections`); t[1].f = [{ c: GREEN }]; t[1].fs = 'Bold'; }
    const videos = ch.sections.filter((_, i) => v3Of(ch, i).video?.youtubeId).length;
    if (s.state !== 'done') setText(t[1], s.state === 'half' ? `${s.k} of ${s.n} sections done · ${ch.cards.length} cards` : `${s.n} sections · ${videos} videos · ${ch.cards.length} cards`);
    return c;
  });
  const head = find(find(main, byName('The course')), byName('Head'));
  if (head) setText(T(head)[0], `${finished} of ${all.length} done`);
  return page;
}

/* ---------------- the hub ---------------- */
const HUB_VIDEOS = {
  'Video · What It Takes': 'vHo_OsDWfpE', 'Video · The Journey, Level by Level': 'jiFXI8fFzhU', 'Video · What Does It Take to Be a Sommelier Today?': 'vHo_OsDWfpE',
  'Video · Decide What to Study': 'YKcbIjPuO7Q', 'Video · How Working the Floor Helps You Study': '_DoX91Lu1NE',
  'Video · After You Pass Level 1': 'RDcViBQkMm8', 'Video · How to Open a Bottle of Wine': '9R3JBuXcNjQ', 'Video · How to Open & Serve Sparkling Wine': 'XFiWNb9GMNE',
  'Video · How to Decant Wine': 'uOhVibnoThs', 'Video · Service Exam Advice': 'XlPAFfudZA4', 'Video · Memorization Tools for Theory': 'KLqUKJs1Qyw',
  'Video · How to Run a Tasting Group': 'sIyJ3x9d21I', 'Video · Prepping for an Exam? Some Advice': '9nO0Th332j4',
};
function wireVideos(main) {
  for (const n of findAll(main, (x) => HUB_VIDEOS[x.n])) n.vid = { kind: 'youtube', youtubeId: HUB_VIDEOS[n.n], title: n.n.replace('Video · ', '') + ' · Court of Master Sommeliers, Americas' };
}
export function hubPage(page, ctx) {
  const main = page.main;
  wireVideos(main);
  for (const b of findAll(main, (x) => x.n === 'Button · Start Level 1')) b.to = '/' + L1;
  const hc = find(find(main, byName('Hero')), byName('Copy'));
  if (hc) { const line = hc.c.filter((x) => x.t === 'T')[2]; if (line) line.n = 'Lead'; }
  for (const t of findAll(main, (x) => x.t === 'T' && (x.z || 0) >= 22)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  const cont = find(main, byName('Continue'));
  const nx = nextLesson(ctx.done);
  if (cont && nx?.started) {
    cont.to = '/' + lessonSlug(nx.ch, nx.i);
    const cc = T(find(cont, byName('Copy'))); setText(cc[1], `${nx.ch.title} · ${nx.ch.sections[nx.i].name}`);
    setText(cc[0], `PICK UP WHERE YOU LEFT OFF · ${courseProgress(ctx.done).pct}% OF LEVEL 1 DONE`);
    const s = chapterState(nx.ch, ctx.done); const pb = find(cont, byName('Progress')); if (pb?.c?.[0]) pb.c[0].w = Math.round((pb.w || 320) * (s.k / s.n));
    const th = cont.c.find((x) => (x.n || '').startsWith('IMG/')); const vv = v3Of(nx.ch, nx.i).video || nx.ch.v3?.video; if (th && vv) setImg(th, thumb(vv));
    const rb = find(cont, byName('Button · Resume')); if (rb) rb.to = cont.to;
  } else if (cont) remove(main, cont);
  const levels = find(main, byName('Levels'));
  if (levels) { const [a, b] = levels.c; if (a) a.to = '/' + L1; if (b) b.to = '/' + L2; }
  const book = find(main, byName('Book your seat'));
  if (book) {
    for (const d of book.c.filter((x) => (x.n || '').startsWith('Date · '))) { const lvl = d.n.includes('Level 1') ? 1 : 2; const rg = find(d, byName('Button · Register')); if (rg) rg.to = REGISTER[lvl]; }
    const copy = find(book, byName('Copy')); if (copy) { copy.to = '/' + DETAILS.hub; }
  }
  return page;
}

/* ---------------- Level 2 ---------------- */
export function level2Page(page) {
  const main = page.main;
  const hc = find(find(main, byName('Hero')), byName('Copy'));
  if (hc) {
    const line = hc.c.filter((x) => x.t === 'T')[2];
    // Level 2 lessons are next (Nov 1, Tommy: "have level two say 'coming soon'")
    if (line) { line.n = 'Lead'; setText(line, 'Lessons are coming soon. Watch the Court’s videos and read the exam details now.'); line.ar = 'H'; line.sh = 'F'; line.w = 520; }
    const pill = { t: 'F', n: 'Pill · Coming Soon', lm: 'H', pd: [6, 12, 6, 12], r: 999, f: [{ c: '#C49A6C' }], sh: 'H', sv: 'H', c: [txt('COMING SOON', { z: 11, c: '#1E1C1A', ls: '14%', fs: 'ExtraBold' })] };
    hc.c.splice(1, 0, pill);
  }
  for (const t of findAll(main, (x) => x.t === 'T' && (x.z || 0) >= 22)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  wireVideos(main);
  for (const b of findAll(main, (x) => (x.n || '').startsWith('Button · Book'))) b.to = REGISTER[2];
  // Level 2 lessons and the two practice tools are still being built: the parts open the exam details for now
  for (const b of findAll(main, (x) => x.n === 'Button · Start Part 1')) { b.to = '/' + DETAILS[2]; setText(texts(b)[0], 'Exam Details'); }
  for (const c of findAll(main, (x) => /^Part \d · /.test(x.n || ''))) {
    c.to = '/' + DETAILS[2];
    const pill = find(c, byName('Pill')); if (pill) setText(texts(pill)[0], 'Lessons Coming Soon');
  }
  for (const t of findAll(main, (x) => (x.n || '').startsWith('Tool · '))) {
    const b = t.c.find((x) => (x.n || '').startsWith('Button · ')); if (b) { setText(texts(b)[0], 'Coming Soon'); b.f = [{ c: '#3A3632' }]; for (const x of texts(b)) x.f = [{ c: '#B8AFA3' }]; delete b.to; }
  }
  return page;
}
