// Paths for every position (Tommy, Nov 16: "make paths for each position and training material for each position"; plan
// approved Nov 25: "go with your choice"). Plan + decisions: vault › Apps/The Baldwin Training Book/(C) Mise — Paths for
// Every Position (Nov 22 2026).
// Checks the starting paths as written (every step points at something real), then one kitchen job through the API, like
// the Expo test in hospitality.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-paths-'));
process.env.DATA_DIR ||= dir; // the server modules imported below read it
const { JOBS, AREAS, PATH_DEFS, pathFor, isPathSignoff, leadCanSign } = await import('../server/paths.mjs');
const { canLog } = await import('../server/prep.mjs');
const { chapterBySlug } = await import('../server/manual.mjs');
const { CHANNELS } = await import('../server/chat.mjs');

const NEW = ['server-assistant', 'sommelier', 'barback', 'bar-lead', 'line-cook', 'prep', 'dish', 'sous-chef'];
const KITCHEN = ['line-cook', 'prep', 'dish', 'sous-chef'];
// Anything from the drink side: bar, beer and wine lessons, the Sommelier Study Guide, and the bar's quizzes.
const DRINK = /^(lesson:(bar-|beer-|on-the-floor|certified-|advanced-|master-)|t:(wine-|spec|classic|specialty|brg|mules|dessert|spiritless|house|beer|pairings|study:|final:(bar|beer|somm)))/;
const FOUNDATION = new Set(JSON.parse(fs.readFileSync(path.join(root, 'src/content/index.json'), 'utf8')).map((e) => e.slug));

test('every job has a starting path, and every new job is on the list once', () => {
  assert.deepEqual(JOBS.map((j) => j.key).filter((k) => !PATH_DEFS[k]), [], 'a job with no path');
  assert.equal(new Set(JOBS.map((j) => j.key)).size, JOBS.length, 'no job twice');
  for (const k of NEW) assert.ok(JOBS.some((j) => j.key === k && j.area), k + ' is a job with an area');
  // Nov 25: every job sits under one of the menu's three headings
  for (const j of JOBS) assert.ok(AREAS.some((a) => a.key === j.area), j.key + ' has a heading');
  assert.deepEqual(AREAS.map((a) => a.label), ['Front of House', 'Bar', 'Kitchen']);
  // starter paths (waiting on training material) are the kitchen's, and say so
  assert.deepEqual(JOBS.filter((j) => j.starter).map((j) => j.key).sort(), [...KITCHEN].sort());
});

test('every step points at something real: lesson sections exist, pages are in the foundation book', () => {
  for (const [job, stages] of Object.entries(PATH_DEFS)) {
    for (const st of stages) for (const s of st.steps) {
      if (s.kind === 'lesson') { const [slug, i] = s.key.split('#'); assert.ok(chapterBySlug(slug)?.sections[Number(i)], `${job}: ${s.key}`); }
      if (s.kind === 'lessons') assert.ok(chapterBySlug(s.slug)?.sections.length, `${job}: ${s.slug}`);
      if (s.kind === 'read' && NEW.includes(job)) assert.ok(FOUNDATION.has(s.slug), `${job}: page ${s.slug} isn't in the foundation book`);
    }
  }
});

test('Day 1 on every job: the acknowledgment, once; stages run first → week 1 → …, due days in order', () => {
  for (const [job, stages] of Object.entries(PATH_DEFS)) {
    assert.equal(stages[0].key, 'first', job); assert.equal(stages[0].day, 0, job);
    assert.equal(stages[0].steps.filter((s) => s.kind === 'ack').length, 1, job + ' acknowledgment on Day 1');
    assert.equal(stages.slice(1).flatMap((st) => st.steps).filter((s) => s.kind === 'ack').length, 0, job + ' only once');
    for (let i = 1; i < stages.length; i++) assert.ok(stages[i].day > stages[i - 1].day, job + ' due days in order');
  }
});

