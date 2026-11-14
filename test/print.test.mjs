// Printing (Nov 14, Tommy: "making these one sheet prints better"): pages print portrait, on one sheet when they can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../src/lib/print.ts', import.meta.url), 'utf8');
const { printZoom } = await import('data:text/javascript,' + encodeURIComponent(src.replace(/: number/g, '').replace(/export function setupPrint[\s\S]*$/, '').replace(/function measure[\s\S]*?\n}\n/, '')));

test('every page prints portrait; only the certificate (while it is open) turns the sheet', () => {
  const pages = [...css.matchAll(/@page\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert.deepEqual(pages.length, 1);
  assert.match(pages[0], /letter portrait/);
  const cert = fs.readFileSync(new URL('../src/path/Certificate.tsx', import.meta.url), 'utf8');
  assert.match(cert, /@page \{ size: letter landscape/);
});

test('phone layouts never reach paper: narrow-screen rules are screen-only', () => {
  const bare = [...css.matchAll(/@media\s+([^{]*)\{/g)].map((m) => m[1]).filter((q) => /max-width/.test(q) && !/^\s*screen/.test(q));
  assert.deepEqual(bare, []);
});

test('a short page fits one sheet; a long one prints full width instead of shrinking past readable', () => {
  const full = printZoom(1000);
  assert.ok(full > 0.6 && full < 0.66, 'full width ≈ 0.63');
  assert.ok(printZoom(1800) < full && printZoom(1800) >= 0.5, 'shrinks to fit one sheet');
  assert.equal(printZoom(5000), full, 'too long to fit: full width, more sheets');
});

test('menus, buttons, videos and next/previous stay off paper', () => {
  const print = css.slice(css.indexOf('/* Print (Nov 14'));
  for (const s of ['.page-tools', '[data-name="Top bar"]', '[data-name$=" nav"]', '[data-name^="Video slot"]', '[data-name="The classics"]', '[data-name^="Button · "]'])
    assert.ok(print.includes(s), s);
  assert.match(print, /print-color-adjust: exact/);
});
