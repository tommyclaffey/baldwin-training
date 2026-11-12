// The Hospitality Program (Nov 11): BRG's version for BRG's companies, a generic one for everyone else, finals,
// certificates and job paths. And the Training Acknowledgment, which was Hospitality 101's practical until Nov 12 and is now
// a Day 1 step on every job's path (Tommy: "should be a part of their path, not a part of the hospitality part").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { totpAt } from '../server/auth.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-hosp-'));
const PORT = 5400 + Math.floor(Math.random() * 300);
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
const readDir = (d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8')));

before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@baldwin.test', SUPERADMIN_EMAIL: 'super@mise.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = person(), sup = person(), owner2 = person(), staff2 = person();
const BRG_WORDS = /Baldwin|\bBRG\b|Pellegrino|Fiji/;

test('the two versions have the same lessons, sections, cards and checks; the generic one names no BRG', () => {
  const brg = readDir('content/hospitality').sort((a, b) => a.slug.localeCompare(b.slug));
  const gen = readDir('content/hospitality-generic').sort((a, b) => a.slug.localeCompare(b.slug));
  assert.equal(brg.length, 11, 'five Hospitality 101 lessons and six Art of Table Service lessons');
  assert.deepEqual(gen.map((c) => c.slug), brg.map((c) => c.slug));
  brg.forEach((b, i) => {
    const g = gen[i];
    assert.equal(g.title, b.title); assert.equal(g.programLevel, b.programLevel); assert.equal(g.number, b.number);
    assert.deepEqual(g.sections.map((s) => s.name), b.sections.map((s) => s.name), b.slug);
    assert.equal(g.cards.length, b.cards.length, b.slug + ' cards');
    assert.deepEqual(g.v3.sections.map((s) => s.check), b.v3.sections.map((s) => s.check), b.slug + ' checks');
    for (const s of b.v3.sections) { assert.equal(s.check.length, 3); assert.ok(s.keyPoints.length >= 3 && s.keyPoints.length <= 5, b.slug + ' key points'); }
    for (const c of b.cards) assert.ok(c.wrong.length >= 3 && !c.wrong.includes(c.answer), c.q);
  });
  for (const f of fs.readdirSync(path.join(root, 'content/hospitality-generic'))) assert.ok(!BRG_WORDS.test(fs.readFileSync(path.join(root, 'content/hospitality-generic', f), 'utf8')), f + ' names nothing of BRG’s');
  assert.ok(fs.readFileSync(path.join(root, 'content/hospitality/hosp-water-selling.json'), 'utf8').includes('San Pellegrino'), 'BRG’s own water list stays in its version');
});

test('BRG reads its own version: hub, levels, lessons, finals', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Owner', email: 'owner@baldwin.test', password: 'long-enough-1' } })).status, 200);
  const index = (await owner('/api/index')).data;
  const file = (slug) => index.find((e) => e.slug === slug)?.file;
  const page = async (slug) => JSON.stringify((await owner('/api/page/' + file(slug))).data);
  const hub = await page('hospitality-program');
  assert.ok(hub.includes('HOSPITALITY') && hub.includes('Hospitality 101') && hub.includes('The Art of Table Service') && hub.includes('t%3Afinal%3Ahosp-2'), 'the hub: two levels and their finals');
  assert.ok(!/Court of Master|Cicerone|Four levels/.test(hub), 'nothing left over from the other hubs');
  const l1 = await page('hospitality-program/level-1');
  assert.ok(l1.includes('HOSPITALITY 101') && l1.includes('t%3Afinal%3Ahosp-1'), 'Level 1 with its final');
  assert.ok(!l1.includes('"ack"') && !/Acknowledgment|ACKNOWLEDG/.test(l1), 'no acknowledgment on Level 1 any more');
  assert.ok(!/practical/i.test(l1) && l1.includes('then a final.') && l1.includes('to pass'), 'lessons and a final, no practical: the stats say 80% to pass');
  assert.ok(l1.includes('Pass the 30-question final') && !l1.includes('Sign the acknowledgment'), 'how it works ends with the final');
  const ack = (await owner('/api/path/ack')).data;
  assert.equal(ack.title, 'Employee Training Acknowledgment');
  assert.ok(ack.statement.includes('Baldwin Restaurant Group Hospitality 101 Training Module') && ack.statement.includes('condition of my employment'), 'BRG’s own wording');
  const l2 = await page('hospitality-program/level-2');
  assert.ok(l2.includes('THE ART OF TABLE SERVICE') && l2.includes('t%3Afinal%3Ahosp-2') && l2.includes('practical'));
  const water = await page('hospitality-program/level-2/hosp-water-selling');
  assert.ok(water.includes('San Pellegrino') && water.includes('Fiji'), 'BRG’s water list');
  const greet = await page('hospitality-program/level-2/hosp-greeting/what-to-say');
  assert.ok(greet.includes('welcome to The Baldwin'), 'the greeting uses the store’s name');
  const cat = (await owner('/api/quiz/catalog')).data;
  assert.equal(cat.quizzes.find((q) => q.id === 't:final:hosp-1').count, 30);
  assert.equal(cat.quizzes.find((q) => q.id === 't:final:hosp-2').count, 40);
  assert.equal(cat.quizzes.filter((q) => q.group === 'Hospitality Program · Level 1').length, 6, 'five lesson quizzes and the final');
  assert.equal(cat.quizzes.filter((q) => q.group === 'Hospitality Program · Level 2').length, 7, 'six lesson quizzes and the final');
  assert.equal((await owner('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:hosp-1' } })).data.items.length, 30);
});