test('kitchen jobs and the server assistant: nothing from the drink side', () => {
  const quizzes = ['t:allergens', 't:pairings', 't:wine-glass', 't:spec:classic-off', 't:final:bar-3', 't:final:somm-1'].map((id) => ({ id, title: id, count: 5 }))
    .concat([{ id: 't:course:Plates', title: 'Plates', group: 'Food', count: 5 }, { id: 't:specialty', title: 'Specialty', group: 'Bar', count: 5 }]);
  const ctx = { quizzes, slugs: FOUNDATION, titles: new Map() };
  for (const job of [...KITCHEN, 'server-assistant', 'expo']) {
    const ids = pathFor(job, ctx).flatMap((st) => st.steps.map((s) => s.id));
    assert.deepEqual(ids.filter((id) => DRINK.test(id)), [], job + ' has drink steps');
    assert.ok(ids.includes('t:allergens'), job + ' takes the allergens quiz'); // Nov 25: the dishwasher too
  }
  // Nov 25: Hospitality 101, all five lessons, on every kitchen path (the same as the floor)
  for (const job of KITCHEN) {
    const ids = pathFor(job, ctx).flatMap((st) => st.steps.map((s) => s.id));
    for (const slug of ['hosp-welcome', 'hosp-experience-creator', 'hosp-soft-skills', 'hosp-guest-conflict', 'hosp-safety']) assert.ok(ids.includes(`lesson:${slug}#0`), `${job}: ${slug}`);
  }
  // the bar and wine jobs do get theirs
  const has = (job, id) => pathFor(job, ctx).some((st) => st.steps.some((s) => s.id === id));
  assert.ok(has('sommelier', 't:final:somm-1') && has('sommelier', 'lesson:on-the-floor#3'), 'sommelier: Level 1 practice exam and decanting');
  assert.ok(has('bar-lead', 't:final:bar-3') && has('bar-lead', 'lesson:beer-line-cleaning#0'), 'bar lead: Advanced Mixologist final and line cleaning');
  assert.ok(has('barback', 'lesson:beer-kegs-cooler#2'), 'barback: CO2 safety');
});

test('Nov 25: Bar Lead and Barback log prep; kitchen and floor jobs still read it', () => {
  const staff = (job) => ({ role: 'staff', jobs: JSON.stringify([job]) });
  for (const job of ['bartender', 'bar-lead', 'barback']) assert.ok(canLog(staff(job)), job);
  for (const job of ['server', 'prep', 'line-cook', 'sous-chef', 'sommelier']) assert.ok(!canLog(staff(job)), job);
  assert.ok(canLog({ role: 'manager', jobs: '[]' }));
});

test('Nov 25: a sous chef signs off a line cook’s steps, and nothing else', () => {
  const at = (id, jobs, extra = {}) => ({ id, role: 'staff', company_id: 1, store_id: 1, jobs: JSON.stringify(jobs), ...extra });
  const sous = at(1, ['sous-chef']), cook = at(2, ['line-cook']), server = at(3, ['server']), both = at(4, ['line-cook', 'sous-chef']);
  for (const k of PATH_DEFS['line-cook'].flatMap((st) => st.steps.filter((s) => s.kind === 'signoff').map((s) => `path:line-cook:${s.key}`))) assert.ok(leadCanSign(sous, cook, k), k);
  assert.ok(!leadCanSign(sous, cook, 'path:ack'), 'not the acknowledgment');
  assert.ok(!leadCanSign(sous, cook, 't:allergens'), 'not a quiz');
  assert.ok(!leadCanSign(sous, cook, 'program:bar-2:practical'), 'not a practical');
  assert.ok(!leadCanSign(sous, server, 'path:server:floor'), 'not another job’s steps');
  assert.ok(!leadCanSign(sous, server, 'path:line-cook:knife'), 'not someone who isn’t a line cook');
  assert.ok(!leadCanSign(sous, at(5, ['prep']), 'path:prep:knife'), 'not a prep cook');
  assert.ok(!leadCanSign(at(6, ['line-cook']), cook, 'path:line-cook:knife'), 'a line cook can’t');
  assert.ok(!leadCanSign(both, both, 'path:line-cook:knife'), 'never yourself');
  assert.ok(!leadCanSign(sous, at(7, ['line-cook'], { store_id: 2 }), 'path:line-cook:knife'), 'not another store');
  assert.ok(!leadCanSign(sous, at(8, ['line-cook'], { company_id: 2 }), 'path:line-cook:knife'), 'not another company');
  assert.ok(!leadCanSign(sous, at(9, ['line-cook'], { role: 'manager' }), 'path:line-cook:knife'), 'staff only');
  assert.ok(!leadCanSign({ ...sous, role: 'manager' }, cook, 'path:line-cook:knife'), 'managers go the manager’s way');
});

