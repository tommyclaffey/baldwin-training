// The link cards say the sign-in's words (Nov 25). Tommy picked H8 for the sign-in on Nov 24 ("Ready for service.",
// label "Front and back of house"), then: "update this for our custom ones as well. Same language, different style."
// The cards still said "Know the menu cold." Now: the Mise card (public/img/mise-brand/share-card.jpg, drawn by
// scripts/share-card/render.mjs), its alt text, and the card Your Look draws for a look made from a website.
// (The Baldwin's card is its account content, outside this repo.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { MISE_SHARE } from '../server/links.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('no card text says "Know the menu cold." any more', () => {
  for (const f of ['index.html', 'server/links.mjs', 'src/admin/yourlook.tsx', 'src/components/AuthCard.tsx'])
    assert.doesNotMatch(read(f), /know the menu cold/i, f);
  assert.match(MISE_SHARE.alt, /ready for service/i);
  assert.match(read('index.html'), /og:image:alt" content="Mise: ready for service, front and back of house\./);
});

test('Your Look’s link card: the label, the two-line title in the look’s casing, the sign-in’s line', () => {
  const yl = read('src/admin/yourlook.tsx');
  const card = yl.slice(yl.indexOf('function CardArt('), yl.indexOf('/* 6 · Applied'));
  assert.match(card, />Front and back of house</);
  assert.match(card, /readyCase\('Ready for', t\)/);
  assert.match(card, /'FRONT AND BACK OF HOUSE'/, 'the canvas card too');
  assert.match(card, /READY_LINE/);
  assert.doesNotMatch(card, /the training app'|>the training app</, 'no script line');
  const auth = read('src/components/AuthCard.tsx');
  assert.match(auth, /READY_LINE = \['Training, inventory, prep and team chat', 'for every position, front and back of house\.'\]/);
});

test('the Mise card is a new 1200 × 630 image', async () => {
  const file = path.join(root, 'public/img/mise-brand/share-card.jpg');
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, 1200); assert.equal(meta.height, 630);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.notEqual(sha.slice(0, 16), 'b9d81d2891afcb00', 'not the "Know the menu cold." card');
});
