// The shared library lives with Mise Academy (HQ), not The Baldwin (Nov 19, Tommy: "make sure the Baldwin is an account.
// Not its own standing app"). Classic cocktails and the grape/region videos move to HQ's store; The Baldwin can be deleted
// like any other customer; HQ can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-libhq-'));
process.env.DATA_DIR = dir;
const { openDb } = await import('../server/db.mjs');
const { seed, moveLibraryToHq, listEntries, createEntry, sharedHome } = await import('../server/cms.mjs');
const { hqId, hqStoreId } = await import('../server/hq.mjs');
const { PROTECTED } = await import('../server/companydata.mjs');
const { setWineVideo } = await import('../server/wine.mjs');

test('the shared library lives in HQ’s store, and older databases move over once', () => {
  const db = openDb(path.join(dir, 'baldwin.db'));
  seed(db);
  const hq = hqId(), st = hqStoreId();
  assert.ok(hq && st, 'HQ and its store exist');
  assert.deepEqual(sharedHome(), { store: st, company: hq });
  const where = () => db.prepare("SELECT DISTINCT store_id s, company_id c FROM entries WHERE collection = 'classic'").all().map((r) => ({ ...r }));
  assert.deepEqual(where(), [{ s: st, c: hq }], 'seeded classics are HQ’s');
  // A database from before Nov 19: the library on The Baldwin's store, the grape videos on company 1
  db.exec("UPDATE entries SET store_id = 1, company_id = 1 WHERE collection = 'classic'");
  db.prepare("INSERT INTO wine_videos(key, video, updated_at) VALUES ('grape:cabernet', '{}', 'x'), ('wine:Caymus', '{}', 'x')").run();
  assert.ok(moveLibraryToHq(db) > 0);
  assert.deepEqual(where(), [{ s: st, c: hq }]);
  assert.equal(db.prepare("SELECT company_id c FROM wine_videos WHERE key = 'grape:cabernet'").get().c, hq, 'grape video is the library’s');
  assert.equal(db.prepare("SELECT company_id c FROM wine_videos WHERE key = 'wine:Caymus'").get().c, 1, 'a wine on a list stays its company’s');
  assert.equal(moveLibraryToHq(db), 0, 'runs once');
  // Every store still reads the classics; a new one lands in HQ
  assert.ok(listEntries(db, 'classic', 1).length > 10);
  const made = createEntry(db, 'classic', { name: 'Test Sour' }, null, 1, 1); const id = typeof made === 'object' ? made.id : made;
  assert.deepEqual({ ...db.prepare('SELECT store_id s, company_id c FROM entries WHERE id = ?').get(id) }, { s: st, c: hq });
  // A list wine's video belongs to whoever set it; a grape video to HQ
  setWineVideo(db, 'wine:Other', { kind: 'youtube', youtubeId: 'abc' }, '', null, { company: 7, store: 9 });
  setWineVideo(db, 'grape:merlot', { kind: 'youtube', youtubeId: 'abc' }, '', null);
  assert.equal(db.prepare("SELECT company_id c FROM wine_videos WHERE key = 'wine:Other'").get().c, 7);
  assert.equal(db.prepare("SELECT company_id c FROM wine_videos WHERE key = 'grape:merlot'").get().c, hq);
  db.close();
});

test('The Baldwin is a customer like any other: HQ is the one company that can’t be wiped', () => {
  assert.equal(PROTECTED.has(1), false);
  assert.equal(PROTECTED.has(hqId()), true);
  assert.deepEqual([...PROTECTED], [hqId()]);
  fs.rmSync(dir, { recursive: true, force: true });
});