test('no Level 4 lessons in a path (they open by invitation only)', () => {
  const l4 = /^(bar-l4-|beer-l4-|master-)/;
  for (const [job, stages] of Object.entries(PATH_DEFS)) for (const st of stages) for (const s of st.steps)
    assert.ok(!l4.test(s.key || s.slug || ''), `${job}: ${s.key || s.slug}`);
});

test('every new job’s sign-offs can be signed, and each job lands in one floor chat room', () => {
  for (const job of NEW) {
    const keys = PATH_DEFS[job].flatMap((st) => st.steps.filter((s) => s.kind === 'signoff').map((s) => `path:${job}:${s.key}`));
    assert.ok(keys.length >= 2, job + ' has sign-offs');
    assert.equal(new Set(keys).size, keys.length, job + ' sign-off keys are unique');
    for (const k of keys) assert.ok(isPathSignoff({ jobs: JSON.stringify([job]) }, k), k);
    assert.ok(!isPathSignoff({ jobs: JSON.stringify(['server']) }, keys[0]), 'only for people in that job');
    const rooms = CHANNELS.filter((c) => c.jobs && c.jobs.includes(job) && c.key !== 'bar').map((c) => c.key);
    assert.deepEqual(rooms, [KITCHEN.includes(job) ? 'kitchen' : 'foh'], job);
  }
  assert.ok(CHANNELS.find((c) => c.key === 'bar').jobs.includes('barback'));
});