test('another company reads the generic version, with the same structure and no BRG names', async () => {
  assert.equal((await sup('/api/setup', { method: 'POST', body: { name: 'Super', email: 'super@mise.test', password: 'long-enough-1' } })).status, 200);
  const secret = (await sup('/api/2fa/start', { method: 'POST' })).data.secret;
  assert.equal((await sup('/api/2fa/enable', { method: 'POST', body: { code: code(secret) } })).status, 200);
  const add = await sup('/api/super/companies', { method: 'POST', body: { name: 'Cobalt Kitchen Group', stores: ['Cobalt Kitchen'], ownerEmail: 'owner@cobalt.test' } });
  assert.equal(add.status, 200);
  assert.equal((await owner2(`/api/invite/${add.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Delphine Moss', password: 'long-enough-2' } })).status, 200);
  const index = (await owner2('/api/index')).data;
  const hosp = index.filter((e) => e.slug.startsWith('hospitality-program'));
  assert.equal(hosp.length, 3 + 29, 'hub, two levels and every lesson section');
  assert.ok(!BRG_WORDS.test(JSON.stringify(hosp)), 'nothing of BRG’s in their search');
  for (const e of hosp) {
    const r = await owner2('/api/page/' + e.file);
    assert.equal(r.status, 200, e.slug);
    assert.ok(!BRG_WORDS.test(JSON.stringify(r.data)), e.slug + ' names nothing of BRG’s');
  }
  const page = async (slug) => JSON.stringify((await owner2('/api/page/' + index.find((e) => e.slug === slug).file)).data);
  const ack = (await owner2('/api/path/ack')).data;
  assert.ok(ack.statement.includes('Cobalt Kitchen Hospitality 101 training') && !ack.statement.includes('condition of my employment'), 'their own, softened acknowledgment');
  assert.ok(!BRG_WORDS.test(JSON.stringify(ack)));
  assert.ok((await page('hospitality-program/level-2/hosp-greeting/what-to-say')).includes('welcome to Cobalt Kitchen'), 'their own name in the greeting');
  assert.ok((await page('hospitality-program/level-2/hosp-water-selling')).includes('Bottled waters'), 'water, generalised');
  const qs = (await owner2('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:hosp-2' } })).data;
  assert.equal(qs.items.length, 40);
  assert.ok(!BRG_WORDS.test(JSON.stringify(qs)), 'their final names nothing of BRG’s');
});

test('the Training Acknowledgment is a Day 1 step on every job: the person signs, then their trainer signs off', async () => {
  const join = (await owner2('/api/team')).data.company.joinCode;
  assert.equal((await staff2('/api/join', { method: 'POST', body: { code: join, name: 'Perrin Okafor', pin: '4826' } })).status, 200);
  const perrin = (await owner2('/api/team')).data.people.find((p) => p.name === 'Perrin Okafor');
  // on Day 1 (the first stage, due the day they start) of every job's path
  assert.equal((await staff2('/api/path/jobs', { method: 'POST', body: { jobs: ['server'] } })).status, 200, 'they pick their job');
  for (const job of ['server', 'bartender', 'host', 'support']) {
    const p = (await owner2(`/api/path/person/${perrin.id}`, { method: 'PATCH', body: { jobs: [job] } })).data.paths[0];
    const first = p.stages[0];
    assert.equal(first.key, 'first', job); assert.equal(first.title, 'Before your first shift');
    const step = first.steps.find((s) => s.id === 'path:ack');
    assert.ok(step, job + ' has the acknowledgment on Day 1');
    assert.equal(step.title, 'Training Acknowledgment'); assert.equal(step.kind, 'signoff'); assert.equal(step.to, '/my-path/acknowledgment');
    assert.deepEqual(step.ack, { signed: null }); assert.equal(step.done, false);
    assert.equal(p.stages.slice(1).flatMap((st) => st.steps).filter((s) => s.id === 'path:ack').length, 0, 'only once');
  }
  // two jobs: the same one step, signed once
  const two = (await owner2(`/api/path/person/${perrin.id}`, { method: 'PATCH', body: { jobs: ['server', 'host'] } })).data;
  assert.equal(two.paths.length, 2);
  assert.ok(two.paths.every((p) => p.stages[0].steps.some((s) => s.id === 'path:ack')));
  await owner2(`/api/path/person/${perrin.id}`, { method: 'PATCH', body: { jobs: ['server'] } });
  const path1 = (await staff2('/api/path')).data;
  assert.equal(path1.paths[0].next.id, 'page:our-story', 'reading comes first');
  // Hospitality 101 is still in week 1, The Art of Table Service later
  const ids = (k) => path1.paths[0].stages.find((s) => s.key === k).steps.map((s) => s.id);
  assert.equal(ids('week-1').filter((x) => x.startsWith('lesson:hosp-')).length, 14, 'all of Hospitality 101 in week 1');
  assert.ok(ids('weeks-3-4').includes('lesson:hosp-greeting#2') && ids('weeks-3-4').includes('lesson:hosp-farewell#1'));
  // a lesson done once counts in the path and the program
  assert.equal((await staff2('/api/study/done', { method: 'POST', body: { key: 'hosp-welcome#0' } })).status, 200);
  const after = (await staff2('/api/path')).data;
  assert.ok(after.paths[0].stages.flatMap((st) => st.steps).find((s) => s.id === 'lesson:hosp-welcome#0').done);
  assert.equal(after.programs.find((g) => g.certKey === 'hosp-1').done, 1);
  assert.ok(!after.programs.find((g) => g.certKey === 'hosp-1').practical, 'Hospitality 101 has no practical');
  // the trainer can't sign off before the person has signed
  const key = 'path:ack';
  assert.equal((await owner2('/api/path/signoff', { method: 'POST', body: { userId: perrin.id, key } })).status, 400);
  assert.equal((await owner2('/api/path/signoff', { method: 'POST', body: { userId: perrin.id, key: 'program:hosp-1:practical' } })).status, 400, 'the old Hospitality 101 key is gone');
  assert.equal((await staff2('/api/path/ack', { method: 'POST', body: { name: 'Perrin Okafor', agree: false } })).status, 400, 'needs the box ticked');
  assert.equal((await staff2('/api/path/ack', { method: 'POST', body: { name: 'P', agree: true } })).status, 400, 'needs a name');
  assert.equal((await staff2('/api/path/ack', { method: 'POST', body: { level: 'hosp-2', name: 'Perrin Okafor', agree: true } })).status, 400, 'no other acknowledgment');
  const signed = await staff2('/api/path/ack', { method: 'POST', body: { level: 'training', name: 'Perrin Okafor', agree: true } });
  assert.equal(signed.status, 200); assert.equal(signed.data.ack.name, 'Perrin Okafor');
  const mine = (await staff2('/api/path/ack')).data;
  assert.equal(mine.signed.name, 'Perrin Okafor'); assert.equal(mine.trainer, null);
  const waiting = (await staff2('/api/path')).data.paths[0].stages[0].steps.find((s) => s.id === key);
  assert.equal(waiting.ack.signed.name, 'Perrin Okafor'); assert.equal(waiting.done, false); assert.ok(waiting.ask && !waiting.ask.declinedAt, 'signing asks the trainer');
  // the manager sees it on Sign-offs and People
  const home = (await owner2('/api/manager/home')).data;
  assert.ok(home.signoffs.some((a) => a.userId === perrin.id && a.key === key && a.title === 'Training Acknowledgment'), 'waiting on the manager');
  assert.equal((await owner2('/api/path/signoff', { method: 'POST', body: { userId: perrin.id, key } })).status, 200, 'now the trainer signs off');
  const view = (await owner2(`/api/path/person/${perrin.id}`)).data.paths[0].stages[0].steps.find((s) => s.id === key);
  assert.ok(view.done && view.by === 'Delphine Moss' && view.ack.signed.name === 'Perrin Okafor');
  assert.ok(!(await owner2('/api/manager/home')).data.signoffs.some((a) => a.userId === perrin.id && a.key === key), 'asked and answered');
  assert.equal((await staff2('/api/path/ack')).data.trainer.by, 'Delphine Moss');
  // signing again keeps the first signature
  assert.equal((await staff2('/api/path/ack', { method: 'POST', body: { name: 'Someone Else', agree: true } })).data.ack.name, 'Perrin Okafor');
});

test('Hospitality 101 certifies on the final alone', async () => {
  const q = (await staff2('/api/quiz/start', { method: 'POST', body: { quiz: 't:final:hosp-1' } })).data;
  const r = await staff2('/api/quiz/attempt', { method: 'POST', body: { quiz: q.id, items: q.items, answers: q.items.map((x) => q.questions[x].answer) } });
  assert.equal(r.data.passed, true);
  const cert = (await staff2('/api/certificates')).data.certificates.find((c) => c.key === 'hosp-1');
  assert.ok(cert, 'Hospitality 101 certificate');
  assert.equal(cert.title, 'Hospitality 101'); assert.equal(cert.practical, null); assert.equal(cert.store, 'Cobalt Kitchen');
  assert.ok(/^HOSP1-\d{4}$/.test(cert.number));
  assert.ok(!BRG_WORDS.test(JSON.stringify(cert)));
  assert.ok((await staff2('/api/path')).data.programs.find((g) => g.certKey === 'hosp-1').certified);
});

test('old acknowledgments carry over to the path step: signatures, sign-offs and asks; certificates stay earned', async () => {
  const { openDb } = await import('../server/db.mjs');
  const { migrateAcks, ACK_KEY, ACK_LEVEL } = await import('../server/acks.mjs');
  const { personPath } = await import('../server/paths.mjs');
  const { certificatesFor } = await import('../server/certs.mjs');
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bt-ack-')), 'old.db'));
  const t = '2026-11-11T20:00:00.000Z';
  db.prepare("INSERT INTO companies(id, name, slug, created_at) VALUES (7, 'Old Co', 'old-co', ?)").run(t);
  const add = (name) => Number(db.prepare("INSERT INTO users(company_id, name, role, store_id, created_at, jobs, started_on) VALUES (7, ?, 'staff', 3, ?, '[\"server\"]', '2026-11-01')").run(name, t).lastInsertRowid);
  const [ada, ben, cy] = [add('Ada Old'), add('Ben Old'), add('Cy Old')];
  // the Nov 11 way: Hospitality 101's practical. Ada signed and was signed off (and passed the final); Ben signed and asked; Cy never signed.
  const oldAck = db.prepare('INSERT INTO program_acks(user_id, store_id, company_id, level, name, at) VALUES (?,3,7,?,?,?)');
  oldAck.run(ada, 'hosp-1', 'Ada Old', t); oldAck.run(ben, 'hosp-1', 'Ben Old', t);
  db.prepare("INSERT INTO signoffs(device, quiz, by_user, at, company_id, store_id) VALUES (?, 'program:hosp-1:practical', NULL, ?, 7, 3)").run('u' + ada, t);
  db.prepare("INSERT INTO signoff_requests(user_id, store_id, company_id, key, at) VALUES (?, 3, 7, 'program:hosp-1:practical', ?)").run(ben, t);
  db.prepare("INSERT INTO quiz_attempts(device, name, quiz, score, total, answers, at, company_id, user_id, store_id) VALUES (?, 'Ada Old', 't:final:hosp-1', 29, 30, '{}', ?, 7, ?, 3)").run('u' + ada, '2026-11-11T19:00:00.000Z', ada);
  migrateAcks(db); migrateAcks(db); // twice: safe to run on every start
  assert.equal(db.prepare('SELECT COUNT(*) n FROM program_acks WHERE level = ?').get(ACK_LEVEL).n, 2, 'both signatures carried over');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM program_acks WHERE level = 'hosp-1'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signoffs WHERE quiz = ?').get(ACK_KEY).n, 1, 'the trainer’s sign-off carried over');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signoff_requests WHERE key = ?').get(ACK_KEY).n, 1, 'the open ask carried over');
  const ctx = { quizzes: [], slugs: new Set(), titles: new Map() };
  const step = (id) => personPath(db, 3, db.prepare('SELECT * FROM users WHERE id = ?').get(id), ctx).paths[0].stages[0].steps.find((s) => s.id === ACK_KEY);
  assert.ok(step(ada).done && step(ada).ack.signed.name === 'Ada Old', 'Ada: done on her path');
  assert.ok(!step(ben).done && step(ben).ack.signed.name === 'Ben Old' && step(ben).ask, 'Ben: signed, waiting on his trainer');
  assert.ok(!step(cy).done && !step(cy).ack.signed, 'Cy: still to sign');
  const certs = certificatesFor(db, db.prepare('SELECT * FROM users WHERE id = ?').get(ada), 3, null);
  assert.ok(certs.some((c) => c.key === 'hosp-1'), 'Ada’s Hospitality 101 certificate stays earned');
});

test('The Baldwin’s demo reads BRG’s version', async () => {
  const demo = person();
  assert.equal((await demo('/api/demo/start', { method: 'POST', body: { role: 'employee' } })).status, 200);
  const idx = (await demo('/api/index')).data;
  const l1 = JSON.stringify((await demo('/api/page/' + idx.find((e) => e.slug === 'hospitality-program/level-1').file)).data);
  assert.ok(l1.includes('HOSPITALITY 101') && !l1.includes('"ack"'));
  assert.ok((await demo('/api/path/ack')).data.statement.includes('Baldwin Restaurant Group Hospitality 101 Training Module'), 'BRG’s acknowledgment, on the path');
});
