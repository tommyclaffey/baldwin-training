// Captions on uploaded videos (Nov 14, server/captions.mjs): .srt becomes WebVTT, .vtt is kept, the file is served as
// text/vtt, the player finds it by the video's address, and only managers of the video's own store add or remove it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toVtt } from '../server/captions.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cc-'));
const PORT = 6500 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

function person() {
  let jar = '';
  const go = async (p, { method = 'GET', body, raw, headers = {} } = {}) => {
    const res = await fetch(BASE + p, { method, headers: { 'X-BT': '1', ...(raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(jar ? { Cookie: jar } : {}) },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, data: type.includes('json') ? await res.json() : await res.text() };
  };
  return go;
}
before(async () => {
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: 'owner@cc.test', SUPERADMIN_EMAIL: 'boss@cc.test', PREP_WEEKLY: 'off' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('test server did not start in 30 s');
});
after(() => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:04,250\r\nStir, don’t shake.\r\n\r\n2\r\n00:00:05,5 --> 00:01:02,000\r\nExpress the peel\r\nover the glass.\r\n';

test('.srt becomes WebVTT: full stops in the times, hours filled in, cue numbers kept, BOM and CRLF gone', () => {
  assert.equal(toVtt(SRT, 'old-fashioned.srt'),
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.250\nStir, don’t shake.\n\n2\n00:00:05.500 --> 00:01:02.000\nExpress the peel\nover the glass.\n');
  assert.equal(toVtt('00:01,000 --> 00:02,000\nHi', 'x.srt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n', 'minutes-only times and no cue numbers');
});
test('.vtt is kept as is; files that aren’t captions are refused in plain words', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start\n<b>Hi</b>\n';
  assert.equal(toVtt(vtt, 'a.vtt'), vtt);
  assert.equal(toVtt(vtt), vtt, 'no name: WEBVTT at the top means VTT');
  assert.throws(() => toVtt('1\n00:00:01,000 --> 00:00:02,000\nHi', 'a.vtt'), /starts with the word WEBVTT/);
  assert.throws(() => toVtt('hello there', 'notes.srt'), /couldn’t find any timed lines/);
  assert.throws(() => toVtt('WEBVTT\n', 'a.vtt'), /no timed lines/);
  assert.throws(() => toVtt('anything', 'clip.mp4'), /\.vtt or \.srt/);
});

const owner = person(), testaGm = person(), staff = person();
let video, photo;
test('setup: an owner uploads a video and a photo; a manager at Testa Barra; a staff member', async () => {
  assert.equal((await owner('/api/setup', { method: 'POST', body: { name: 'Odette Owner', email: 'owner@cc.test', password: 'long-enough-1' } })).status, 200);
  const code = (await owner('/api/team')).data.company.joinCode;
  const stores = (await person()(`/api/join/${code}`)).data.stores;
  const inv = await owner('/api/team/invite', { method: 'POST', body: { email: 'gm@cc.test', role: 'manager', storeId: stores[2].id } });
  assert.equal((await testaGm(`/api/invite/${inv.data.link.split('/').pop()}`, { method: 'POST', body: { name: 'Gale Testa', password: 'long-enough-2' } })).status, 200);
  assert.equal((await staff('/api/join', { method: 'POST', body: { code, name: 'Sol Staff', pin: '2468', storeId: stores[0].id } })).status, 200);
  const v = await owner('/api/media/upload', { method: 'POST', raw: Buffer.from('not really a video'), headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'old-fashioned.mp4' } });
  assert.equal(v.status, 200); video = v.data;
  assert.equal(video.captions, null);
  const ph = await owner('/api/media/upload', { method: 'POST', raw: Buffer.from('not really a photo'), headers: { 'Content-Type': 'image/jpeg', 'X-Filename': 'glass.jpg' } });
  photo = ph.data;
});

const putCc = (who, id, text, name) => who(`/api/media/${id}/captions`, { method: 'PUT', raw: text, headers: { 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent(name) } });

test('a manager adds .srt captions: stored as WebVTT, served as text/vtt, listed with the video, found by the player', async () => {
  const r = await putCc(owner, video.id, SRT, 'old-fashioned.srt');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.captions, /^\/media\/[^/]+\.vtt$/);
  const file = await owner(r.data.captions);
  assert.equal(file.status, 200);
  assert.match(file.type, /^text\/vtt/);
  assert.match(file.data, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:04\.250\n/);
  assert.equal((await owner('/api/media')).data.media.find((m) => m.id === video.id).captions, r.data.captions);
  // The player (any signed-in reader) looks them up by the video's address
  assert.equal((await staff(`/api/media/captions?video=${encodeURIComponent(video.url)}`)).data.captions, r.data.captions);
  assert.equal((await staff(`/api/media/captions?video=${encodeURIComponent('/media/nothing.mp4')}`)).data.captions, null);
  assert.equal((await person()(`/api/media/captions?video=${encodeURIComponent(video.url)}`)).status, 401, 'signed out');
  // Replacing gives a new file (so the long cache never serves the old one)
  const again = await putCc(owner, video.id, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNew line\n', 'fixed.vtt');
  assert.notEqual(again.data.captions, r.data.captions);
  assert.match((await owner(again.data.captions)).data, /New line/);
});

test('only managers of the video’s own store; captions only on uploaded videos; bad files refused', async () => {
  assert.equal((await putCc(staff, video.id, SRT, 'a.srt')).status, 403, 'staff');
  assert.equal((await putCc(testaGm, video.id, SRT, 'a.srt')).status, 404, 'another store’s manager can’t reach it');
  assert.equal((await testaGm(`/api/media/${video.id}/captions`, { method: 'DELETE' })).status, 404);
  assert.equal((await putCc(owner, photo.id, SRT, 'a.srt')).status, 400, 'a photo');
  const bad = await putCc(owner, video.id, 'just some notes', 'notes.srt');
  assert.equal(bad.status, 400); assert.match(bad.data.error, /timed lines/);
  assert.equal((await putCc(owner, video.id, 'x'.repeat(1024 * 1024 + 10), 'big.vtt')).status, 413);
  assert.equal((await putCc(owner, 999999, SRT, 'a.srt')).status, 404);
});

test('removing captions unlinks them; the player finds none', async () => {
  const r = await owner(`/api/media/${video.id}/captions`, { method: 'DELETE' });
  assert.equal(r.status, 200); assert.equal(r.data.captions, null);
  assert.equal((await staff(`/api/media/captions?video=${encodeURIComponent(video.url)}`)).data.captions, null);
});

test('the demo can’t upload captions', async () => {
  const v = person();
  assert.equal((await v('/api/demo/start', { method: 'POST', body: { role: 'manager', demo: 'baldwin' } })).status, 200);
  assert.equal((await putCc(v, video.id, SRT, 'a.srt')).status, 403);
});