// ---- through the API, like the Expo test ----
const PORT = 10400 + Math.floor(Math.random() * 200); // own range (Nov 25)
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
before(async () => {
  giveAccount(dir); server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@paths.test' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a line cook’s path through the API: acknowledgment on Day 1, the kitchen pages, sign-offs, no drink steps', async () => {
  const owner = person(), staff = person();
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Owner', email: 'owner@paths.test', password: 'long-enough-1' } })).status, 200);
  const join = (await owner('/api/team')).data.company.joinCode;
  assert.equal((await staff('/api/join', { method: 'POST', body: { code: join, name: 'Ilse Varnum', pin: '5917', storeId: 1 } })).status, 200);
  const ilse = (await owner('/api/team')).data.people.find((p) => p.name === 'Ilse Varnum');
  // the job menu lists the new jobs
  assert.ok((await staff('/api/path')).data.allJobs.some((j) => j.key === 'line-cook' && j.label === 'Line Cook'));
  assert.equal((await staff('/api/path/jobs', { method: 'POST', body: { jobs: ['line-cook'] } })).status, 200);
  const p = (await staff('/api/path')).data.paths[0];
  assert.equal(p.label, 'Line Cook');
  const first = p.stages[0];
  assert.equal(first.title, 'Before your first shift');
  assert.ok(first.steps.some((s) => s.id === 'path:ack'), 'acknowledgment on Day 1');
  assert.ok(first.steps.some((s) => s.id === 'page:safety') && first.steps.some((s) => s.id === 'page:cleanliness'));
  const ids = p.stages.flatMap((st) => st.steps.map((s) => `${s.id} ${s.title}`)).join('\n');
  assert.ok(/Knife skills/.test(ids) && /allergy plate/.test(ids) && /Line sign-off/.test(ids), ids);
  assert.ok(!p.stages.flatMap((st) => st.steps).some((s) => DRINK.test(s.id)), 'no drink steps:\n' + ids);
  // the chef (a manager) signs a kitchen step off
  assert.equal((await owner('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 'path:line-cook:knife' } })).status, 200);
  const after = (await staff('/api/path')).data.paths[0];
  assert.ok(after.stages.flatMap((st) => st.steps).find((s) => s.id === 'path:line-cook:knife').done);
  // Nov 25: a sous chef signs off a line cook's kitchen steps; the manager sees who signed it
  const sous = person();
  assert.equal((await sous('/api/join', { method: 'POST', body: { code: join, name: 'Teodor Brandvik', pin: '6284', storeId: 1 } })).status, 200);
  assert.equal((await sous('/api/path/jobs', { method: 'POST', body: { jobs: ['sous-chef'] } })).status, 200);
  assert.deepEqual((await sous('/api/path')).data.leads, ['line-cook']);
  assert.deepEqual((await staff('/api/path')).data.leads, [], 'a line cook isn’t a lead');
  const crew = (await sous('/api/path/crew')).data;
  assert.deepEqual(crew.people.map((x) => x.name), ['Ilse Varnum']);
  assert.ok(crew.people[0].steps.find((s) => s.id === 'path:line-cook:knife').done, 'the chef’s sign-off shows');
  assert.ok(!crew.people[0].steps.some((s) => s.id === 'path:ack'), 'the acknowledgment stays with the trainer');
  assert.equal((await staff('/api/path/ask', { method: 'POST', body: { key: 'path:line-cook:station-setup' } })).status, 200);
  assert.ok((await sous('/api/path/crew')).data.people[0].steps.find((s) => s.id === 'path:line-cook:station-setup').ask, 'the ask shows');
  const signed = await sous('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 'path:line-cook:station-setup' } });
  assert.equal(signed.status, 200);
  assert.ok(signed.data.people[0].steps.find((s) => s.id === 'path:line-cook:station-setup').mine);
  const seen = (await owner(`/api/path/person/${ilse.id}`)).data.paths[0].stages.flatMap((st) => st.steps).find((s) => s.id === 'path:line-cook:station-setup');
  assert.ok(seen.done && seen.by === 'Teodor Brandvik', 'the manager sees the sous chef’s sign-off');
  // nothing else: not the acknowledgment, not a quiz, not the chef's own sign-off, not a staff member who isn't a line cook
  assert.equal((await sous('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 'path:ack' } })).status, 403);
  assert.equal((await sous('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 't:allergens' } })).status, 403);
  assert.equal((await sous('/api/path/signoff', { method: 'DELETE', body: { userId: ilse.id, key: 'path:line-cook:knife' } })).status, 403, 'can’t undo the chef’s');
  assert.equal((await sous('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 'path:line-cook:station-setup' } })).status, 409);
  assert.equal((await staff('/api/path/signoff', { method: 'POST', body: { userId: ilse.id, key: 'path:line-cook:service' } })).status, 403, 'a line cook can’t sign');
  const teo = (await owner('/api/team')).data.people.find((p) => p.name === 'Teodor Brandvik');
  assert.equal((await sous('/api/path/signoff', { method: 'POST', body: { userId: teo.id, key: 'path:sous-chef:train' } })).status, 403, 'not their own path');
  // the sous chef can take back their own; it's in the log either way
  assert.equal((await sous('/api/path/signoff', { method: 'DELETE', body: { userId: ilse.id, key: 'path:line-cook:station-setup' } })).status, 200);
  assert.ok(!(await staff('/api/path')).data.paths[0].stages.flatMap((st) => st.steps).find((s) => s.id === 'path:line-cook:station-setup').done);
  // a dishwasher and a sous chef too
  for (const job of ['dish', 'sous-chef', 'prep']) {
    const q = (await owner(`/api/path/person/${ilse.id}`, { method: 'PATCH', body: { jobs: [job] } })).data.paths[0];
    assert.ok(q.stages[0].steps.some((s) => s.id === 'path:ack'), job);
    assert.ok(!q.stages.flatMap((st) => st.steps).some((s) => DRINK.test(s.id)), job + ' no drink steps');
  }
});
