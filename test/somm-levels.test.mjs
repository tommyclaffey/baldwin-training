// The Sommelier Program's Levels 3 and 4 (Nov 19, Tommy: "can we start working on level three and possibly level 4 of the wine
// program"). Level 3 · Advanced Prep follows the Court of Master Sommeliers' Advanced Sommelier outline (content/manual-l3);
// Level 4 · Master Prep (content/manual-l4) is by invitation, like Master of the Bar and Master of Beer. Both are a shared
// library: every company reads them, and nothing in them is The Baldwin's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/auth.mjs';
import { giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-somm34-'));
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

function person() {
  let jar = '';
  return async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-BT': '1', ...(jar ? { Cookie: jar } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const code = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));
const readDir = (d) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8'))) : []);
/** The Baldwin group's own names, people and places (the same sweep as the other shared-library tests). */
const THEIRS = /Baldwin|\bBRG\b|Testa Barra|Jeffrey(?! Ong)|Macomb|Shelby Twp|Fig & Fire/;

before(async () => {
  giveAccount(dir);
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'super@mise.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), sup = person(), owner2 = person();

/** Every video in the app's lessons and pages, by YouTube id → the lesson files that use it. */
function videoUses() {
  const uses = new Map();
  for (const d of ['content/bar', 'content/beer', 'content/manual', 'content/manual-l2', 'content/manual-l3', 'content/manual-l4', 'content/hospitality-generic']) {
    if (!fs.existsSync(path.join(root, d))) continue;
    for (const f of fs.readdirSync(path.join(root, d)).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
      const c = JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8'));
      for (const s of [c.v3?.video, ...(c.v3?.sections || []).map((x) => x.video)]) if (s?.youtubeId) uses.set(s.youtubeId, [...(uses.get(s.youtubeId) || []), `${d}/${f}`]);
    }
  }
  return uses;
}
const NONSENSE = /\b(all|none) of the above\b|\bboth\b.*\band\b.*\bcorrect\b|\blol\b|\bn\/a\b|\?\?/i;

/** The lesson files of one level: the format, the sources, the cards, the photos and videos. */
function checkLessons(folder, level, { minVideos }) {
  const lessons = readDir(folder).sort((a, b) => a.number - b.number);
  assert.ok(lessons.length >= 5, `${folder}: lessons`);
  assert.deepEqual(lessons.map((c) => c.number), lessons.map((_, i) => i + 1), 'numbered in order');
  const photos = JSON.parse(fs.readFileSync(path.join(root, 'content/research/study-photos.json'), 'utf8')).photos;
  const uses = videoUses();
  const other = ['content/cms/classic.json', 'content/wine-videos.json'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  let vids = 0, sections = 0;
  for (const c of lessons) {
    const raw = JSON.stringify(c);
    assert.ok(!THEIRS.test(raw), `${c.slug}: nothing of The Baldwin’s (shared library)`);
    assert.equal(c.program, 'somm'); assert.equal(c.programLevel, level);
    assert.ok(c.court?.outcome && /^https:\/\/www\.mastersommeliers\.org\//.test(c.court.outcomeSource) && c.court.coverage.length >= 3, `${c.slug}: the Court’s outcome, quoted, with its source`);
    assert.ok(Array.isArray(c.unverified) && c.sources && /Checked/.test(c.sources), `${c.slug}: sources and what still needs checking`);
    assert.ok(c.facts.length >= c.sections.length && c.facts.every((f) => f.fact && /^https?:\/\//.test(f.source)), `${c.slug}: every fact has a URL`);
    assert.deepEqual(c.v3.sections.map((s) => s.name), c.sections.map((s) => s.name), `${c.slug}: v3 sections match`);
    for (const s of c.sections) {
      sections++;
      assert.ok(s.source && s.source.length > 10, `${c.slug} · ${s.name}: names its source`);
      assert.ok(!s.book, `${c.slug} · ${s.name}: no back bar button`);
      const v = c.v3.sections.find((x) => x.name === s.name);
      assert.equal(v.check.length, 3); assert.ok(v.check.every((i) => c.cards[i]), `${c.slug} · ${s.name}: three check cards`);
      assert.ok(v.keyPoints.length >= 3 && v.keyPoints.length <= 5 && v.read.bigIdea && v.read.where && v.read.stops.length >= 2 && v.read.mixup, `${c.slug} · ${s.name}: the full reading flow`);
      for (const k of v.keyPoints) assert.ok(k.line.length <= 80, `${c.slug} · ${s.name}: a short key point (${k.big})`);
      if (v.video) {
        vids++;
        assert.ok(v.video.youtubeId && v.video.title && v.video.by && v.video.length, `${c.slug} · ${s.name}: title, channel and length`);
        assert.deepEqual(uses.get(v.video.youtubeId), [`${folder}/${c.slug}.json`], `${c.slug} · ${s.name}: its video is in no other lesson`);
        assert.ok(!other.includes(v.video.youtubeId), `${c.slug} · ${s.name}: not on a classic or wine page`);
      } else assert.ok(photos.some((p) => p.chapter === c.slug && p.section === s.name), `${c.slug} · ${s.name}: a photo when there’s no video`);
    }
    // cards: a right answer, three different wrong ones of the same kind, a source
    for (const k of c.cards) {
      assert.ok(k.q && k.answer && k.wrong.length === 3 && new Set(k.wrong.map((w) => w.toLowerCase())).size === 3 && !k.wrong.some((w) => w.toLowerCase() === k.answer.toLowerCase()) && /^https?:\/\//.test(k.source), `${c.slug}: a full card (${k.q})`);
      assert.ok(![k.answer, ...k.wrong].some((x) => NONSENSE.test(x) || !String(x).trim()), `${c.slug}: no nonsense options (${k.q})`);
      if (/^\d/.test(k.answer)) assert.ok(k.wrong.every((w) => /\d/.test(w)), `${c.slug}: a number’s wrong answers are numbers too (${k.q})`);
    }
  }
  assert.ok(vids >= minVideos, `${folder}: at least ${minVideos} sections have a video (${vids} of ${sections})`);
  assert.ok(lessons.reduce((k, c) => k + c.cards.length, 0) >= 60, 'enough cards for a 60-question final');
  return lessons;
}

test('Sommelier Level 3 · Advanced Prep: the lessons, on the Court’s Advanced outline', () => {
  const lessons = checkLessons('content/manual-l3', 3, { minVideos: 12 });
  assert.ok(lessons.some((c) => /Pearson VUE/.test(JSON.stringify(c)) && /60%/.test(JSON.stringify(c))), 'how the Advanced exam works, as the Court states it');
  assert.ok(lessons.some((c) => c.slug === 'advanced-deductive-tasting') && lessons.some((c) => c.slug === 'advanced-service') && lessons.some((c) => c.slug === 'advanced-business'), 'tasting, service and the business side');
});

test('Sommelier Level 3: level page, lessons, hub, final, practical and certificate', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  const lessons = readDir('content/manual-l3').sort((a, b) => a.number - b.number);
  const index = (await owner('/api/index')).data;
  const file = (slug) => index.find((e) => e.slug === slug)?.file;
  const l3 = index.find((e) => e.slug === 'sommelier-program/level-3');
  assert.ok(l3 && l3.section === 'Sommelier Program' && l3.title === 'Level 3', 'Level 3 is in the book, with the Sommelier Program');
  for (const c of lessons) for (const [i] of c.sections.entries()) assert.ok(index.some((e) => e.file === `l-${c.slug}~${i}`), `${c.slug} lesson ${i} is in the book`);
  assert.equal(index.filter((e) => e.slug === 'sommelier-program').length, 1, 'one Sommelier hub');
  // the level page: the Level 2 layout, level tabs, the final, the practical and the Court's page
  const lp = JSON.stringify((await owner('/api/page/' + l3.file)).data);
  assert.ok(lp.includes('ADVANCED PREP') && lp.includes('t%3Afinal%3Asomm-3') && lp.includes('Mock Advanced service') && lp.includes('advanced-sommelier-course-and-examination'), 'Advanced Prep, its final, practical and the Court’s page');
  assert.ok(lp.includes('"Level tabs"') && lp.includes('Level 1 · Introductory') && lp.includes('"/sommelier-program/level-2"') && lp.includes('Level 4 · Master'), 'level tabs');
  assert.ok(lp.includes('/sommelier-program/level-3/' + lessons[0].slug), 'the lessons open');
  // a lesson: the Court's outcome at the Advanced level, three cards, next lesson
  const first = JSON.stringify((await owner('/api/page/' + file('sommelier-program/level-3/' + lessons[0].slug))).data);
  assert.ok(first.includes('Advanced level') && first.includes('WHAT THE COURT EXPECTS') && first.includes('"Level 3"'), 'a lesson with the Court’s outcome');
  const last = lessons[lessons.length - 1];
  const end = JSON.stringify((await owner('/api/page/l-' + last.slug + '~' + (last.sections.length - 1))).data);
  assert.ok(end.includes('Take the Final Exam') && end.includes('t%3Afinal%3Asomm-3'), 'the last lesson leads to the final');
  // Levels 1 and 2 get the tabs too
  for (const s of ['sommelier-program/level-1', 'sommelier-program/level-2']) assert.ok(JSON.stringify((await owner('/api/page/' + file(s))).data).includes('Level 3 · Advanced'), s + ': level tabs');
  // the hub: the Level 3 card opens its page, and the finals band
  const hub = JSON.stringify((await owner('/api/page/' + file('sommelier-program'))).data);
  assert.ok(hub.includes('"/sommelier-program/level-3"') && hub.includes(`${lessons.length} lessons`), 'the hub’s Level 3 card');
  assert.ok(hub.includes('"The finals"') && hub.includes('t%3Afinal%3Asomm-3') && hub.includes('t%3Afinal%3Asomm-1'), 'the finals band');
  // the final: 60 questions from the Level 3 cards, four different options each
  const cat = (await owner('/api/quiz/catalog')).data;
  const f3 = cat.quizzes.find((q) => q.id === 't:final:somm-3');
  assert.equal(f3.count, 60); assert.equal(f3.group, 'Sommelier Level 3');
  assert.equal(cat.quizzes.filter((q) => q.group === 'Sommelier Level 3').length, lessons.length + 1, 'every lesson’s quiz and the final');
  // a member of staff takes the final, then a manager signs the practical: the certificate
  const team = (await owner('/api/team')).data;
  const ana = person();
  assert.equal((await ana('/api/join', { method: 'POST', body: { code: team.company.joinCode, name: 'Odile Varga', email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-8642-x', storeId: 1 } })).status, 200);
  const q = (await ana('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:somm-3' } })).data;
  assert.equal(q.items.length, 60);
  const cards = new Map(lessons.flatMap((c) => c.cards.map((k, i) => [`study:${c.slug}:${i}`, k])));
  for (const ref of q.items) {
    const x = q.questions[ref];
    assert.equal(new Set(x.options).size, 4, 'four different options: ' + x.q);
    assert.ok(x.options[x.answer], 'a right answer');
    const k = cards.get(ref); if (k) assert.equal(x.options[x.answer], k.answer);
  }
  assert.ok(q.items.every((ref) => cards.has(ref)), 'every question is a Level 3 card');
  const r = (await ana('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: q.items.map((ref) => q.questions[ref].answer) } })).data;
  assert.equal(r.score, 60);
  assert.ok(!(await ana('/api/certificates')).data.certificates.some((c) => c.key === 'somm-3'), 'no certificate before the practical');
  const id = (await owner('/api/path/team')).data.people.find((x) => x.name === 'Odile Varga').id;
  const signed = (await owner('/api/path/signoff', { method: 'POST', body: { userId: id, key: 'program:somm-3:practical' } })).data;
  assert.ok(signed.programs.find((g) => g.cert === 'Advanced Prep').practical.at, 'the practical, signed on People');
  const cert = (await ana('/api/certificates')).data.certificates.find((c) => c.key === 'somm-3');
  assert.ok(cert && cert.title === 'Advanced Prep' && cert.number.startsWith('SOMM3-') && cert.practical && cert.isA === false, 'Advanced Prep, earned');
  assert.ok(/isn’t a Court of Master Sommeliers certification/.test(cert.fine), 'the fine print: not the Court’s');
  const hub2 = JSON.stringify((await ana('/api/page/' + file('sommelier-program'))).data);
  assert.ok(hub2.includes('/certificate/somm-3'), 'the finals band shows the certificate');
});

test('Sommelier Levels 3 and 4 are shared: another company reads them, with nothing of The Baldwin’s', async () => {
  assert.equal((await sup('/api/setup', { method: 'POST', body: { name: 'Super', email: 'super@mise.test', password: 'long-enough-1' } })).status, 200);
  const secret = (await sup('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await sup('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
  const add = await sup('/api/super/companies', { method: 'POST', body: { name: 'Larkspur Table Group', stores: ['Larkspur Table'], ownerEmail: 'owner@larkspur.test' } });
  assert.equal(add.status, 200);
  assert.equal((await owner2(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Teodora Lisle', password: 'long-enough-2' } })).status, 200);
  const index = (await owner2('/api/index')).data;
  const somm = index.filter((e) => /^sommelier-program\/level-[34]/.test(e.slug));
  assert.ok(somm.length > 20, 'the level and its lessons');
  for (const e of [index.find((x) => x.slug === 'sommelier-program'), ...somm]) {
    const r = await owner2('/api/page/' + e.file);
    assert.equal(r.status, 200, e.slug);
    assert.ok(!THEIRS.test(JSON.stringify(r.data)), e.slug + ' names nothing of The Baldwin’s');
  }
  assert.equal((await owner2('/api/quiz/catalog')).data.quizzes.find((q) => q.id === 't:final:somm-3').count, 60);
});

test('Sommelier Level 4 · Master Prep: the lessons, on the Court’s Master Sommelier Diploma', () => {
  const lessons = checkLessons('content/manual-l4', 4, { minVideos: 12 });
  assert.equal(lessons.length, 6, 'six lessons');
  const all = JSON.stringify(lessons);
  assert.ok(/75%/.test(all) && /60%/.test(all), 'the Master pass mark against the Advanced one, as the Court states them');
  assert.ok(lessons.some((c) => c.slug === 'master-wine-list') && lessons.some((c) => c.slug === 'master-leading'), 'leading a wine program');
});

test('Sommelier Level 4: by invitation; final, practical and certificate once invited', async () => {
  const lessons = readDir('content/manual-l4').sort((a, b) => a.number - b.number);
  const index = (await owner('/api/index')).data;
  const file = (slug) => index.find((e) => e.slug === slug)?.file;
  const l4 = index.find((e) => e.slug === 'sommelier-program/level-4');
  assert.ok(l4 && l4.title === 'Level 4', 'Level 4 is in the book');
  for (const c of lessons) for (const [i] of c.sections.entries()) assert.ok(index.some((e) => e.file === `l-${c.slug}~${i}`), `${c.slug} lesson ${i} is in the book`);
  // the owner can open it, and is told how invitations work
  const op = JSON.stringify((await owner('/api/page/' + l4.file)).data);
  assert.ok(op.includes('MASTER PREP') && op.includes('t%3Afinal%3Asomm-4') && op.includes('Present a wine list') && op.includes('INVITE YOUR TEAM ON PEOPLE') && op.includes('master-sommelier-diploma-examination'));
  assert.ok(!op.includes('· Coming') && !op.includes('· coming'), 'every Sommelier level is built');
  const hub = JSON.stringify((await owner('/api/page/' + file('sommelier-program'))).data);
  assert.ok(hub.includes('"/sommelier-program/level-4"') && hub.includes('"By invitation"') && hub.includes(`${lessons.length} lessons`) && hub.includes('t%3Afinal%3Asomm-4'), 'the hub: Level 4 card and its final');
  const cat = (await owner('/api/quiz/catalog')).data;
  assert.equal(cat.quizzes.find((q) => q.id === 't:final:somm-4').count, 60);
  assert.equal(cat.quizzes.filter((q) => q.group === 'Sommelier Level 4').length, lessons.length + 1, 'every lesson’s quiz and the final');
  // a member of staff sees the level but can't open it (the server says no, not just the page)
  const team = (await owner('/api/team')).data;
  const ivo = person();
  assert.equal((await ivo('/api/join', { method: 'POST', body: { code: team.company.joinCode, name: 'Bram Okafor', email: `j${Math.random().toString(36).slice(2, 10)}@join.test`, password: 'join-pass-9753-x', storeId: 1 } })).status, 200);
  const sp = JSON.stringify((await ivo('/api/page/' + l4.file)).data);
  assert.ok(sp.includes('BY INVITATION · ASK YOUR MANAGER') && !sp.includes('t%3Afinal%3Asomm-4') && !sp.includes('"/sommelier-program/level-4/master-'), 'locked: no final, lessons don’t open');
  const last = lessons[lessons.length - 1];
  const lockedLesson = JSON.stringify((await ivo(`/api/page/l-${last.slug}~1`)).data);
  assert.ok(lockedLesson.includes('ASK YOUR MANAGER') && !lockedLesson.includes('WHAT THE COURT EXPECTS'), 'a lesson address shows the level page instead');
  assert.equal((await ivo('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:somm-4' } })).status, 403);
  assert.equal((await ivo('/api/quiz/start', { method: 'POST', body: { quiz: 't:study:' + lessons[0].slug } })).status, 403);
  assert.ok(!(await ivo('/api/quiz/catalog')).data.quizzes.some((q) => q.id === 't:final:somm-4'), 'not in the staff quiz list');
  assert.ok(JSON.stringify((await ivo('/api/page/' + file('sommelier-program'))).data).includes('Button · By Invitation'), 'the hub’s finals band says by invitation');
  // the owner invites him on People; Remove takes it back; invite again
  const id = (await owner('/api/path/team')).data.people.find((x) => x.name === 'Bram Okafor').id;
  const inv = (await owner('/api/path/signoff', { method: 'POST', body: { userId: id, key: 'program:somm-4:invite' } })).data;
  assert.ok(inv.programs.find((g) => g.cert === 'Master Prep').invite.at, 'invited');
  await owner('/api/path/signoff', { method: 'DELETE', body: { userId: id, key: 'program:somm-4:invite' } });
  assert.equal((await ivo('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:somm-4' } })).status, 403, 'removed');
  await owner('/api/path/signoff', { method: 'POST', body: { userId: id, key: 'program:somm-4:invite' } });
  assert.ok(JSON.stringify((await ivo('/api/page/' + l4.file)).data).includes('✓ INVITED'));
  assert.ok(JSON.stringify((await ivo(`/api/page/l-${last.slug}~1`)).data).includes('WHAT THE COURT EXPECTS'), 'the lessons open');
  // the final (60 questions, all Level 4 cards), then the practical a manager signs off = the certificate
  const q = (await ivo('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:somm-4' } })).data;
  assert.equal(q.items.length, 60);
  const cards = new Map(lessons.flatMap((c) => c.cards.map((k, i) => [`study:${c.slug}:${i}`, k])));
  for (const ref of q.items) { const x = q.questions[ref]; assert.ok(cards.has(ref), 'a Level 4 card'); assert.equal(new Set(x.options).size, 4); assert.equal(x.options[x.answer], cards.get(ref).answer); }
  const r = (await ivo('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: q.items.map((ref) => q.questions[ref].answer) } })).data;
  assert.equal(r.score, 60);
  assert.ok(!(await ivo('/api/certificates')).data.certificates.some((c) => c.key === 'somm-4'), 'no certificate before the practical');
  await owner('/api/path/signoff', { method: 'POST', body: { userId: id, key: 'program:somm-4:practical' } });
  const cert = (await ivo('/api/certificates')).data.certificates.find((c) => c.key === 'somm-4');
  assert.ok(cert && cert.title === 'Master Prep' && cert.number.startsWith('SOMM4-') && cert.practical, 'Master Prep, earned');
  assert.ok(/Only the Court awards the Master Sommelier title/.test(cert.fine), 'its own fine print');
});
