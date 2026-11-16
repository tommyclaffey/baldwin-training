// Account content (Nov 16, Tommy: "the baldwin is supposed to [be] an account under the app"): a customer's menu seeds,
// pages, program text and files live in DATA_DIR/accounts/<company>/ on the volume (server/account.mjs), not in the repo.
// What matters most: a missing account folder or seed file never archives or deletes anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-account-'));
process.env.DATA_DIR = dir; // before any server module loads in this process
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const acct = path.join(dir, 'accounts', '1');
const write = (rel, v) => { const f = path.join(acct, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const dish = (key, name, extra = {}) => ({ key: 'recipe/' + key, slug: 'recipe/' + key, data: { name, course: 'Mains', price: '20', description: name + ', made up for this test.', ...extra } });

test('seed files: an account’s menu seeds its store; gone from the file = archived; no file or no folder = nothing changes', async () => {
  const { openDb } = await import('../server/db.mjs');
  const { initAccounts } = await import('../server/account.mjs');
  const { seed, listEntries } = await import('../server/cms.mjs');
  const db = openDb(path.join(dir, 'test.db'));
  const names = () => listEntries(db, 'recipe', 1).map((e) => e.data.name).sort();

  // No folder: the shared library only, nothing of any store's.
  initAccounts(db); seed(db);
  assert.deepEqual(names(), [], 'no account folder: no menu');
  assert.ok(listEntries(db, 'classic').length > 50, 'the shared classics still seed from the repo');

  write('account.json', { seedStore: 1, seedKeyPrefix: '' });
  write('cms/recipe.json', [dish('ember-chicken', 'Ember Chicken'), dish('river-trout', 'River Trout')]);
  write('cms/house.json', [{ key: 'signature/quiet-hour', slug: 'signature/quiet-hour', data: { name: 'Quiet Hour', menuSection: 'House Cocktails', price: '14' } }]);
  initAccounts(db); seed(db);
  assert.deepEqual(names(), ['Ember Chicken', 'River Trout']);
  assert.deepEqual(listEntries(db, 'house', 1).map((e) => e.data.name), ['Quiet Hour']);
  assert.equal(db.prepare("SELECT company_id FROM entries WHERE seed_key = 'recipe:recipe/ember-chicken'").get().company_id, 1, 'the library dish is the account’s');

  // Dropped from the file: archived, never deleted. Back in the file: back in the book.
  write('cms/recipe.json', [dish('ember-chicken', 'Ember Chicken')]);
  seed(db);
  assert.deepEqual(names(), ['Ember Chicken']);
  assert.ok(db.prepare("SELECT archived_at FROM entries WHERE seed_key = 'recipe:recipe/river-trout'").get().archived_at, 'the group’s dish is archived, not deleted');
  assert.ok(db.prepare("SELECT 1 FROM entries WHERE store_id = 1 AND slug = 'recipe/river-trout'").get(), 'its menu entry is still there for a restore');
  write('cms/recipe.json', [dish('ember-chicken', 'Ember Chicken'), dish('river-trout', 'River Trout')]);
  seed(db);
  assert.deepEqual(names(), ['Ember Chicken', 'River Trout'], 'back in the file, back in the book');

  // A seed file that isn't there, or can't be read, seeds nothing and archives nothing.
  const count = () => db.prepare('SELECT COUNT(*) n FROM entries WHERE archived_at IS NULL').get().n;
  const before = count();
  fs.rmSync(path.join(acct, 'cms', 'recipe.json'));
  seed(db);
  assert.equal(count(), before, 'recipe.json gone: nothing archived');
  fs.writeFileSync(path.join(acct, 'cms', 'house.json'), '{ not json');
  seed(db);
  assert.equal(count(), before, 'a broken file: skipped, nothing archived');
  fs.rmSync(acct, { recursive: true });
  initAccounts(db); seed(db);
  assert.equal(count(), before, 'the whole folder gone: nothing archived, the database still serves');
  assert.deepEqual(names(), ['Ember Chicken', 'River Trout']);

  // Another account's seeds land in its own store, with its own key prefix, and never touch company 1's.
  const co = Number(db.prepare("INSERT INTO companies(name, slug, created_at, brand, plan) VALUES ('Harbor Lane', 'harbor-lane', 'now', 'mise', 'foundation')").run().lastInsertRowid);
  const st = Number(db.prepare("INSERT INTO stores(company_id, name, slug, book_ready, sort, created_at) VALUES (?, 'Harbor Lane Kitchen', 'harbor-lane-kitchen', 0, 0, 'now')").run(co).lastInsertRowid);
  const other = path.join(dir, 'accounts', String(co));
  fs.mkdirSync(path.join(other, 'cms'), { recursive: true });
  fs.writeFileSync(path.join(other, 'account.json'), JSON.stringify({ seedStore: st }));
  fs.writeFileSync(path.join(other, 'cms', 'house.json'), JSON.stringify([{ key: 'signature/quiet-hour', slug: 'signature/quiet-hour', data: { name: 'Harbor Quiet Hour', menuSection: 'House Cocktails' } }]));
  initAccounts(db); seed(db);
  assert.deepEqual(listEntries(db, 'house', st).map((e) => e.data.name), ['Harbor Quiet Hour']);
  assert.ok(db.prepare('SELECT 1 FROM entries WHERE seed_key = ?').get(`a${co}:house:signature/quiet-hour`), 'its keys carry its prefix');
  assert.equal(count(), before + 1, 'company 1’s entries untouched');
});

test('the repo holds no store’s menu: only the shared library seeds from content/cms', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'content/cms')).sort(), ['classic.json']);
});

test('account files: served at their /img/ and /icons/ addresses, nothing outside the folder', async () => {
  const { publicFile, initAccounts } = await import('../server/account.mjs');
  const f = path.join(dir, 'accounts', '1', 'public', 'img', 'house-logo.png');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'png');
  initAccounts(null);
  assert.equal(publicFile('/img/house-logo.png'), f);
  for (const bad of ['/img/../../account.json', '/img/%2e%2e/x', '/content/pages/23-2.json', '/img/missing.png', '/icons/../img/house-logo.png']) assert.equal(publicFile(bad), null, bad);
});
