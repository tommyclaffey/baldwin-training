// AI menu import (Nov 14, server/menuimport.mjs). Runs the real server on a temp database. The Claude API is a fake local
// server (ANTHROPIC_BASE_URL) that streams a reading the way the real one does, or fails the way the real one can.
// The demos read their sample menu with no API call at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { giveAccount, startServer } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-import-'));
let PORT, BASE; // set when the server starts: it listens on a port the OS picks (startServer, Nov 26)
let server, fake, owner = '';
let ipN = 0;
const freshIp = () => `10.8.${Math.floor(++ipN / 250)}.${ipN % 250}`;

/* ---- the fake Claude API ---- */
let mode = 'good';
const calls = [];
const READING = {
  title: 'Fall Food Book 2026', pageCount: 2,
  items: [
    { page: 1, section: 'Small Plates', name: 'Ember Carrots', price: '13', priceUnclear: false, description: 'Fire-roasted carrots, whipped feta, hazelnut dukkah.', lines: ['EMBER CARROTS 13', 'fire-roasted carrots, whipped feta, hazelnut dukkah', 'contains dairy, tree nut'],
      course: 'Snacks & Small Plates', ingredients: ['Carrots', 'Whipped feta', 'Hazelnut dukkah'], gfOption: false,
      allergens: [{ name: 'Dairy', printed: true, quote: 'contains dairy, tree nut' }, { name: 'Tree Nut', printed: true, quote: 'contains dairy, tree nut' }, { name: 'Sesame', printed: false, quote: 'dukkah' }],
      drafts: { sellingLine: 'Smoky carrots with a creamy feta base.', say: 'Ember carrots with whipped feta and dukkah.', talkingPoints: ['Fire-roasted', 'Hazelnut dukkah'] } },
    { page: 2, section: 'Mains', name: 'Seared Salmon', price: '31', priceUnclear: true, description: 'Seared salmon with lemon butter.', lines: ['SEARED SALMON 31', 'seared salmon, lemon butter'],
      course: 'Mains', ingredients: ['Salmon', 'Lemon butter'], gfOption: true,
      allergens: [{ name: 'Finfish', printed: true, quote: 'contains fish' }, { name: 'Dairy', printed: false, quote: 'lemon butter' }],
      drafts: { sellingLine: 'A light main.', say: 'Seared salmon, lemon butter.', talkingPoints: [] } },
  ],
};
function sse(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
  ev({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } });
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  ev({ type: 'content_block_stop', index: 0 });
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 37) ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(i, i + 37) } });
  ev({ type: 'content_block_stop', index: 1 });
  ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  ev({ type: 'message_stop' });
  res.end();
}

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ headers: req.headers, body: JSON.parse(body || '{}') });
      if (mode === 'credit') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })); }
      if (mode === 'busy') { res.writeHead(529, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })); }
      if (mode === 'nofallback' && calls.at(-1).body.fallbacks) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: unknown parameter' } })); }
      sse(res, JSON.stringify(READING));
    });
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  giveAccount(dir); ({ server, port: PORT, base: BASE } = await startServer({ ...process.env, DATA_DIR: dir, OWNER_EMAIL: 'owner@example.test', SUPERADMIN_EMAIL: 'super@example.test', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fake.address().port}`, MENU_IMPORT_DEMO_MS: '15' }));
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ name: 'Owner', email: 'owner@example.test', password: 'long-enough-1' }) });
  assert.equal(r.status, 200);
  owner = r.headers.get('set-cookie').split(';')[0];
});
after(() => { server?.kill(); fake?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function demo(role = 'manager', which = 'mise') {
  const r = await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ role, demo: which }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
}
const call = async (cookie, p, body, method = body === undefined ? 'GET' : 'POST') => {
  const r = await fetch(BASE + p, { method, headers: { cookie, 'content-type': 'application/json', 'x-bt': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
async function until(cookie, id, statuses) {
  for (let i = 0; i < 300; i++) {
    const s = await ok(cookie, `/api/imports/${id}`);
    if (statuses.includes(s.import.status)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('import never finished reading');
}
const upload = (cookie, id, buf, type, name) => fetch(`${BASE}/api/imports/${id}/files`, { method: 'POST', headers: { cookie, 'content-type': type, 'x-filename': encodeURIComponent(name), 'x-bt': '1' }, body: buf });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF');
const names = async (cookie) => (await ok(cookie, '/api/entries?collection=recipe')).entries.map((e) => e.data.name);

test('the reader’s helpers: dishes come out of a half-finished answer, and a fenced answer still parses', async () => {
  const { partialItems, parseAnswer, normName } = await import('../server/menuimport.mjs');
  const text = JSON.stringify(READING);
  assert.deepEqual(partialItems(text.slice(0, text.indexOf('Seared Salmon'))).map((x) => x.name), ['Ember Carrots']);
  assert.equal(partialItems(text).length, 2);
  assert.deepEqual(partialItems('{"title":"x","items":['), []);
  assert.equal(parseAnswer('```json\n' + text + '\n```').items.length, 2);
  assert.equal(parseAnswer('nope'), null);
  assert.equal(normName('Lobster & Crab  Tortellini!'), normName('lobster and crab tortellini'));
});

test('no key: a plain message, never a crash', async () => {
  const { readWithClaude } = await import('../server/menuimport.mjs');
  const was = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(readWithClaude({ files: [], kind: 'food' }), /menu reader isn’t available right now/);
  if (was) process.env.ANTHROPIC_API_KEY = was;
});

test('demo: the sample menu reads with no API call, and a manager reviews, approves and undoes it', async () => {
  const me = await demo('manager', 'mise');
  const before = calls.length;
  const book = await names(me);
  const start = await ok(me, '/api/imports', { kind: 'food' });
  assert.equal(start.import.status, 'uploaded');
  assert.equal(start.import.files[0].sample, true, 'the sample menu is labelled as a sample');
  assert.equal((await upload(me, start.import.id, PDF, 'application/pdf', 'mine.pdf')).status, 403, 'no uploads in the demo');
  assert.equal((await call(me, '/api/imports', { kind: 'wine' })).status, 400, 'the sample is a Food Book');
  const id = start.import.id;
  const reading = await ok(me, `/api/imports/${id}/read`, {});
  assert.equal(reading.import.status, 'reading');
  const s = await until(me, id, ['review']);
  assert.equal(calls.length, before, 'no call to the Claude API');
  assert.equal(s.counts.new, 5);
  assert.equal(s.counts.updated, 3);
  assert.equal(s.counts.missing, 2, 'two dishes from the book aren’t on the sample menu');
  assert.equal(s.counts.unchanged, book.length - 2 - 3);
  assert.deepEqual(await names(me), book, 'nothing is in the book until it’s approved');

  // Allergens always need a manager: Approve is locked until they're confirmed.
  const octopus = s.items.find((i) => i.name === 'Charred Octopus');
  assert.equal(octopus.allergensOk, false);
  assert.ok(octopus.source.allergens.some((a) => a.name === 'Allium' && !a.printed && a.quote === 'garlic'), 'shows where each allergen came from');
  assert.equal((await call(me, `/api/imports/${id}/items/${octopus.id}/approve`, {})).status, 409);
  await ok(me, `/api/imports/${id}/items/${octopus.id}/confirm`, { allergens: ['Shellfish', 'Allium', 'Nightshade'] });
  const a1 = await ok(me, `/api/imports/${id}/items/${octopus.id}/approve`, {});
  assert.equal(a1.items.find((i) => i.id === octopus.id).decision, 'approved');
  assert.ok((await names(me)).includes('Charred Octopus'), 'approved: in the book');
  const entry = (await ok(me, '/api/entries?collection=recipe')).entries.find((e) => e.data.name === 'Charred Octopus');
  assert.deepEqual(entry.data.allergens.sort(), ['Allium', 'Nightshade', 'Shellfish']);
  assert.equal(entry.data.sellingLine, '', 'the AI’s selling line waits as a draft');
  // The Allergen Guide and the Food Matrix are built from the book, so the dish is there.
  const guide = await ok(me, '/api/page/17-2');
  assert.match(JSON.stringify(guide), /Charred Octopus/);

  // A price the reader couldn't read: Check This first.
  const duck = s.items.find((i) => i.name === 'Roast Duck Breast');
  assert.equal(duck.priceOk, false);
  await ok(me, `/api/imports/${id}/items/${duck.id}/confirm`, {});
  assert.equal((await call(me, `/api/imports/${id}/items/${duck.id}/approve`, {})).status, 409);
  // Approve All Confirmed takes only confirmed, checked items.
  const upd = s.items.filter((i) => i.status === 'updated');
  await ok(me, `/api/imports/${id}/items/${upd[0].id}/confirm`, {});
  const all = await ok(me, `/api/imports/${id}/approve-confirmed`, {});
  assert.equal(all.approvedNow, 1, 'the confirmed update only (the duck’s price isn’t checked)');
  const upEntry = (await ok(me, '/api/entries?collection=recipe')).entries.find((e) => e.data.name === upd[0].name);
  assert.equal(upEntry.data.price, upd[0].data.price, 'the update is in the book');
  await ok(me, `/api/imports/${id}/items/${duck.id}/price`, { price: '$38' });
  await ok(me, `/api/imports/${id}/items/${duck.id}/approve`, {});

  // Undo one: a new dish comes out of the book again.
  await ok(me, `/api/imports/${id}/items/${duck.id}/undo`, {});
  assert.ok(!(await names(me)).includes('Roast Duck Breast'));
  // Skip, and the "not in this file" group: Keep is the default, Archive is the manager's call.
  const doughnuts = s.items.find((i) => i.name === 'Apple Cider Doughnuts');
  await ok(me, `/api/imports/${id}/items/${doughnuts.id}/skip`, {});
  const missing = s.items.filter((i) => i.status === 'missing');
  assert.ok(missing.every((i) => i.decision === 'keep'));
  await ok(me, `/api/imports/${id}/items/${missing[0].id}/archive`, {});
  assert.ok(!(await names(me)).includes(missing[0].name));

  // Done: the drafts wait for a manager; approving one puts it on the page.
  const done = await ok(me, `/api/imports/${id}/finish`, {});
  assert.equal(done.import.status, 'done');
  assert.equal(done.summary.added, 1);
  assert.equal(done.summary.updated, 1);
  assert.ok(done.summary.questions > 0, 'quizzes come from the approved data');
  const dr = done.summary.drafts.find((d) => d.name === 'Charred Octopus' && d.field === 'sellingLine');
  assert.ok(dr);
  await ok(me, `/api/imports/${id}/items/${dr.itemId}/draft`, { field: 'sellingLine', action: 'approve', text: 'Smoky, tender octopus to share.' });
  assert.equal((await ok(me, '/api/entries?collection=recipe')).entries.find((e) => e.data.name === 'Charred Octopus').data.sellingLine, 'Smoky, tender octopus to share.');

  // Undo This Import: new dishes archived, updated ones back the way they were, the archived one back in the book.
  const undone = await ok(me, `/api/imports/${id}/undo`, {});
  assert.equal(undone.import.status, 'undone');
  const after = await ok(me, '/api/entries?collection=recipe');
  assert.deepEqual(after.entries.map((e) => e.data.name).sort(), [...book].sort());
  const was = (await ok(me, '/api/entries?collection=recipe')).entries.find((e) => e.data.name === upd[0].name);
  assert.notEqual(was.data.price, upd[0].data.price);
});

test('who can import: staff can’t; another company can’t see this one’s import', async () => {
  const staff = await demo('employee', 'mise');
  assert.equal((await call(staff, '/api/imports')).status, 403);
  const me = await demo('manager', 'brg');
  const { import: imp } = await ok(me, '/api/imports', { kind: 'food' });
  assert.equal((await call(owner, `/api/imports/${imp.id}`)).status, 404, 'the real company can’t see a demo’s import');
  assert.equal((await call(await demo('manager', 'mise'), `/api/imports/${imp.id}`)).status, 404, 'nor can another demo');
  const mine = await ok(owner, '/api/imports', { kind: 'food' });
  assert.equal((await call(me, `/api/imports/${mine.import.id}`)).status, 404, 'the demo can’t see the real company’s');
  assert.equal((await call(me, `/api/imports/${mine.import.id}/read`, {})).status, 404);
});

test('a real read: files go to the Claude API, dishes stream in, and it matches the book', async () => {
  mode = 'good';
  const { import: imp } = await ok(owner, '/api/imports', { kind: 'food' });
  assert.equal((await call(owner, `/api/imports/${imp.id}/read`, {})).status, 400, 'nothing to read yet');
  assert.equal((await upload(owner, imp.id, Buffer.from('hello'), 'text/plain', 'x.txt')).status, 415);
  const up = await upload(owner, imp.id, PDF, 'application/pdf', 'Fall Food Book.pdf');
  assert.equal(up.status, 200);
  const f = (await up.json()).import;
  assert.equal(f.files[0].pages, 2);
  const n = calls.length;
  await ok(owner, `/api/imports/${imp.id}/read`, {});
  const s = await until(owner, imp.id, ['review', 'failed']);
  assert.equal(s.import.status, 'review', s.import.error);
  const req = calls[n];
  assert.equal(req.headers['x-api-key'], 'test-key');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.messages[0].content.find((b) => b.type === 'document').source.media_type, 'application/pdf');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(s.import.title, 'Fall Food Book 2026');
  const salmon = s.items.find((i) => i.name === 'Seared Salmon');
  assert.equal(salmon.priceOk, false, 'flagged as hard to read');
  assert.deepEqual(salmon.data.allergens.sort(), ['Dairy', 'Finfish']);
  // the original file is there for "Open the Original"
  const orig = await fetch(`${BASE}/api/imports/${imp.id}/files/0`, { headers: { cookie: owner } });
  assert.equal(orig.status, 200);
  assert.equal(orig.headers.get('content-type'), 'application/pdf');
});

test('no credit, or the API is busy: a plain message, and the files stay for a retry', async () => {
  const { import: imp } = await ok(owner, '/api/imports', { kind: 'wine' });
  assert.equal((await upload(owner, imp.id, PDF, 'application/pdf', 'Wine List.pdf')).status, 200);
  mode = 'credit';
  await ok(owner, `/api/imports/${imp.id}/read`, {});
  let s = await until(owner, imp.id, ['failed', 'review']);
  assert.equal(s.import.status, 'failed');
  assert.match(s.import.error, /menu reader isn’t available right now/);
  assert.equal(s.import.files.length, 1, 'the upload is kept');
  mode = 'busy';
  await ok(owner, `/api/imports/${imp.id}/read`, {});
  s = await until(owner, imp.id, ['failed', 'review']);
  assert.match(s.import.error, /busy/);
  // An API that won't take the fallback option: it reads again without it.
  mode = 'nofallback';
  await ok(owner, `/api/imports/${imp.id}/read`, {});
  s = await until(owner, imp.id, ['failed', 'review']);
  assert.equal(s.import.status, 'review', s.import.error);
  assert.ok(calls.at(-2).body.fallbacks === 'default' && calls.at(-1).body.fallbacks === undefined, 'retried without fallbacks');
  mode = 'good';
});

test('a demo’s imports go with the demo', async () => {
  const me = await demo('manager', 'brg');
  const { import: imp } = await ok(me, '/api/imports', { kind: 'food' });
  await ok(me, `/api/imports/${imp.id}/read`, {});
  await until(me, imp.id, ['review']);
  // a refresh swaps the demo for a fresh copy and drops the old one
  const r = await fetch(BASE + '/api/demo/restart', { method: 'POST', headers: { cookie: me, 'x-bt': '1' } });
  assert.equal((await r.json()).restarted, true);
  const fresh = r.headers.getSetCookie().find((x) => x.startsWith('bt_session=')).split(';')[0];
  assert.equal((await ok(fresh, '/api/imports')).recent.length, 0);
  assert.equal((await call(fresh, `/api/imports/${imp.id}`)).status, 404);
});
