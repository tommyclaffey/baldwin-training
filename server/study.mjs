// The Sommelier Program, video first (Nov 1, Tommy: "add more photos, video, and flow … it feels very blocky and wordy").
// Figma section 17: hub 391:32, Level 1 course 392:31, lesson 403:45 (watch → swipe → read → check), Level 2 394:31.
// Lessons are one per chapter section (content/manual/<slug>.json → "v3", format in SCHEMA.md). The old long chapter
// page stays at <chapter>/whole-chapter, and the old hub / Level 1 / Level 2 pages stay as "Exam Details".
import fs from 'node:fs';
import path from 'node:path';
import { clone, find, findAll, byName, texts, setText, remove } from './templates.mjs';
import { chapters, chapters2, chaptersOf, levelChapters, chapterBase, GUIDE, LEVELS, levelFor, isProgram, programDef, progLevel, levelOfChapter, levelForChapter, quizHref, shuffleSeeded, blockBuilder, countWord } from './manual.mjs';

export const HUB = 'sommelier-program';
export const BAR_FINAL = 't:final:bar-1';
export const L1 = 'sommelier-program/level-1';
export const L2 = 'sommelier-program/level-2';
export const REGISTER = {
  1: 'https://portal.mastersommeliers.org/register?sgid=202565d15858479b9a1411d9db112f5e',
  2: 'https://portal.mastersommeliers.org/register?sgid=c6f9912b50984cdf8aaf65b76099975a',
};
export const DETAILS = { hub: 'sommelier-program/about', 1: 'sommelier-program/level-1/exam-details', 2: 'sommelier-program/level-2/exam-details' };

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Lesson addresses: the chapter's first section at /<guide>/<chapter>, the rest at /<guide>/<chapter>/<section>. */
export const lessonSlug = (ch, i) => (i === 0 ? `${chapterBase(ch)}/${ch.slug}` : `${chapterBase(ch)}/${ch.slug}/${slugify(ch.sections[i].name)}`);
export const wholeChapterSlug = (ch) => `${chapterBase(ch)}/${ch.slug}/whole-chapter`;
export const doneKey = (ch, i) => `${ch.slug}#${i}`;
export const lessonFile = (ch, i) => `l-${ch.slug}~${i}`;
const v3Of = (ch, i) => (ch.v3?.sections || []).find((x) => x.name === ch.sections[i].name) || {};
const thumb = (v) => (v?.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg` : null);
const asVid = (v) => (v?.youtubeId ? { kind: 'youtube', youtubeId: v.youtubeId, title: v.title } : null);
const T = (n) => (n?.c || []).filter((c) => c.t === 'T');
const setImg = (node, url) => { if (node && url) node.f = [{ img: url, m: 'FILL' }]; };

// Progress (Nov 1, Tommy: "show a completed section, like a percentage of the course … check it off, gray it out … with a green check mark")
const GREEN = '#2E7D45';
export function courseProgress(done, all = chapters()) { const total = all.reduce((a, c) => a + c.sections.length, 0);
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
export function nextLesson(done, all = chapters()) {
  for (const ch of all) { const s = chapterState(ch, done); if (s.state !== 'done') return { ch, i: s.next, started: s.k > 0 || done.size > 0 }; }
  return null;
}

/* ---------------- the Court's outcome card ---------------- */
const CURRICULUM = 'https://www.mastersommeliers.org/wp-content/uploads/2023/12/Introductory-Sommelier-Course-and-Certified-Somm-Theory-Exam-Curriculum-Guide.pdf';
const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['after', 'studying', 'section', 'student', 'students', 'candidate', 'will', 'know', 'with', 'their', 'from', 'wine', 'wines', 'able', 'understand', 'learn', 'selected', 'major', 'general', 'grape', 'varieties', 'variety', 'styles', 'style', 'regions', 'region', 'climate', 'location', 'geography', 'appellations', 'identify', 'recognize', 'locate', 'important', 'primary', 'different', 'methods', 'ways', 'made', 'production', 'definition', 'factor', 'terms', 'world', 'introduction', 'basics', 'what', 'that', 'this', 'into', 'within', 'about', 'their', 'other', 'main']);
const words = (x) => [...new Set(norm(x).split(' ').filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
/** Which lessons a coverage row points at: "Rioja", "Rioja; Priorat", "added: Cava (Priorat already covered)", "intro: …". */
const wheresOf = (c) => String(c.where || '').split(';').map((w) => w.replace(/\(.*?\)/g, '').replace(/^\s*added:\s*/i, '').trim()).filter(Boolean);
function rowsFor(ch, si) {
  const name = norm(ch.sections[si].name);
  return (ch.court?.coverage || []).filter((c) => wheresOf(c).some((w) => norm(w) === name || (si === 0 && /^intro\b/i.test(w))));
}
/** The Court's outcome(s) for this lesson. Chapters quote several subjects, as "Subject: quote | Subject: quote" or one
 *  sentence after another; a lesson shows only the ones about its own subject. */
function outcomesFor(ch, si, rows) {
  const raw = String(ch.court?.outcome || '').trim(); if (!raw) return [];
  // split at each "After studying this section"; a "Subject:" just before it belongs to the next piece
  const MARK = 'After studying this section';
  const parts = raw.split(MARK);
  const pieces = []; let subject = parts[0].replace(/[|]/g, '').trim().replace(/:$/, '').trim();
  for (let i = 1; i < parts.length; i++) {
    let body = parts[i];
    const m = /(?:^|[.|”"])\s*([^.|:]{2,80}):\s*\|?\s*$/.exec(body);
    let next = '';
    if (m) { next = m[1].replace(/^\|\s*/, '').trim(); body = body.slice(0, m.index + (m[0].match(/^[.|”"]/) ? 1 : 0)); }
    pieces.push({ subject, text: (MARK + body).replace(/\s*\|\s*$/, '').trim() });
    subject = next;
  }
  if (!pieces.length) pieces.push({ subject: '', text: raw });
  if (pieces.length === 1 && !pieces[0].subject) return pieces;
  // each covered row votes for the piece its subject names (so a lesson's own rows outweigh a few intro rows)
  const weak = words(ch.sections[si].name);
  const has = (hay, w) => new RegExp('\\b' + w.slice(0, Math.max(4, Math.min(w.length, 6)))).test(hay);
  const scored = pieces.map((p) => { const hay = norm(p.subject + ' ' + p.text);
    return { p, sc: rows.filter((r) => words(String(r.topic || '').split(' · ')[0]).some((w) => has(hay, w))).length * 2 + weak.filter((w) => has(hay, w)).length }; });
  const best = Math.max(...scored.map((x) => x.sc));
  return best > 0 ? scored.filter((x) => x.sc === best).slice(0, 2).map((x) => x.p) : [];
}
/** "BUSINESS OF THE SOMMELIER" → "Business of the Sommelier"; mixed-case subjects stay as written. */
const titleCase = (x) => (/[a-z]/.test(x) ? x : x.toLowerCase().replace(/\b([a-zà-ÿ])([a-zà-ÿ']*)/g, (m, a, b, i) => (i > 0 && ['of', 'the', 'and', 'a', 'an', 'in', 'on', 'to', 'for'].includes(m) ? m : a.toUpperCase() + b)));
export function courtCard(ch, si, lvl) {
  const ct = ch.court; if (!ct) return null;
  const rows = rowsFor(ch, si);
  const outs = outcomesFor(ch, si, rows);
  if (!outs.length && !rows.length) return null;
  const src = ct.outcomeSource || CURRICULUM;
  const docName = /Curriculum-Guide/i.test(src) ? 'Curriculum Guide' : /Syllabus/i.test(src) ? 'Syllabus' : /Guide/i.test(src) ? 'Exam Guide' : 'Court PDF';
  const t = (x, o) => ({ ...txt(x, o), ar: 'H', sh: 'L' });
  const MAX = 6; const shown = rows.slice(0, MAX);
  const row = (r) => ({ t: 'F', n: 'Asks · ' + String(r.topic || '').slice(0, 30), lm: 'H', gap: 10, sh: 'L', sv: 'H', c: [
    { t: 'F', n: 'Tick', w: 18, h: 18, r: 9, sh: 'F', sv: 'F', f: [{ c: r.tested === false ? '#B8AFA3' : '#1E1C1A' }], lm: 'H', pa: 'C', ca: 'C', c: [txt('✓', { z: 11, c: '#F2EEE7', fs: 'Bold' })] },
    { ...t(String(r.guide || r.topic).replace(/\s*\.$/, '.') + (r.tested === false ? ' (not tested at this level)' : ''), { z: 14, c: '#1E1C1A', fs: 'Medium' }), lh: '140%' },
  ] });
  const body = { t: 'F', n: 'Body', lm: 'V', gap: 16, pd: [22, 24, 22, 20], sh: 'L', sv: 'H', c: [
    { t: 'F', n: 'Head', lm: 'H', gap: 12, ca: 'C', sh: 'L', sv: 'H', c: [
      { t: 'F', n: 'Badge', w: 30, h: 30, r: 15, sh: 'F', sv: 'F', f: [{ c: '#1E1C1A' }], lm: 'H', pa: 'C', ca: 'C', c: [txt('C', { z: 14, c: '#F2EEE7', fs: 'ExtraBold' })] },
      { t: 'F', n: 'Titles', lm: 'V', gap: 2, sh: 'L', sv: 'H', c: [txt('WHAT THE COURT EXPECTS', { z: 11, ls: '12%', c: '#8A5A3A' }), t(`${lvl === 2 ? 'Certified' : 'Introductory'} level${outs.length === 1 && outs[0].subject ? ' · ' + titleCase(outs[0].subject) : ''}`, { z: 15, c: '#1E1C1A', fs: 'ExtraBold' })] },
      { t: 'F', n: 'Link · ' + docName, to: src, lm: 'H', pd: [8, 14, 8, 14], r: 17, st: '#1E1C1A', sw: 1, pa: 'C', ca: 'C', sh: 'H', sv: 'H', c: [txt(docName + ' ›', { z: 12.5, c: '#1E1C1A' })] },
    ] },
    ...outs.map((o, i) => ({ ...t(`“${o.text.replace(/^“|”$/g, '')}”`, { z: outs.length > 1 ? 16 : 18, c: '#1E1C1A', fs: 'Medium' }), n: 'Outcome · quoted' + (i ? ' ' + (i + 1) : ''), lh: '140%' })),
    ...(rows.length ? [
      txt(`WHAT THE COURT ASKS · COVERED IN THIS LESSON`, { z: 11, ls: '12%', c: '#5E574F' }),
      { t: 'F', n: 'Coverage', lm: 'V', gap: 8, sh: 'L', sv: 'H', c: [...shown.map(row), ...(rows.length > MAX ? [t(`+ ${rows.length - MAX} more in the ${docName}`, { z: 13, c: '#5E574F', fs: 'Medium' })] : [])] },
    ] : []),
    { ...t(`Source: Court of Master Sommeliers, ${docName}.${outs.length ? ' Outcome quoted word for word;' : ''} the checklist and lesson are in our own words.`, { z: 12.5, c: '#5E574F', fs: 'Regular' }), n: 'Source' },
  ] };
  return { t: 'F', n: 'Court · What the Court expects', lm: 'H', r: 18, clip: 1, f: [{ c: '#EFE7DA' }], sh: 'L', sv: 'H', c: [
    { t: 'F', n: 'Rule', w: 4, h: 40, sh: 'F', sv: 'L', f: [{ c: '#C49A6C' }] }, body] };
}

/* ---------------- lesson ---------------- */
export function lessonPage(tpl, chTpl, ch, si, ctx) {
  const main = clone(tpl.main);
  const sec = ch.sections[si]; const v = v3Of(ch, si); const r = v.read || {};
  const n = ch.sections.length; const all = levelChapters(ch);
  const isBar = isProgram(ch); const lvl = isBar ? progLevel(ch) : ch.level === 2 ? 2 : 1; const BL = levelForChapter(ch); const home = isBar ? BL.slug : lvl === 2 ? L2 : L1;
  const href = (c, i) => '/' + lessonSlug(c, i);

  // breadcrumb: Level 1 / Lesson N · Chapter / Section
  const bc = find(main, byName('Breadcrumb'));
  if (bc) { const t = texts(bc); setText(t[0], isBar ? `${programDef(ch.program).short} · Level ${lvl}` : `Level ${lvl}`); setText(t[2], `${lvl === 2 && ch.part ? `Part ${ch.part} · ` : ''}Lesson ${ch.number} · ${ch.title}`); setText(t[4], sec.name); const back = find(bc, byName('Back')); if (back) back.to = '/' + home; }

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
    if (v.video?.youtubeId) setText(credit, `Video: ${v.video.by}${v.video.length ? ' · ' + v.video.length : ''}`); else under.c = under.c.filter((x) => x !== credit);
  }

  // what the Court expects (Nov 2, Tommy: "use these resources to structure everything"): the Court's own learning
  // outcome, quoted, and the parts of its outline this lesson covers. Figma 423:53.
  const cc = courtCard(ch, si, lvl);
  if (cc && under) { const host = find(main, byName('Lesson')) || main; const at = host.c.indexOf(under); if (at >= 0) host.c.splice(at + 1, 0, cc); }

  // key points: cards that scroll sideways
  const kp = find(main, byName('Key points'));
  const pts = v.keyPoints || [];
  if (pts.length) {
    const head = find(kp, byName('Head'));
    head.c = head.c.filter((x) => !(x.n || '').startsWith('Arrow'));
    setText(T(head)[0], 'KEY POINTS');
    const cards = find(kp, byName('Cards')); const protos = cards.c;
    cards.c = pts.map((p, i) => { const c = clone(protos[i % protos.length]); c.n = 'Point · ' + p.big; const t = texts(c); setText(t[0], p.big); setText(t[1], p.line); t[0].ar = 'H'; t[0].sh = 'F';
      // Nov 9: a long word (CONTEMPORARY, BOTTLED-IN-BOND) shrinks to fit the card instead of being cut off
      { const longest = Math.max(...String(p.big).split(/\s+/).map((w) => w.length)); if (longest > 10 && t[0].z) t[0].z = Math.max(16, Math.floor(t[0].z * 10 / longest)); } if (pts.length > 3) { c.sh = 'F'; c.w = 220; } return c; });
    if (pts.length > 3) {
      // Nov 2, Tommy: "swipe is not working". The cards become a carousel: arrows, a count, and drag / swipe.
      cards.n = 'Carousel · Key points'; delete cards.clip; cards.wrap = 0;
      const btn = (name, glyph) => ({ t: 'F', n: name, w: 40, h: 40, sh: 'F', sv: 'F', f: [{ c: '#1E1C1A' }], r: 20, lm: 'H', pa: 'C', ca: 'C', c: [{ t: 'T', n: glyph, s: glyph, ff: 'Archivo', fs: 'SemiBold', z: 17, ar: 'W', sh: 'H', sv: 'H', f: [{ c: '#F2EEE7' }] }] });
      const count = { t: 'T', n: 'Carousel count', s: `1 of ${pts.length}`, ff: 'Archivo', fs: 'SemiBold', z: 14, ar: 'W', sh: 'H', sv: 'H', f: [{ c: '#5E574F' }] };
      head.c = [T(head)[0], { t: 'F', n: 'Carousel controls', lm: 'H', gap: 10, ca: 'C', sh: 'H', sv: 'H', c: [count, btn('Carousel prev', '←'), btn('Carousel next', '→')] }];
    } else { setText(T(head)[1], `${pts.length} cards`); cards.n = 'Cards'; }
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
      vis.lm = 'V'; vis.gap = 12; vis.sv = 'H'; vis.c = built.map((x) => { x.sh = 'L'; return x; }); // hugs its diagram, so nothing below gets covered
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
    if (r.sayIt) {
      const st = T(say)[1]; setText(st, `“${r.sayIt.replace(/^“|”$/g, '')}”`);
      // long lines wrap instead of running past the card (Nov 2)
      st.ar = 'H'; st.sh = 'L'; say.sh = 'L';
    } else remove(read, say);
    const src = read.c.filter((c) => c.t === 'T').pop();
    setText(src, sec.source ? `Source: ${sec.source}.` : ch.sources ? `Sources: ${ch.sources}` : ''); // a Cocktail Program section names its own sources
    src.ar = 'H'; src.sh = 'L'; delete src.h; // two lines of sources wrap instead of hiding the first
    // Cocktail Program (Nov 8): a lesson about a spirit links to that spirit's page on our back bar
    if (sec.book) {
      const link = { t: 'F', n: 'Button · On our back bar', to: '/' + sec.book, lm: 'H', gap: 8, pd: [10, 16, 10, 16], r: 999, st: '#1E1C1A', sw: 1, pa: 'C', ca: 'C', sh: 'H', sv: 'H',
        c: [txt('See it on our back bar  →', { z: 14, c: '#1E1C1A', fs: 'Bold' })] };
      read.c.splice(read.c.indexOf(src), 0, link);
    }
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
    // Nov 2, Tommy: "There is no completed checkbox over the sections." Every row gets one: a ring, then a green tick.
    c.c = c.c.filter((x) => x.n !== 'Done');
    c.c.push(state === 'done'
      ? { t: 'F', n: 'Done', w: 24, h: 24, r: 12, sh: 'F', sv: 'F', f: [{ c: GREEN }], lm: 'H', pa: 'C', ca: 'C', c: [txt('✓', { z: 13, c: '#FFFFFF', fs: 'ExtraBold' })] }
      : { t: 'F', n: 'Not done', w: 24, h: 24, r: 12, sh: 'F', sv: 'F', st: state === 'here' ? '#8A8178' : '#B8AFA3', sw: 2, lm: 'H', pa: 'C', ca: 'C' });
    if (state === 'done') markDone(th, false);
    const copy = find(c, byName('Copy')); const cp = T(copy);
    if (state === 'done') { cp[0].s = 'DONE'; cp[0].f = [{ c: GREEN }]; cp[1].f = [{ c: '#5E574F' }]; }
    if (state !== 'done') setText(cp[0], state === 'here' ? 'NOW PLAYING' : `SECTION ${i + 1}`); setText(cp[1], s.name);
    copy.sh = 'F'; copy.w = 172; cp[1].ar = 'H'; cp[1].sh = 'F'; cp[1].w = 172;
    return c;
  });
  const at = pl.c.indexOf(rows[0]);
  pl.c = [...pl.c.slice(0, at), ...built, ...pl.c.slice(at).filter((x) => !rows.includes(x))];
  const whole = find(pl, byName('Item · Easy to Mix Up'));
  if (whole && isBar) pl.c = pl.c.filter((x) => x !== whole);
  else if (whole) { whole.n = 'Row · Read Whole Chapter'; whole.to = '/' + wholeChapterSlug(ch); const t = T(whole); setText(t[0], 'Read Whole Chapter'); setText(t[1], `${ch.minutes || 20} min`); }
  const chk = find(pl, byName('Item · Check Yourself'));
  if (chk) { chk.n = 'Row · Check Yourself'; chk.to = quizHref(ch); setText(T(chk)[1], `${ch.cards.length} cards`); }
  {
    const nc = all[all.indexOf(ch) + 1];
    // the Cocktail Program's last lesson leads to its final exam
    const exam = !!BL && si === n - 1 && !nc; // every level's last lesson leads to its final (Sommelier too, Nov 8)
    const to = si < n - 1 ? href(ch, si + 1) : nc ? href(nc, 0) : exam ? '/quizzes?quiz=' + encodeURIComponent('t:' + BL.final) : '/' + home;
    const label = si < n - 1 ? 'Next Section' : nc ? 'Next Lesson' : exam ? 'Take the Final Exam' : `Back to Level ${lvl}`;
    const what = si < n - 1 ? ch.sections[si + 1].name : nc ? nc.title : exam ? (BL.finalLabel || `${BL.title} · Final Exam`) : `Level ${lvl}`;
    const eyebrow = si < n - 1 ? `UP NEXT · SECTION ${si + 2} OF ${n}` : nc ? `UP NEXT · LESSON ${nc.number}` : 'YOU’VE FINISHED THE LAST LESSON';
    const doneHere = ctx.done.has(doneKey(ch, si));
    const prevBtn = si > 0 ? [{ t: 'F', n: 'Button · Previous section', to: href(ch, si - 1), lm: 'H', gap: 8, pd: [14, 18, 14, 18], r: 999, st: '#4A4540', sw: 1, pa: 'C', ca: 'C', sh: 'H', sv: 'H', c: [txt('←  Previous', { z: 15, c: '#F2EEE7', fs: 'SemiBold' })] }] : [];
    const nextBtn = { t: 'F', n: 'Button · Next section', to, lm: 'H', gap: 10, pd: [16, 28, 16, 28], r: 999, f: [{ c: '#C49A6C' }], pa: 'C', ca: 'C', sh: 'H', sv: 'H', c: [txt(label + '  →', { z: 17, c: '#1E1C1A', fs: 'Bold' })] };
    const up = { t: 'F', n: 'Up next', lm: 'V', gap: 18, pd: [24, 24, 24, 24], r: 20, f: [{ c: '#1E1C1A' }], sh: 'L', sv: 'H', c: [
      { t: 'F', n: 'Up next copy', lm: 'V', gap: 6, sh: 'L', sv: 'H', c: [txt(eyebrow, { z: 11, ls: '12%', c: '#C49A6C' }), { ...txt(what, { z: 22, c: '#F2EEE7', fs: 'Bold' }), ar: 'H', sh: 'L' }] },
      { t: 'F', n: 'Up next actions', lm: 'H', gap: 12, pa: 'S', ca: 'C', sh: 'L', sv: 'H', c: [
        { t: 'F', n: 'Mark complete', w: 196, h: 48, sh: 'F', sv: 'F', meta: { complete: { key: doneKey(ch, si), done: doneHere } } },
        { t: 'F', n: 'Up next buttons', lm: 'H', gap: 10, ca: 'C', sh: 'H', sv: 'H', c: [...prevBtn, nextBtn] },
      ] },
    ] };
    const host = find(main, byName('Lesson')) || main;
    host.c.push(up);
  }
  const next = find(pl, byName('Button · Next: Alsace'));
  if (next) {
    const nc = all[all.indexOf(ch) + 1];
    if (si < n - 1) { next.to = href(ch, si + 1); setText(texts(next)[0], `Next: ${ch.sections[si + 1].name}`); }
    else if (nc) { next.to = href(nc, 0); setText(texts(next)[0], `Next Lesson: ${nc.title}`); }
    else { next.to = '/' + home; setText(texts(next)[0], `Back to Level ${lvl}`); }
    next.n = 'Button · Next';
  }
  return { id: tpl.id, name: `Study Guide · ${ch.title} · ${sec.name}`, bg: tpl.bg, main };
}

/** The lesson tiles (Figma 392:31): done, half-done and to-do cards, one per chapter. Returns how many are done. */
function lessonsGrid(grid, all, done) {
  const tiles = grid.c;
  const P = { done: tiles[0], half: tiles[3], todo: tiles[4] };
  let finished = 0; const used = new Set();
  grid.c = all.map((ch) => {
    const s = chapterState(ch, done); if (s.state === 'done') finished++;
    const c = clone(P[s.state]); c.n = `Lesson ${String(ch.number).padStart(2, '0')} · ${ch.title}`; c.to = '/' + lessonSlug(ch, s.state === 'done' ? 0 : s.next);
    const th = c.c.find((x) => (x.n || '').startsWith('IMG/'));
    // two lessons never share a thumbnail: if the chapter's video is already used, take its first section's
    let vid = ch.v3?.video || v3Of(ch, 0).video;
    if (vid?.youtubeId && used.has(vid.youtubeId)) vid = ch.sections.map((_, i) => v3Of(ch, i).video).find((x) => x?.youtubeId && !used.has(x.youtubeId)) || vid;
    if (vid?.youtubeId) used.add(vid.youtubeId);
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
    if (s.state !== 'done') setText(t[1], s.state === 'half' ? `${s.k} of ${s.n} sections done · ${ch.cards.length} cards` : `${s.n} sections${videos ? ` · ${videos} videos` : ''} · ${ch.cards.length} cards`);
    return c;
  });
  return finished;
}

/* ---------------- Level 1: the course ---------------- */
export function level1Page(page, ctx) {
  const main = page.main; const all = chapters();
  unclipHero(main); evenButtons(main);
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
  // Nov 8, Tommy: "you don't need to put the book link there", and keep it consistent with the Cocktail and Beer pages:
  // two buttons, Continue and Exam Details. Booking stays on the hub's dates band.
  if (book) { const d = clone(book); d.n = 'Button · Exam Details'; d.to = '/' + DETAILS[1]; setText(texts(d)[0], 'Exam Details'); btns.c = btns.c.filter((x) => x !== book); btns.c.push(d); btns.wrap = 1; btns.cg = 8; btns.sh = 'L'; }
  // the same four stats as the other programs: lessons, cards, then the exam's questions and pass mark
  { const gl = find(find(main, byName('Hero')), byName('At a glance'));
    const cards = all.reduce((k, c) => k + c.cards.length, 0);
    const stats = [[String(all.length), 'lessons'], [String(cards), 'cards'], ['70', 'questions'], ['80%', 'to pass']]; // our practice final (the Court's own exam is 60%)
    if (gl) gl.c.forEach((st, i) => { const tt = texts(st); if (stats[i]) { setText(tt[0], stats[i][0]); setText(tt[1], stats[i][1]); st.n = 'Stat · ' + stats[i][1]; } }); }
  const lead = find(find(main, byName('Hero')), (x) => x.t === 'T' && /video lessons/.test(x.s || ''));
  if (lead) { setText(lead, 'Twelve video lessons with practice cards, then two days with us.'); lead.n = 'Lead'; }
  for (const t of findAll(find(main, byName('Hero')) || { c: [] }, (x) => x.t === 'T' && (x.z || 0) >= 36)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  for (const t of findAll(find(main, byName('How it works')) || { c: [] }, (x) => x.t === 'T' && (x.s || '').length > 2)) { t.ar = 'H'; t.sh = 'L'; }
  const prog = courseProgress(ctx.done);
  const heroCopy = find(find(main, byName('Hero')), byName('Copy'));
  if (heroCopy) { const at = heroCopy.c.findIndex((x) => x.n === 'At a glance'); heroCopy.c.splice(at + 1, 0, progressBlock(prog, 398)); }
  // twelve lessons
  const grid = find(main, byName('Lessons'));
  const finished = lessonsGrid(grid, all, ctx.done);
  const head = find(find(main, byName('The course')), byName('Head'));
  if (head) setText(T(head)[0], `${finished} of ${all.length} done`);
  sommFinal(main, 1, ctx);
  return page;
}

/* ---------------- the hub ---------------- */
export const HUB_VIDEOS = {
  'Video · What It Takes': 'vHo_OsDWfpE', 'Video · The Journey, Level by Level': 'jiFXI8fFzhU', 'Video · What Does It Take to Be a Sommelier Today?': 'vHo_OsDWfpE',
  'Video · Decide What to Study': 'YKcbIjPuO7Q', 'Video · How Working the Floor Helps You Study': '_DoX91Lu1NE',
  'Video · After You Pass Level 1': 'RDcViBQkMm8', 'Video · How to Open a Bottle of Wine': '9R3JBuXcNjQ', 'Video · How to Open & Serve Sparkling Wine': 'XFiWNb9GMNE',
  'Video · How to Decant Wine': 'uOhVibnoThs', 'Video · Service Exam Advice': 'XlPAFfudZA4', 'Video · Memorization Tools for Theory': 'KLqUKJs1Qyw',
  'Video · How to Run a Tasting Group': 'sIyJ3x9d21I', 'Video · Prepping for an Exam? Some Advice': '9nO0Th332j4',
};
function wireVideos(main) {
  for (const n of findAll(main, (x) => HUB_VIDEOS[x.n])) n.vid = { kind: 'youtube', youtubeId: HUB_VIDEOS[n.n], title: n.n.replace('Video · ', '') + ' · Court of Master Sommeliers, Americas' };
}
// Nov 2: the Court's own documents, one tap away (Figma 423:117). We link to mastersommeliers.org; we don't copy.
const UP = 'https://www.mastersommeliers.org/wp-content/uploads/';
export const COURT_DOCS = [
  ['LEVEL 1 · INTRODUCTORY', false, [
    ['Course Guide', 'What the two days look like and how the exam works.', 'GUIDE', '2023/12/Introductory-Sommelier-Course-Guide-What-to-Expect.pdf'],
    ['Course Syllabus', 'Every topic the course and exam can cover.', 'SYLLABUS', '2023/12/Introductory-Sommelier-Course-Syllabus.pdf'],
    ['Curriculum Guide', 'What to know for each subject, Level 1 and Level 2 side by side.', 'CURRICULUM', '2023/12/Introductory-Sommelier-Course-and-Certified-Somm-Theory-Exam-Curriculum-Guide.pdf'],
    ['Practice Exam', 'Sample questions in the exam’s format. Try it after Lesson 12.', 'PRACTICE', '2024/03/Introductory-Sommelier-Course-Practice-Exam.pdf'],
    ['Tasting Journal', 'The Court’s note format for tasting at the Introductory level.', 'TASTING', '2024/03/Introductory-Tasting-Journal-2024.pdf'],
    ['Grape Variety Profiles', 'How the key grapes look, smell and taste.', 'GRAPES', '2024/10/Grape-Variety-Profiles-Introductory-Level.pdf'],
  ]],
  ['LEVEL 2 · CERTIFIED', true, [
    ['Exam Guide', 'What happens on exam day: theory, tasting and service.', 'GUIDE', '2023/12/Certified-Sommelier-Exam-Guide-What-to-Expect.pdf'],
    ['Exam Syllabus', 'The full list of topics for the Certified exam.', 'SYLLABUS', '2023/12/Certified-Sommelier-Exam-Syllabus.pdf'],
    ['Examinable Wines', 'The grapes and places the blind tasting wines are chosen from.', 'TASTING', '2023/12/Certified-Sommelier-Level-Wines.pdf'],
    ['Deductive Tasting Grid', 'The grid you fill in for each wine in the tasting exam.', 'TASTING', '2023/12/CMS-A-Certified-Sommelier-Deductive-Tasting-Grid.pdf'],
    ['Hospitality & Service Standards', 'How the service exam is judged at the table.', 'SERVICE', '2023/12/CMS-Hospitality-Service-Standards.pdf'],
    ['Example Feedback Report', 'What a candidate’s results look like, section by section.', 'RESULTS', '2026/04/Certified_Sommelier_Example_Feedback_Report_2026322.pdf'],
  ]],
];
function courtShelf() {
  const W = 1080, cw = Math.floor((W - 32) / 3);
  const group = ([label, dark, docs]) => ({ t: 'F', n: 'Group · ' + label, lm: 'V', gap: 12, sh: 'L', sv: 'H', c: [
    txt(label, { z: 11, ls: '12%', c: '#8A5A3A' }),
    { t: 'F', n: 'Docs', lm: 'H', gap: 16, wrap: 1, cg: 16, sh: 'L', sv: 'H', c: docs.map(([title, line, kind, file]) => {
      const fg = dark ? '#F2EEE7' : '#1E1C1A', sub = dark ? '#CFC6B9' : '#5E574F';
      return { t: 'F', n: 'Doc · ' + title, to: UP + file, lm: 'V', gap: 10, pd: [18, 20, 18, 20], r: 18, w: cw, h: 150, sh: 'F', sv: 'F', f: [{ c: dark ? '#1E1C1A' : '#EFE3D3' }], c: [
        { t: 'F', n: 'Top', lm: 'H', gap: 8, ca: 'C', sh: 'L', sv: 'H', c: [
          { t: 'F', n: 'Pill · PDF', lm: 'H', pd: [4, 8, 4, 8], r: 10, f: [{ c: '#C49A6C' }], pa: 'C', ca: 'C', sh: 'H', sv: 'H', c: [txt('PDF', { z: 10, ls: '10%', c: '#1E1C1A' })] },
          { ...txt(kind, { z: 10, ls: '10%', c: sub }), ar: 'H', sh: 'L' },
          txt('›', { z: 20, c: fg }),
        ] },
        { ...txt(title, { z: 18, c: fg, fs: 'ExtraBold' }), ar: 'H', sh: 'L' },
        { ...txt(line, { z: 14, c: sub, fs: 'Medium' }), ar: 'H', sh: 'L', lh: '135%' },
      ] };
    }) },
  ] });
  return { t: 'F', n: 'From the Court', lm: 'V', gap: 24, w: W, sh: 'L', sv: 'H', c: [
    { t: 'F', n: 'Head', lm: 'H', ca: 'M', sh: 'L', sv: 'H', c: [
      { t: 'F', n: 'Titles', lm: 'V', sh: 'L', sv: 'H', c: [
        { ...txt('Straight from the source', { z: 26, c: '#8A5A3A', fs: 'Regular' }), ff: 'Pinyon Script' },
        txt('FROM THE COURT', { z: 26, c: '#1E1C1A', fs: 'ExtraBold' }),
      ] },
      { ...txt('Official PDFs from the Court of Master Sommeliers · open in a new tab', { z: 13, c: '#5E574F', fs: 'Regular' }), ar: 'H', sh: 'H' },
    ] },
    ...COURT_DOCS.map(group),
  ] };
}
export function hubPage(page, ctx) {
  const main = page.main;
  unclipHero(main); evenButtons(main);
  wireVideos(main);
  { const at = main.c.findIndex((x) => x.n === 'Start here · videos'); main.c.splice(at >= 0 ? at + 1 : main.c.length - 1, 0, courtShelf()); }
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
// Nov 2: the nine Certified lessons (content/manual-l2), written from the Court's resource library. The parts open their
// first lesson; "The lessons" is the Level 1 course grid (Figma 392:31) with the Level 2 chapters. The two practice tools
// are still to come.
export function level2Page(page, ctx = {}) {
  const main = page.main; const all = chapters2(); const done = ctx.done || new Set();
  unclipHero(main); evenButtons(main);
  const live = all.length > 0;
  const hc = find(find(main, byName('Hero')), byName('Copy'));
  if (hc) {
    const line = hc.c.filter((x) => x.t === 'T')[2];
    if (line) { line.n = 'Lead'; setText(line, live ? `${all.length} video lessons in three parts, with practice cards. Then one day, three exams.` : 'Lessons are coming soon. Watch the Court’s videos and read the exam details now.'); line.ar = 'H'; line.sh = 'F'; line.w = 520; }
    if (!live) hc.c.splice(1, 0, { t: 'F', n: 'Pill · Coming Soon', lm: 'H', pd: [6, 12, 6, 12], r: 999, f: [{ c: '#C49A6C' }], sh: 'H', sv: 'H', c: [txt('COMING SOON', { z: 11, c: '#1E1C1A', ls: '14%', fs: 'ExtraBold' })] });
    else { const at = hc.c.findIndex((x) => x.n === 'Buttons'); hc.c.splice(at >= 0 ? at : hc.c.length, 0, progressBlock(courseProgress(done, all), 398)); }
  }
  for (const t of findAll(main, (x) => x.t === 'T' && (x.z || 0) >= 22)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  wireVideos(main);
  for (const b of findAll(main, (x) => (x.n || '').startsWith('Button · Book'))) b.to = REGISTER[2];
  const btns = find(find(main, byName('Hero')), byName('Buttons'));
  const book = btns && btns.c.find((x) => (x.n || '').startsWith('Button · Book'));
  if (book && live) { const d = clone(book); d.n = 'Button · Exam Details'; d.to = '/' + DETAILS[2]; setText(texts(d)[0], 'Exam Details'); btns.c = btns.c.filter((x) => x !== book); btns.c.push(d); btns.wrap = 1; btns.cg = 8; btns.sh = 'L'; }
  const nx = live && nextLesson(done, all);
  for (const b of findAll(main, (x) => x.n === 'Button · Start Part 1')) {
    if (!live) { b.to = '/' + DETAILS[2]; setText(texts(b)[0], 'Exam Details'); continue; }
    if (nx) { b.to = '/' + lessonSlug(nx.ch, nx.i); setText(texts(b)[0], nx.started ? `Continue Lesson ${nx.ch.number}` : 'Start Part 1'); } else { b.to = '/' + lessonSlug(all[0], 0); setText(texts(b)[0], 'Watch Again'); }
  }
  for (const c of findAll(main, (x) => /^Part \d · /.test(x.n || ''))) {
    const part = Number(/^Part (\d)/.exec(c.n)[1]); const mine = all.filter((ch) => ch.part === part);
    const pill = find(c, byName('Pill'));
    if (!mine.length) { c.to = '/' + DETAILS[2]; if (pill) setText(texts(pill)[0], 'Lessons Coming Soon'); continue; }
    const first = mine.find((ch) => chapterState(ch, done).state !== 'done') || mine[0];
    c.to = '/' + lessonSlug(first, chapterState(first, done).state === 'done' ? 0 : chapterState(first, done).next);
    const k = mine.filter((ch) => chapterState(ch, done).state === 'done').length;
    const cards = mine.reduce((a, ch) => a + ch.cards.length, 0);
    if (pill) setText(texts(pill)[0], `${mine.length} lesson${mine.length === 1 ? '' : 's'} · ${k ? `${k} done` : `${cards} cards`}`);
  }
  // the lessons, in the Level 1 course layout
  if (live && ctx.course) {
    const course = clone(ctx.course); course.n = 'The lessons';
    const grid = find(course, byName('Lessons'));
    const finished = lessonsGrid(grid, all, done);
    for (const tile of grid.c) { const ch = all.find((x) => tile.n.endsWith('· ' + x.title)); if (ch) tile.n = `Part ${ch.part} · Lesson ${String(ch.number).padStart(2, '0')} · ${ch.title}`; }
    const head = find(course, byName('Head'));
    if (head) { const tt = T(find(head, byName('Titles'))); setText(tt[0], 'Three parts, in exam order'); setText(tt[1], `${all.length} LESSON${all.length === 1 ? '' : 'S'}`); setText(T(head)[0], `${finished} of ${all.length} done`); }
    const at = main.c.findIndex((x) => x.n === 'Three parts');
    main.c.splice(at + 1, 0, course);
  }
  for (const t of findAll(main, (x) => (x.n || '').startsWith('Tool · '))) {
    const b = t.c.find((x) => (x.n || '').startsWith('Button · ')); if (b) { setText(texts(b)[0], 'Coming Soon'); b.f = [{ c: '#3A3632' }]; for (const x of texts(b)) x.f = [{ c: '#B8AFA3' }]; delete b.to; }
  }
  return page;
}

/* ---------------- the Cocktail Program (Nov 8) ---------------- */
// Tommy, Nov 8: "start building it in the app … we already have a skeleton with the wine program." Drawn from the
// Sommelier Level 1 course page (Figma 392:31): Level 1, Certified Bar Server, five lessons, then a final exam.
// The four levels (Tommy, Nov 6): Certified Bar Server → Certified Bartender → Advanced Mixologist → Master of the Bar.
export function barPage(page, ctx) {
  // Nov 8, the split: each level is its lessons, a final, and (from Level 2, or Beer Level 1) a practical a manager signs off,
  // like the Court's service exam and Cicerone's demonstration. Every program uses this page (Cocktail, Beer).
  const L = ctx.L || levelFor('bar', ctx.level || 1); const P = programDef(L.program);
  const main = page.main; const all = chaptersOf(L.program, L.level);
  if (!all.length) return page;
  const nx = nextLesson(ctx.done, all);
  const cards = all.reduce((k, c) => k + c.cards.length, 0);
  const finalHref = '/quizzes?quiz=' + encodeURIComponent('t:' + L.final);
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Detroit' }).toUpperCase();
  // breadcrumb: The Bar / Cocktail Program / Level N
  const bc = find(main, byName('Breadcrumb'));
  if (bc) { const t = texts(bc); const back = find(bc, byName('Back')); if (back) { back.to = P.back[0]; setText(T(back)[0], P.back[1]); } setText(t[2], P.name); t[2].n = P.name; t[2].to = '/' + P.slug; setText(t[4], `Level ${L.level}`); }
  // Level tabs (Nov 8, Tommy: "Only see level 1 … Do you have multiple levels?"): every level of the program, up top.
  // The current one is dark, built ones link, the rest are dimmed with "Coming".
  if (bc) {
    const holder = main.c.includes(bc) ? main : find(main, (x) => (x.c || []).includes(bc));
    const tab = (i) => {
      const built = LEVELS.find((x) => x.program === L.program && x.level === i + 1 && chaptersOf(x.program, x.level).length);
      const here = i + 1 === L.level;
      const label = `Level ${i + 1} · ${P.ladder[i]}${built ? '' : ' · Coming'}`;
      return { t: 'F', n: 'Level tab · ' + (i + 1), lm: 'H', pa: 'C', ca: 'C', sh: 'H', sv: 'H', r: 999, pd: [9, 16, 9, 16],
        ...(here ? { f: [{ c: '#1E1C1A' }] } : { st: built ? '#8A8178' : '#CFC6B8', sw: 1 }), ...(built && !here ? { to: '/' + built.slug } : {}),
        c: [txt(label, { z: 14, c: here ? '#F2EEE7' : built ? '#1E1C1A' : '#5E574F', fs: here ? 'Bold' : built ? 'SemiBold' : 'Medium' })] };
    };
    const tabs = { t: 'F', n: 'Level tabs', lm: 'H', gap: 8, wrap: 1, cg: 8, sh: 'F', sv: 'H', c: P.ladder.map((_, i) => tab(i)) };
    holder.c.splice(holder.c.indexOf(bc) + 1, 0, tabs);
  }
  const hero = find(main, byName('Hero'));
  const hv = find(hero, (x) => !!x.vid || (x.n || '').includes('YouTube R6ESxHbDSrg'));
  if (hv) { delete hv.vid; hv.n = P.heroName; hv.f = [{ img: P.hero, m: 'FILL' }]; hv.c = []; }
  const copy = find(hero, byName('Copy'));
  const ct = T(copy);
  // script like the Sommelier's (Tommy, Nov 8: uniform with the som); the program is in the breadcrumb
  setText(ct[0], `Level ${['', 'one', 'two', 'three', 'four'][L.level]}`); setText(ct[1], L.title.toUpperCase()); ct[1].ar = 'H'; ct[1].sh = 'F';
  const lead = find(hero, (x) => x.n === 'Lead' || (x.t === 'T' && /video lessons/.test(x.s || '')));
  if (lead) { lead.n = 'Lead'; setText(lead, L.lead(all.length, L)); }
  for (const t of findAll(hero, (x) => x.t === 'T' && (x.z || 0) >= 36)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  const glance = find(hero, byName('At a glance'));
  if (glance) {
    const stats = [[String(all.length), 'lessons'], [String(cards), 'cards'], [String(L.len), 'questions'], L.practical ? ['1', 'practical'] : ['80%', 'to pass']];
    glance.c.forEach((st, i) => { const tt = texts(st); if (stats[i]) { setText(tt[0], stats[i][0]); setText(tt[1], stats[i][1]); st.n = 'Stat · ' + stats[i][1]; } });
  }
  const prog = courseProgress(ctx.done, all);
  if (copy) { const at = copy.c.findIndex((x) => x.n === 'At a glance'); copy.c.splice(at + 1, 0, progressBlock(prog, 398)); }
  // the final and the practical: one line at most, so the hero keeps the Sommelier page's height (Tommy, Nov 8)
  if (copy) {
    let line = null;
    const certified = ctx.passedAt && (!L.practical || ctx.practical);
    if (certified) line = txt(`✓ ${L.title.toUpperCase()} · ${day(ctx.practical?.at > ctx.passedAt ? ctx.practical.at : ctx.passedAt)}`, { ls: '10%', c: '#7FCB93', z: 12.5 });
    else if (ctx.passedAt) line = txt('✓ FINAL PASSED · PRACTICAL: ASK A MANAGER WHEN READY', { ls: '10%', c: '#7FCB93', z: 12.5 });
    else if (ctx.practical) line = txt(`✓ PRACTICAL SIGNED OFF${ctx.practical.by ? ' BY ' + ctx.practical.by.toUpperCase() : ''}`, { ls: '10%', c: '#7FCB93', z: 12.5 });
    if (line) { line.n = 'Status line'; line.ar = 'H'; line.sh = 'F'; line.w = 398; copy.c.splice(copy.c.findIndex((x) => x.n === 'Course progress') + 1, 0, line); }
  }
  const btns = find(hero, byName('Buttons'));
  if (btns) {
    const cont = btns.c.find((x) => (x.n || '').startsWith('Button · Continue'));
    const book = btns.c.find((x) => (x.n || '').startsWith('Button · Book'));
    if (cont) { cont.n = 'Button · Continue'; cont.to = '/' + lessonSlug(nx ? nx.ch : all[0], nx ? nx.i : 0); setText(texts(cont)[0], !nx ? 'Watch Again' : nx.started ? `Continue Lesson ${nx.ch.number}` : 'Start Lesson 1'); }
    const exam = book && clone(book);
    if (exam) { exam.n = 'Button · Final Exam'; exam.to = finalHref; setText(texts(exam)[0], ctx.passedAt ? 'Retake Final Exam' : 'Final Exam'); }
    // Certified (Nov 8, Figma 09 · Proposals → 22, 469:45): View Certificate takes the lead button's place.
    const certified = ctx.passedAt && (!L.practical || ctx.practical);
    if (certified && cont) { cont.n = 'Button · View Certificate'; cont.to = `/certificate/${L.file}`; setText(texts(cont)[0], 'View Certificate'); }
    btns.c = [cont, exam].filter(Boolean); btns.wrap = 1; btns.cg = 8; btns.sh = 'L';
    delete btns.clip; delete btns.h; btns.sv = 'H';
    evenButtons(main);
  }
  // the lessons
  const course = find(main, byName('The course'));
  const head = find(course, byName('Head'));
  const grid = find(course, byName('Lessons'));
  const finished = lessonsGrid(grid, all, ctx.done);
  if (head) { const ht = texts(head); setText(ht[0], L.head); setText(ht[1], `${all.length} LESSONS`); setText(ht[ht.length - 1], `${finished} of ${all.length} done`); }
  // how it works, then the four levels
  const how = find(main, byName('How it works'));
  if (how) {
    const steps = L.practical
      ? ['Watch or read the lesson', 'Answer 3 cards per section', `Pass the ${L.len}-question final`, L.practicalStep]
      : ['Watch or read the lesson', 'Swipe the key points', 'Answer 3 cards per section', `Pass the ${L.len}-question final`];
    how.c.forEach((st, i) => { const tt = texts(st); if (steps[i]) setText(tt[tt.length - 1], steps[i]); });
    const levels = clone(how); levels.n = 'The four levels';
    const names = P.ladder;
    levels.c.forEach((st, i) => {
      const built = LEVELS.find((x) => x.program === L.program && x.level === i + 1 && chaptersOf(x.program, x.level).length); const tt = texts(st);
      setText(tt[tt.length - 1], names[i] + (built ? '' : ' · coming'));
      st.n = 'Level · ' + names[i];
      if (!built) st.op = 0.55; else if (i + 1 !== L.level) st.to = '/' + built.slug;
    });
    const at = main.c.indexOf(how);
    main.c.splice(at + 1, 0, { t: 'F', n: 'Levels', lm: 'V', gap: 14, w: how.w, sh: 'F', sv: 'H', c: [txt('THE FOUR LEVELS', { ls: '12%', c: '#8A5A3A', z: 12 }), levels] });
  }
  return page;
}

/* ---------------- program hubs (Nov 8) ---------------- */
// Tommy, Nov 8: "build out a homepage exactly like the som … mirror structurally the way the wine program is. It's just beer
// and bartending." Drawn from the Sommelier Program hub (Figma 391:32): hero, pick up where you left off, the four levels,
// start-here videos, a shelf of sources, and a dark band (the Sommelier's exam dates; here, each level's final).
const HUB_COPY = {
  bar: {
    script: 'Our bar training', lead: 'Learn it, practise it, then earn your certificate: three levels, from the floor to the bar lead.',
    who: ['Everyone on the floor', 'Bartenders', 'Bar leads'], cards: ['/img/5e5d6ac14e27.jpg', '/img/9dafca12fbe5.jpg', '/img/classic-bees-knees.jpg', '/img/fe067d97b4ac.jpg'],
    videosHead: ['A few minutes each', 'The six roots, from Anders Erickson'],
    shelf: ['Where our lessons come from', 'Laws, guides and books our lessons cite · open in a new tab', [
      ['THE RULES', false, [
        ['US spirits standards', '27 CFR 5.143: what makes bourbon, rye and the rest.', 'LAW', 'https://www.law.cornell.edu/cfr/text/27/5.143'],
        ['EU spirit drinks', 'Regulation 2019/787: gin, liqueurs, rum and brandy.', 'LAW', 'https://eur-lex.europa.eu/eli/reg/2019/787/oj'],
        ['Scotch Whisky Regulations', 'The 2009 rules: the five kinds and the regions.', 'LAW', 'https://www.legislation.gov.uk/uksi/2009/2890'],
      ]],
      ['THE CRAFT', true, [
        ['Cocktail Codex', 'The six root recipes behind Levels 2 and 3.', 'BOOK', 'https://www.randomhousebooks.com/books/534533'],
        ['Rich vs simple syrup', 'Difford’s Guide on 2:1 and 1:1, and how to swap them.', 'GUIDE', 'https://www.diffordsguide.com/encyclopedia/3593/cocktails/2-to-1-rich-sugar-syrup-versus-1-to-1-simple-syrup'],
        ['Fresh lime juice', 'Dave Arnold’s 2010 blind test of lime juice by age.', 'ARTICLE', 'https://cookingissues.com/2010/10/01/fresh-lime-juice-wtf/'],
      ]],
    ]],
  },
  beer: {
    script: 'Built on Cicerone’s outline', lead: 'From the first pour to running the program, with a certificate at every level.',
    who: ['Everyone who pours', 'Bartenders', 'Whoever runs the beer'], cards: ['/img/cc320d4a67b8.jpg', '/img/bb23f11b90c9.jpg', '/img/cbff01f7a889.jpg', '/img/f63b1d92dbf9.jpg'],
    videosHead: null,
    shelf: ['Straight from the source', 'Official guides from Cicerone, the Brewers Association and the BJCP · open in a new tab', [
      ['CICERONE', false, [
        ['Certified Beer Server syllabus', 'Everything Level 1 follows, topic by topic.', 'PDF', 'https://www.cicerone.org/sites/default/files/resources/US_English_CBS_Syllabus_V6.0_0.pdf'],
        ['Certified Cicerone syllabus', 'The outline behind Level 2.', 'PDF', 'https://www.cicerone.org/sites/default/files/resources/US_English_CC_Syllabus_V6.0.pdf'],
        ['Beer Server exam FAQ', '60 questions, 30 minutes, 75% to pass, $79 for two tries.', 'FAQ', 'https://support.cicerone.org/en/support/solutions/articles/69000179490-certified-beer-server-exam-frequently-asked-questions-faq-'],
      ]],
      ['THE REFERENCES', true, [
        ['Draught Beer Quality Manual', 'The Brewers Association’s guide to draft systems.', 'PDF', 'https://cdn.brewersassociation.org/wp-content/uploads/2019/03/13094643/Draught-Beer-Quality-Manual-2019.pdf'],
        ['BJCP Style Guidelines', 'Every style, with its numbers (2021 edition).', 'PDF', 'https://www.bjcp.org/wp-content/uploads/2025/02/2021_Guidelines_Beer_1.25.pdf'],
        ['Beer and food', 'The Brewers Association’s pairing guide.', 'PDF', 'https://www.cicerone.org/sites/default/files/resources/Beer_and_Food_English.pdf'],
      ]],
    ]],
  },
};
function sourceShelf([script, sub, groups]) {
  const W = 1080, cw = Math.floor((W - 32) / 3);
  const group = ([label, dark, docs]) => ({ t: 'F', n: 'Group · ' + label, lm: 'V', gap: 12, sh: 'L', sv: 'H', c: [
    txt(label, { z: 11, ls: '12%', c: '#8A5A3A' }),
    { t: 'F', n: 'Docs', lm: 'H', gap: 16, wrap: 1, cg: 16, sh: 'L', sv: 'H', c: docs.map(([title, line, kind, url]) => {
      const fg = dark ? '#F2EEE7' : '#1E1C1A', sub2 = dark ? '#CFC6B9' : '#5E574F';
      return { t: 'F', n: 'Doc · ' + title, to: url, lm: 'V', gap: 10, pd: [18, 20, 18, 20], r: 18, w: cw, h: 150, sh: 'F', sv: 'F', f: [{ c: dark ? '#1E1C1A' : '#EFE3D3' }], c: [
        { t: 'F', n: 'Top', lm: 'H', gap: 8, ca: 'C', sh: 'L', sv: 'H', c: [
          { t: 'F', n: 'Pill · ' + kind, lm: 'H', pd: [4, 8, 4, 8], r: 10, f: [{ c: '#C49A6C' }], pa: 'C', ca: 'C', sh: 'H', sv: 'H', c: [txt(kind, { z: 10, ls: '10%', c: '#1E1C1A' })] },
          { ...txt('', { z: 10, c: sub2 }), ar: 'H', sh: 'L' },
          txt('›', { z: 20, c: fg }),
        ] },
        { ...txt(title, { z: 18, c: fg, fs: 'ExtraBold' }), ar: 'H', sh: 'L' },
        { ...txt(line, { z: 14, c: sub2, fs: 'Medium' }), ar: 'H', sh: 'L', lh: '135%' },
      ] };
    }) },
  ] });
  return { t: 'F', n: 'Sources', lm: 'V', gap: 24, w: W, sh: 'L', sv: 'H', c: [
    { t: 'F', n: 'Head', lm: 'H', ca: 'M', sh: 'L', sv: 'H', c: [
      { t: 'F', n: 'Titles', lm: 'V', sh: 'L', sv: 'H', c: [
        { ...txt(script, { z: 26, c: '#8A5A3A', fs: 'Regular' }), ff: 'Pinyon Script' },
        txt('OUR SOURCES', { z: 26, c: '#1E1C1A', fs: 'ExtraBold' }),
      ] },
      { ...txt(sub, { z: 13, c: '#5E574F', fs: 'Regular' }), ar: 'H', sh: 'H' },
    ] },
    ...groups.map(group),
  ] };
}
export function programHub(page, ctx) {
  const P = programDef(ctx.program); const H = HUB_COPY[P.key];
  const main = page.main;
  unclipHero(main); evenButtons(main);
  const levels = LEVELS.filter((L) => L.program === P.key && chaptersOf(P.key, L.level).length);
  const all = chaptersOf(P.key); const done = ctx.done || new Set(); const certified = ctx.certified || new Set();
  // hero
  const hero = find(main, byName('Hero'));
  if (hero) { hero.f = [{ img: P.hero, m: 'FILL' }]; }
  const hc = find(hero, byName('Copy'));
  if (hc) {
    const ts = hc.c.filter((x) => x.t === 'T');
    setText(ts[0], H.script); ts[0].n = 'Script';
    setText(ts[1], P.name.toUpperCase().replace(' ', '\n')); ts[1].n = 'Title';
    setText(ts[2], H.lead); ts[2].n = 'Lead';
    const btns = find(hc, byName('Buttons'));
    if (btns) {
      const start = btns.c.find((x) => (x.n || '').startsWith('Button · Start'));
      const nx0 = nextLesson(done, all); const nx = nx0 && { ...nx0, started: all.some((c) => chapterState(c, done).k > 0) };
      if (start) { start.n = 'Button · Start'; start.to = '/' + (nx?.started ? lessonSlug(nx.ch, nx.i) : levels[0].slug); setText(texts(start)[0], nx?.started ? `Continue Level ${progLevel(nx.ch)}` : 'Start Level 1'); }
      const vb = btns.c.find((x) => (x.n || '').startsWith('Video · '));
      const v0 = P.key === 'bar' && chaptersOf('bar').find((c) => c.slug === 'bar-six-roots')?.v3?.sections?.[0]?.video;
      if (vb && v0) { vb.n = 'Video · ' + v0.title; vb.vid = asVid(v0); setText(texts(vb)[0], `The Old Fashioned · ${v0.length}`); }
      else if (vb) btns.c = btns.c.filter((x) => x !== vb);
    }
  }
  for (const t of findAll(main, (x) => x.t === 'T' && (x.z || 0) >= 22)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  // pick up where you left off
  const cont = find(main, byName('Continue'));
  const nx = nextLesson(done, all); const begun = all.some((c) => chapterState(c, done).k > 0);
  if (cont && nx && begun) {
    cont.to = '/' + lessonSlug(nx.ch, nx.i);
    const cc = T(find(cont, byName('Copy'))); setText(cc[1], `Level ${progLevel(nx.ch)} · ${nx.ch.title} · ${nx.ch.sections[nx.i].name}`);
    const lvlAll = chaptersOf(P.key, progLevel(nx.ch));
    setText(cc[0], `PICK UP WHERE YOU LEFT OFF · ${courseProgress(done, lvlAll).pct}% OF LEVEL ${progLevel(nx.ch)} DONE`);
    const s = chapterState(nx.ch, done); const pb = find(cont, byName('Progress')); if (pb?.c?.[0]) pb.c[0].w = Math.round((pb.w || 320) * (s.k / s.n));
    const th = cont.c.find((x) => (x.n || '').startsWith('IMG/'));
    const vv = v3Of(nx.ch, nx.i).video; const ph = photoOf(nx.ch, nx.ch.sections[nx.i]);
    if (th) { delete th.vid; th.n = 'IMG/Lesson'; setImg(th, thumb(vv) || ph); if (!thumb(vv)) th.c = (th.c || []).filter((x) => x.n !== 'Play'); }
    const rb = find(cont, byName('Button · Resume')); if (rb) rb.to = cont.to;
  } else if (cont) remove(main, cont);
  // the four levels
  const lv = find(main, byName('Levels'));
  if (lv) lv.c.forEach((card, i) => {
    const L = levels.find((x) => x.level === i + 1);
    card.n = `Level ${i + 1} · ${P.ladder[i]}`; card.f = [{ img: H.cards[i], m: 'FILL' }];
    const tt = texts(card);
    setText(tt[0], `LEVEL ${i + 1}`); setText(tt[1], P.ladder[i]);
    const n = L ? chaptersOf(P.key, L.level).length : 0;
    setText(tt[2], !L ? 'Coming' : certified.has(L.file) ? '✓ Certified' : `${H.who[i]} · ${n} lessons`);
    if (L) card.to = '/' + L.slug; else delete card.to;
    // the design's copy box was sized for "Introductory": let it use the card's width so names and pills don't clip
    const cp = find(card, byName('Copy')); if (cp) { cp.w = Math.round((card.w || 260) - 40); delete cp.clip; cp.sh = 'F'; }
    const pill = find(card, byName('Pill')); if (pill) { delete pill.clip; pill.sh = 'H'; delete pill.w; for (const x of texts(pill)) { x.ar = 'W'; delete x.w; } }
    tt[1].ar = 'H'; tt[1].sh = 'F'; tt[1].w = cp ? cp.w : tt[1].w;
  });
  // start here: videos (Cocktail: the six roots), or nothing
  const sh = find(main, byName('Start here · videos'));
  const roots = P.key === 'bar' ? (chaptersOf('bar').find((c) => c.slug === 'bar-six-roots')?.v3?.sections || []).map((s) => s.video).filter(Boolean) : [];
  if (sh && H.videosHead && roots.length >= 4) {
    const ht = texts(find(sh, byName('Head'))); setText(ht[0], H.videosHead[0]); setText(ht[2], H.videosHead[1]); ht[2].n = 'Source';
    const cards = find(sh, byName('Videos')).c;
    cards.forEach((card, i) => {
      const v = roots[i]; if (!v) return;
      card.n = 'Video · ' + v.title;
      const im = card.c.find((x) => (x.n || '').startsWith('IMG/')); if (im) { im.n = `IMG/Video · ${v.title} · ${v.by} (YouTube ${v.youtubeId})`; setImg(im, thumb(v)); im.vid = asVid(v); }
      const tt = texts(card); setText(tt[0], v.length); setText(tt[1], v.title); setText(tt[2], v.by.toUpperCase());
    });
  } else if (sh) remove(main, sh);
  // our sources, after the videos (or the levels)
  { const at = main.c.findIndex((x) => x.n === 'Start here · videos' || x.n === 'Your path'); const after = main.c.findIndex((x) => x.n === 'Start here · videos'); main.c.splice((after >= 0 ? after : at) + 1, 0, sourceShelf(H.shelf)); }
  // no Sommelier names left in layer names either
  for (const n of findAll(main, (x) => x.t === 'T' && /Court|Testa Barra|Sommelier/.test(x.n || ''))) n.n = String(n.s).slice(0, 40);
  // the dark band: each level's final, or its certificate
  const book = find(main, byName('Book your seat'));
  if (book) {
    const bt = texts(find(book, byName('Copy'))); setText(bt[0], 'EARN YOUR CERTIFICATES'); setText(bt[1], 'The finals');
    const tpl = book.c.find((x) => (x.n || '').startsWith('Date · '));
    const cards = levels.map((L) => {
      const d = clone(tpl); d.n = `Final · Level ${L.level}`;
      const ct = texts(find(d, byName('Copy'))); setText(ct[0], `Level ${L.level} · ${L.len} questions`); setText(ct[1], L.title);
      const b = find(d, (x) => (x.n || '').startsWith('Button · ')); const has = certified.has(L.file);
      b.n = has ? 'Button · View Certificate' : 'Button · Take the Final'; b.to = has ? `/certificate/${L.file}` : '/quizzes?quiz=' + encodeURIComponent('t:' + L.final);
      setText(texts(b)[0], has ? 'Certificate' : 'Take It');
      return d;
    });
    const rest = book.c.filter((x) => !(x.n || '').startsWith('Date · '));
    book.c = [...rest, { t: 'F', n: 'Finals', lm: 'H', gap: 12, wrap: 1, cg: 12, sh: 'H', sv: 'H', c: cards }]; book.wrap = 1; book.cg = 16;
    const copy = find(book, byName('Copy')); if (copy) delete copy.to;
  }
  return page;
}

/** Nov 8, Tommy's screenshot: the hero's outlined video button lost the bottom of its border to the row's clip. */
function unclipHero(main) {
  const hero = find(main, byName('Hero')); const copy = hero && find(hero, byName('Copy')); const btns = copy && find(copy, byName('Buttons'));
  for (const n of [copy, btns]) if (n) { delete n.clip; delete n.h; n.sv = 'H'; }
  for (const b of btns?.c || []) { delete b.clip; delete b.h; b.sv = 'H'; }
}

/** Nov 8 (Tommy: "spacing/sizing … uniform with the som and beer"): a filled hero button gets a hairline in its own colour,
 *  so it's exactly as tall as the outlined one beside it (41 vs 43 px before). */
function evenButtons(main) {
  const hero = find(main, byName('Hero')); const btns = hero && find(hero, byName('Buttons'));
  for (const b of btns?.c || []) if (!b.st && b.f?.[0]?.c) { b.st = b.f[0].c; b.sw = 1; }
}

/* ---------------- Level 2 on the Level 1 layout (Nov 8) ---------------- */
// Tommy, Nov 8: "Yes" to switching Sommelier Level 2 to the Level 1 layout so all three programs match at every level
// (Figma 392:31). The Level 2 sections that have no Level 1 counterpart (the three exam parts, the Court's service videos,
// study tips, the practice tools) follow the lessons.
export function level2OnLevel1(p1, old, ctx = {}) {
  const main = p1.main; const all = chapters2(); const done = ctx.done || new Set();
  unclipHero(main);
  const bc = find(main, byName('Breadcrumb')); if (bc) { const t = texts(bc); setText(t[t.length - 1], 'Level 2'); }
  const hero = find(main, byName('Hero'));
  const hv = find(hero, (x) => (x.n || '').includes('YouTube R6ESxHbDSrg'));
  if (hv) {
    hv.n = 'IMG/Video · After You Pass Level 1 · Court of Master Sommeliers (YouTube RDcViBQkMm8)';
    hv.f = [{ img: 'https://i.ytimg.com/vi/RDcViBQkMm8/maxresdefault.jpg', m: 'FILL' }];
    hv.vid = { kind: 'youtube', youtubeId: 'RDcViBQkMm8', title: 'After You Pass Level 1 · Court of Master Sommeliers, Americas' };
    const dur = find(hv, byName('Duration')); if (dur) setText(texts(dur)[0], '1:08');
  }
  const copy = find(hero, byName('Copy')); const ct = T(copy);
  setText(ct[0], 'Level two'); setText(ct[1], 'CERTIFIED');
  const lead = find(hero, (x) => x.t === 'T' && /video lessons/.test(x.s || ''));
  if (lead) { setText(lead, `${countWord(all.length)} video lessons in three parts, with practice cards. Then one day, three exams.`); lead.n = 'Lead'; }
  const gl = find(hero, byName('At a glance'));
  const cards = all.reduce((k, c) => k + c.cards.length, 0);
  const stats = [[String(all.length), 'lessons'], [String(cards), 'cards'], ['45', 'questions'], ['1', 'practical']]; // our theory final + mock service, like Cocktail and Beer
  if (gl) gl.c.forEach((st, i) => { const tt = texts(st); if (stats[i]) { setText(tt[0], stats[i][0]); setText(tt[1], stats[i][1]); st.n = 'Stat · ' + stats[i][1]; } });
  if (copy) { const at = copy.c.findIndex((x) => x.n === 'At a glance'); copy.c.splice(at + 1, 0, progressBlock(courseProgress(done, all), 398)); }
  const btns = find(hero, byName('Buttons'));
  if (btns) {
    const cont = btns.c.find((x) => (x.n || '').startsWith('Button · Continue'));
    const book = btns.c.find((x) => (x.n || '').startsWith('Button · Book'));
    const nx = nextLesson(done, all); const begun = all.some((c) => chapterState(c, done).k > 0);
    if (cont) { cont.n = 'Button · Continue'; cont.to = '/' + lessonSlug(nx ? nx.ch : all[0], nx ? nx.i : 0); setText(texts(cont)[0], !nx ? 'Watch Again' : begun ? `Continue Lesson ${nx.ch.number}` : 'Start Part 1'); }
    const d = book && clone(book);
    if (d) { d.n = 'Button · Exam Details'; d.to = '/' + DETAILS[2]; setText(texts(d)[0], 'Exam Details'); }
    btns.c = [cont, d].filter(Boolean); btns.wrap = 1; btns.cg = 8; btns.sh = 'L';
    delete btns.clip; delete btns.h; btns.sv = 'H';
  }
  evenButtons(main);
  for (const t of findAll(hero || { c: [] }, (x) => x.t === 'T' && (x.z || 0) >= 36)) t.lw = Math.max(...String(t.s).split(/[\s-]+/).map((w) => w.length));
  // the nine lessons, labelled by part
  const course = find(main, byName('The course'));
  const grid = find(course, byName('Lessons'));
  const finished = lessonsGrid(grid, all, done);
  for (const tile of grid?.c || []) { const ch = all.find((x) => (tile.n || '').endsWith('· ' + x.title)); if (ch) tile.n = `Part ${ch.part} · Lesson ${String(ch.number).padStart(2, '0')} · ${ch.title}`; }
  const head = find(course, byName('Head'));
  if (head) { const ht = texts(head); setText(ht[0], 'Three parts, in exam order'); setText(ht[1], `${all.length} LESSONS`); setText(ht[ht.length - 1], `${finished} of ${all.length} done`); }
  // the Level 2 sections that have no Level 1 twin
  const keep = (old?.main?.c || []).filter((x) => ['Three parts', 'WATCH THE SERVICE', 'STUDY TIPS'] /* Nov 10: the unbuilt practice tools stay off until they're built */.includes(x.n));
  const at = main.c.indexOf(course);
  main.c.splice(at + 1, 0, ...keep);
  for (const t of findAll(find(main, byName('How it works')) || { c: [] }, (x) => x.t === 'T' && (x.s || '').length > 2)) { t.ar = 'H'; t.sh = 'L'; }
  sommFinal(main, 2, ctx);
  return p1;
}

/** Sommelier level heroes (Nov 8): the same two buttons as Cocktail and Beer (Continue or View Certificate, then the
 *  final), the one status line, and the Court's exam details as a small link under the buttons. */
export function sommFinal(main, level, ctx = {}) {
  const L = levelFor('somm', level); if (!L) return;
  const hero = find(main, byName('Hero')); const copy = hero && find(hero, byName('Copy')); const btns = hero && find(hero, byName('Buttons'));
  if (!btns) return;
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Detroit' }).toUpperCase();
  const certified = ctx.passedAt && (!L.practical || ctx.practical);
  const cont = btns.c.find((x) => (x.n || '').startsWith('Button · Continue'));
  const details = btns.c.find((x) => (x.n || '').startsWith('Button · Exam Details'));
  if (cont && certified) { cont.n = 'Button · View Certificate'; cont.to = `/certificate/${L.file}`; setText(texts(cont)[0], 'View Certificate'); }
  const exam = details && clone(details);
  if (exam) { exam.n = 'Button · Final Exam'; exam.to = '/quizzes?quiz=' + encodeURIComponent('t:' + L.final); setText(texts(exam)[0], ctx.passedAt ? 'Retake Final Exam' : 'Final Exam'); }
  btns.c = [cont, exam].filter(Boolean);
  if (details && copy) {
    const link = { ...txt('Court exam details  →', { z: 13.5, c: '#C49A6C', fs: 'SemiBold' }), n: 'Link · Exam Details', to: details.to };
    copy.c.splice(copy.c.indexOf(btns) + 1, 0, link);
  }
  if (copy) {
    let line = null;
    if (certified) line = txt(`✓ ${L.title.toUpperCase()} · ${day(ctx.practical?.at > ctx.passedAt ? ctx.practical.at : ctx.passedAt)}`, { ls: '10%', c: '#7FCB93', z: 12.5 });
    else if (ctx.passedAt) line = txt('✓ FINAL PASSED · PRACTICAL: ASK A MANAGER WHEN READY', { ls: '10%', c: '#7FCB93', z: 12.5 });
    else if (ctx.practical) line = txt(`✓ PRACTICAL SIGNED OFF${ctx.practical.by ? ' BY ' + ctx.practical.by.toUpperCase() : ''}`, { ls: '10%', c: '#7FCB93', z: 12.5 });
    if (line) { line.n = 'Status line'; line.ar = 'H'; line.sh = 'F'; line.w = 398; copy.c.splice(copy.c.findIndex((x) => x.n === 'Course progress') + 1, 0, line); }
  }
  evenButtons(main);
}
