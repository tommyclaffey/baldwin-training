// Nov 12: the live demo opens inside the portfolio's iframe (tommyclaffey.com).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sessionCookie, sessionCookies } from '../server/auth.mjs';

test('demo cookie is embeddable on https; real sessions stay Lax and clear the demo cookie', () => {
  const demo = sessionCookie('t', { secure: true, days: 1, embeddable: true });
  assert.match(demo, /SameSite=None/);
  assert.match(demo, /Partitioned/);
  assert.match(demo, /Secure/);
  assert.match(sessionCookie('t', { secure: false, embeddable: true }), /SameSite=Lax/); // no https, no None cookie
  const real = sessionCookies('t', { secure: true });
  assert.ok(Array.isArray(real) && real.length === 2);
  assert.match(real[0], /SameSite=Lax/);
  assert.doesNotMatch(real[0], /Partitioned/);
  assert.match(real[1], /SameSite=None; Partitioned/);
  assert.match(real[1], /Max-Age=0/);
});

test('only the app and tommyclaffey.com may frame it', () => {
  const src = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /frame-ancestors 'self' https:\/\/tommyclaffey\.com https:\/\/www\.tommyclaffey\.com/);
  assert.doesNotMatch(src, /'X-Frame-Options'/);
});
