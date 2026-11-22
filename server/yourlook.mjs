// Your Look from your website (Nov 22; Figma 09 · Idea Board → 44, 877:1388; Tommy, Nov 20: "Looks good to me").
// Admin → Settings → Your Look. An owner (or a manager) of a Custom Brand company pastes the restaurant's website; the app
// reads it (server/lookreader.mjs), gives every colour a role and checks every pair for contrast (src/lib/lookspec.ts),
// shows the look on Home, sign-in and the link card, and applies it to one store or the whole group. Undo puts the last
// look back. Every step is in the log.
//
// Looks made here are DATA: a `looks` row per look (its LookSpec as JSON), drawn by theme.ts `themeFromSpec`. A store or a
// company wears one by id ('look-12' in stores.look / companies.brand, server/looks.mjs). The hand-built looks (The Baldwin,
// Testa Barra, J.Baldwin's) stay as they are in theme.ts.
//
//   looks         id · company_id · name · spec (LookSpec JSON) · extra (what the read found: every logo, photo, font and
//                 colour, the fixes) · source_url · status ('draft' until applied once, then 'saved') · demo · by · times
//   look_reads    one website read: steps as they happen, the look it made, or the error. Kept 30 days.
//   look_changes  every Apply and Undo: what each store and the company wore before and after, so Undo can put it back.
//
// Who: owners and managers of Custom Brand companies (a store manager only for their own store); super admins for any
// company they work in; Foundation owners see the upgrade card (Figma 882:1434, no price); managers and staff on
// Foundation don't see Your Look at all. A demo (both demos) can try it: its look is a throwaway, wiped with the demo
// (every table here has company_id, server/companydata.mjs wipeCompany; its files go with the company's folder).
//
// Files (logos, the icon, photos) are the company's, in /data/looks/<company id>/, named by their content. They open for
// that company's signed-in people and super admins; once a look is worn, its own logo, icon and photo also open signed out
// (the sign-in screen and the link card show them before anyone signs in).
//
// Claude is optional: when ANTHROPIC_API_KEY works and has credit, it's asked which of the site's colours plays which
// role; anything it says is checked against the site's own colours and the contrast rules. If the call fails for any
// reason (no key, no credit, busy, a bad answer), the rules decide, so the feature never depends on API credit.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, now, audit } from './db.mjs';
import { readSite, ReadError, analyzeImage, sha, STEPS } from './lookreader.mjs';
import { rolesFromColors, fixColors, checkPairs, validSpec, isHex, normHex, COLOR_KEYS, HEADING_SCALE, UPPER_FACES, FONT_NAME, LOOK_FILE } from '../src/lib/lookspec.ts';
import { PLANS, DEFAULT_PLAN, LOOKS, lookOfStore, lookOf, setDataLooks, isDataLook } from './looks.mjs';

export const LOOK_DIR = path.join(DATA_DIR, 'looks');
const MODEL = 'claude-opus-5-5';
const API_VERSION = '2026-10-21';

export function migrateLooks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS looks(id INTEGER PRIMARY KEY, company_id INT NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL, extra TEXT,
      source_url TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','saved')), demo INT NOT NULL DEFAULT 0,
      created_by INT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS looks_company ON looks(company_id);
    CREATE TABLE IF NOT EXISTS look_reads(id INTEGER PRIMARY KEY, company_id INT NOT NULL, store_id INT, url TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'store',
      status TEXT NOT NULL CHECK(status IN ('reading','done','failed','cancelled')), steps TEXT, found TEXT, look_id INT, error TEXT, by_ai INT NOT NULL DEFAULT 0,
      created_by INT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS look_changes(id INTEGER PRIMARY KEY, company_id INT NOT NULL, look_id INT, scope TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL,
      by_user INT, at TEXT NOT NULL, undone_at TEXT, undone_by INT);
    CREATE INDEX IF NOT EXISTS look_changes_company ON look_changes(company_id, id);`);
  db.prepare("DELETE FROM look_reads WHERE created_at < ?").run(new Date(Date.now() - 30 * 864e5).toISOString());
  // a read cut off by a restart never finishes: say so
  db.prepare("UPDATE look_reads SET status = 'failed', error = 'The app restarted while reading. Try again.' WHERE status = 'reading'").run();
  // server/looks.mjs asks here what a 'look-<id>' is
  setDataLooks((id) => {
    const r = db.prepare('SELECT id, company_id, name, demo FROM looks WHERE id = ?').get(Number(String(id).slice(5)));
    return r ? { id: 'look-' + r.id, name: r.name, custom: true, data: true, madeFor: [r.company_id], demo: !!r.demo } : null;
  });
}

const J = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const lookId = (n) => 'look-' + n;
const numId = (id) => (isDataLook(id) ? Number(String(id).slice(5)) : null);
const companyRow = (db, id) => db.prepare('SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL').get(id);
const storesOf = (db, co) => db.prepare('SELECT * FROM stores WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort, id').all(co);

/** A worn look's spec, for the app (/api/me, the join screen, an account's link, a certificate). Null for built-in looks. */
export function lookPayload(db, id) {
  const n = numId(id);
  if (!n) return null;
  const r = db.prepare('SELECT id, name, spec FROM looks WHERE id = ?').get(n);
  const spec = r && J(r.spec);
  return spec && validSpec(spec) ? { id: lookId(r.id), name: r.name, spec } : null;
}
/** Is this look worn by its company or one of its stores right now? */
function inUse(db, n) {
  const r = db.prepare('SELECT company_id FROM looks WHERE id = ?').get(n);
  if (!r) return false;
  const id = lookId(n);
  const co = companyRow(db, r.company_id);
  if (!co) return false;
  if (lookOf(co) === id) return true;
  return storesOf(db, co.id).some((st) => lookOfStore(co, st) === id);
}

/* ── Files ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
function saveFile(companyId, buf, ext) {
  const dir = path.join(LOOK_DIR, String(Number(companyId)));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${sha(buf)}.${ext}`;
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
  return `/look-files/${Number(companyId)}/${name}`;
}
/** The file behind /look-files/<company>/<name>, if this person may open it (null = 404). */
export function lookFileFor(db, user, p) {
  const m = /^\/look-files\/(\d+)\/([a-f0-9]{16,64}\.(png|webp|jpg))$/.exec(p);
  if (!m) return null;
  const f = path.join(LOOK_DIR, m[1], m[2]);
  if (!fs.existsSync(f)) return null;
  const company = Number(m[1]);
  const mine = user && (user.role === 'superadmin' || Number(user.company_id ?? user.acting_company_id) === company);
  if (mine) return { file: f, cache: 'private, max-age=31536000, immutable' };
  // signed out (or another company): only the files a worn look shows before sign-in
  for (const r of db.prepare("SELECT id, spec, extra FROM looks WHERE company_id = ? AND status = 'saved'").all(company)) {
    const s = J(r.spec, {});
    const shown = [s.logo?.dark?.src, s.logo?.light?.src, s.icon, s.photo, J(r.extra, {}).card];
    if (shown.includes(p) && inUse(db, r.id)) return { file: f, cache: 'public, max-age=86400' };
  }
  return null;
}

/* ── Who can use it ───────────────────────────────────────────────────────────────────────────────────────────────── */
/** 'full' (use it) · 'try' (a demo on Foundation: the upgrade card, then a throwaway look) · 'upgrade' (a Foundation
 *  owner: the card) · 'none' (nav hidden; refused). */
export function accessFor(u, co) {
  if (!u || !co || co.internal) return 'none';
  const custom = (PLANS[co.plan] || PLANS[DEFAULT_PLAN]).customLook;
  if (u.role === 'superadmin') return co.demo && !custom ? 'try' : 'full';
  if (co.demo) return u.role === 'manager' || u.role === 'owner' ? (custom ? 'full' : 'try') : 'none';
  if (u.role !== 'owner' && u.role !== 'manager') return 'none';
  if (custom) return 'full';
  return u.role === 'owner' ? 'upgrade' : 'none';
}
const groupAllowed = (u) => u.role === 'owner' || u.role === 'superadmin' || (u.role === 'manager' && !u.store_id);

/* ── Building a look from a read ──────────────────────────────────────────────────────────────────────────────────── */
function headingScale(face) { return HEADING_SCALE[face] ?? 1; }
/** The site's colours as Claude sees them, and its answer checked: every role must be one of the site's colours. */
async function rolesByClaude(found, { signal } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.LOOK_AI === 'off') return null;
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const palette = found.colors.slice(0, 24).map((c) => ({ hex: c.hex, weight: Math.round(c.weight), from: c.from }));
  const roles = ['page', 'card', 'ink', 'muted', 'panel', 'accentDark', 'accentLight'];
  const schema = { type: 'object', additionalProperties: false, required: roles, properties: Object.fromEntries(roles.map((r) => [r, { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }])) };
  const prompt = `A restaurant's website uses these colours (weight = how much; from: var = its own named palette, page = the page's own styles, css = stylesheets, logo = its logo's pixels):\n${JSON.stringify(palette)}\n\nPick the colours for a staff training app in this restaurant's look. Roles: page (light page background), card (light card, usually a little lighter than page), ink (body text, near-black), muted (quiet text, a grey), panel (the dark sidebar), accentDark (the brand accent shown on the dark panel), accentLight (the accent on light cards: a deep colour from the logo or palette that reads on light). Use only colours from the list (page may be the card colour a step darker). Answer with the JSON only.`;
  try {
    const res = await fetch(base + '/v1/messages', { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25e3)]) : AbortSignal.timeout(25e3),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: prompt }] }) });
    if (!res.ok) return null;
    const msg = await res.json();
    if (msg.stop_reason === 'refusal') return null;
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const out = J(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!out) return null;
    const allowed = new Set(found.colors.map((c) => c.hex));
    const pick = {};
    for (const r of roles) { const h = normHex(out[r] || ''); if (!h) return null; pick[r] = h; }
    // only the site's own colours (page may be a step darker than one of them)
    if (!['card', 'ink', 'panel', 'accentDark'].every((r) => allowed.has(pick[r]))) return null;
    return pick;
  } catch { return null; }
}
/** What a read becomes: files saved, roles chosen, contrast fixed. → { spec, extra, byAi } */
async function lookFromRead(found, companyId, { signal } = {}) {
  const logos = found.logos.map((l) => ({ src: saveFile(companyId, l.buf, l.ext), w: l.a.width, h: l.a.height, crop: l.a.crop, variant: l.variant, from: l.src }));
  const photos = found.photos.map((p) => ({ src: saveFile(companyId, p.buf, 'jpg'), w: p.w, h: p.h, from: p.src }));
  const icon = found.icon ? saveFile(companyId, found.icon.buf, found.icon.ext) : null;
  const mapped = rolesFromColors(found.colors);
  let byAi = false;
  const ai = await rolesByClaude(found, { signal });
  if (ai) {
    byAi = true;
    Object.assign(mapped.colors, { page: ai.page, card: ai.card, ink: ai.ink, muted: ai.muted, panel: ai.panel, accentDark: ai.accentDark, accentLight: ai.accentLight, label: ai.muted });
  }
  const named = found.colors.filter((c) => c.from.includes('var')).map((c) => c.hex);
  const fixed = fixColors(mapped.colors, { logo: found.logoColors, named, other: found.colors.slice(0, 20).map((c) => c.hex) });
  // what each fixed role now is, in words (the Check screen's "Colour roles")
  for (const f of fixed.fixes) {
    if (f.id === 'muted') mapped.why.muted = (mapped.why.muted || 'Your grey') + ', darkened';
    if (f.id === 'accentLight') mapped.why.accentLight = /from your logo/.test(f.note) ? 'From your logo' : /other accent/.test(f.note) ? 'Your other accent, darkened' : /another colour/.test(f.note) ? 'Another colour from your site' : 'Your accent, darkened';
    if (f.id === 'label') mapped.why.label = (mapped.why.label || 'Your grey') + ', lightened';
    if (f.id === 'accentDark') mapped.why.accentDark = (mapped.why.accentDark || 'Your accent') + ', lightened';
  }
  if (mapped.why.accentDark && fixed.fixes.some((f) => f.id === 'accentLight')) mapped.why.accentDark = mapped.why.accentDark.replace('most-used accent', 'most-used accent (dark surfaces only)');
  const dark = logos.find((l) => l.variant === 'dark');
  const light = logos.find((l) => l.variant === 'light');
  const f = found.fonts;
  const spec = {
    v: 1, name: String(found.siteName || found.host).slice(0, 60),
    colors: fixed.colors,
    fonts: { heading: f.heading, accent: f.accent, body: f.body, headingCase: f.headingCase, standIn: f.standIn },
    logo: { ...(dark ? { dark: { src: dark.src, w: dark.w, h: dark.h, crop: dark.crop } } : {}), ...(light ? { light: { src: light.src, w: light.w, h: light.h, crop: light.crop } } : {}) },
    ...(icon ? { icon } : {}), ...(photos[0] ? { photo: photos[0].src } : {}), source: found.url,
  };
  const extra = { logos, photos, icon, fonts: { found: f.found, standIn: f.standIn, systemBody: f.systemBody }, colorsFound: found.colors.slice(0, 12).map((c) => c.hex), colorCount: found.colorCount,
    fixes: fixed.fixes, checked: fixed.checked, passedAsFound: fixed.passedAsFound, why: mapped.why, byAi, pages: found.pages };
  return { spec, extra, byAi };
}
/** A fresh look with no website: Mise's own warm palette to start from, every role editable. */
function blankSpec(name) {
  return { v: 1, name: String(name).slice(0, 60), colors: { page: '#F2EEE7', card: '#FBF9F5', ink: '#1E1C1A', muted: '#5E574F', line: '#DDD3C5', panel: '#1E1C1A', onPanel: '#F2EEE7', label: '#B8AFA3', accentDark: '#C49A6C', onAccentDark: '#1E1C1A', accentLight: '#8A5A3A', onAccentLight: '#FFFFFF' },
    fonts: { heading: 'Playfair Display', accent: 'Gilda Display', body: 'Archivo', headingCase: 'title', standIn: {} }, logo: {} };
}

/** The look as the Adjust screen reads it. */
function lookOut(db, r) {
  const spec = J(r.spec, {}), extra = J(r.extra, {});
  return { id: lookId(r.id), name: r.name, status: r.status, source: r.source_url, spec, pairs: checkPairs(spec.colors), fixes: extra.fixes || [], checked: extra.checked || 8,
    passedAsFound: extra.passedAsFound ?? null, options: { logos: extra.logos || [], photos: extra.photos || [], icon: extra.icon || null }, fonts: extra.fonts || null,
    colorsFound: extra.colorsFound || [], colorCount: extra.colorCount || 0, why: extra.why || {}, byAi: !!extra.byAi, pages: extra.pages || [], inUse: inUse(db, r.id), updatedAt: r.updated_at };
}
/** Who wears what in a company, for Undo: { company: brand, stores: { id: look|null } }. */
const wearing = (db, co) => ({ company: co.brand, stores: Object.fromEntries(storesOf(db, co.id).map((s) => [s.id, s.look ?? null])) });
const nameOf = (db, co, id) => (LOOKS[id]?.name) || (numId(id) && db.prepare('SELECT name FROM looks WHERE id = ?').get(numId(id))?.name) || 'Mise Academy';

/* ── Reads in progress (in memory: steps go to the row as they happen) ───────────────────────────────────────────── */
const running = new Map(); // read id → AbortController

export function yourLookRoutes({ db, fail, sendJson, readJson, isDemo, limiter, demoLimiter, ipLimiter, clientIp, readSiteImpl = readSite }) {
  return async (req, res, url, c) => {
    const p = url.pathname, m = req.method;
    if (p.startsWith('/api/looks/') && p.endsWith('/spec') && m === 'GET') {
      // a look's paint: public once worn (sign-in, the link card, a certificate); a draft only for its own company
      const n = Number(p.split('/')[3]?.replace(/^look-/, ''));
      const r = Number.isInteger(n) && db.prepare('SELECT * FROM looks WHERE id = ?').get(n);
      if (!r) fail(404, 'Not found.');
      const mine = c.user && (c.user.role === 'superadmin' || Number(c.company) === r.company_id);
      if (!mine && !(r.status === 'saved' && inUse(db, r.id))) fail(404, 'Not found.');
      const pl = lookPayload(db, lookId(r.id));
      if (!pl) fail(404, 'Not found.');
      return sendJson(res, 200, pl);
    }
    if (p !== '/api/your-look' && !p.startsWith('/api/your-look/')) return false;
    if (!c.user) fail(401, 'Sign in first.');
    const u = c.user;
    const co = c.company ? companyRow(db, c.company) : null;
    const access = accessFor(u, co);
    if (access === 'none') fail(403, 'Your Look is for owners.');
    const demo = !!co?.demo || isDemo(co?.id);
    const st = c.storeRow;
    const parts = p.split('/').filter(Boolean); // api your-look …
    const canWrite = () => { if (access === 'upgrade') fail(403, `Your Look comes with ${PLANS['custom-brand'].name}.`); };
    const log = (action, detail) => audit(db, u.id, 'your look: ' + action, detail, co.id);

    if (p === '/api/your-look' && m === 'GET') {
      const stores = storesOf(db, co.id).map((s) => { const w = lookOfStore(co, s); return { id: s.id, name: s.name, look: w, lookName: nameOf(db, co, w), kind: w === 'mise' ? 'mise' : isDataLook(w) ? 'data' : 'custom', own: !!s.look }; });
      const last = db.prepare('SELECT * FROM look_changes WHERE company_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1').get(co.id);
      const draft = db.prepare('SELECT * FROM looks WHERE company_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(co.id);
      const reading = db.prepare("SELECT id FROM look_reads WHERE company_id = ? AND status = 'reading' ORDER BY id DESC LIMIT 1").get(co.id);
      const lastBefore = last && J(last.before, {});
      return sendJson(res, 200, {
        access, demo, plan: PLANS[co.plan] ? co.plan : DEFAULT_PLAN, company: co.name, link: !co.demo && !co.internal && co.slug ? '/' + co.slug : null, store: st ? { id: st.id, name: st.name } : null, canGroup: groupAllowed(u) && stores.length > 1,
        stores, current: st ? stores.find((s) => s.id === st.id) || null : null, companyLook: { id: lookOf(co), name: nameOf(db, co, lookOf(co)) },
        lastChange: last ? { id: last.id, scope: last.scope, at: last.at, look: last.look_id ? lookId(last.look_id) : null, lookName: last.look_id ? nameOf(db, co, lookId(last.look_id)) : null,
          storeNames: Object.entries(J(last.after, {}).stores || {}).filter(([id, v]) => lastBefore?.stores?.[id] !== v).map(([id]) => stores.find((s) => s.id === Number(id))?.name).filter(Boolean),
          before: lastBefore && st ? nameOf(db, co, lookOfStore({ ...co, brand: lastBefore.company }, { ...st, look: lastBefore.stores?.[st.id] ?? null })) : null,
          beforeLook: lastBefore && st ? lookOfStore({ ...co, brand: lastBefore.company }, { ...st, look: lastBefore.stores?.[st.id] ?? null }) : null } : null,
        draft: draft ? { id: lookId(draft.id), name: draft.name, status: draft.status, source: draft.source_url, updatedAt: draft.updated_at } : null,
        reading: reading ? reading.id : null, aiOn: !!process.env.ANTHROPIC_API_KEY && process.env.LOOK_AI !== 'off',
      });
    }

    // 1–2 · Paste, Read: the read runs on; the app asks how it's going
    if (p === '/api/your-look/read' && m === 'POST') {
      canWrite();
      const b = await readJson(req, 4000);
      const scope = b.scope === 'group' && groupAllowed(u) ? 'group' : 'store';
      const raw = String(b.url || '').trim().slice(0, 300);
      if (!raw) fail(400, 'Paste your website’s address first.');
      try { (await import('./lookreader.mjs')).checkUrl(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { fail(400, e.message); }
      if (db.prepare("SELECT 1 FROM look_reads WHERE company_id = ? AND status = 'reading'").get(co.id)) fail(409, 'A website is being read already. Wait for it, or cancel it.');
      const ip = clientIp(req);
      if (ipLimiter && !ipLimiter.check(ip)) fail(429, 'That’s a lot of websites from here. Try again in an hour.');
      const lim = demo ? demoLimiter : limiter;
      if (lim && !lim.check('co' + co.id)) fail(429, demo ? 'The demo reads 5 websites. Start a new demo to read more.' : 'That’s 10 reads today for this company. Try again tomorrow, or set it up by hand.');
      const steps = STEPS.map(() => ({ state: 'wait', detail: '' }));
      const r = db.prepare("INSERT INTO look_reads(company_id, store_id, url, scope, status, steps, created_by, created_at, updated_at) VALUES (?,?,?,?, 'reading', ?,?,?,?)")
        .run(co.id, st?.id ?? null, raw, scope, JSON.stringify(steps), u.id, now(), now());
      const id = Number(r.lastInsertRowid);
      const ac = new AbortController(); running.set(id, ac);
      log('read website', raw + (demo ? ' (demo)' : ''));
      const save = (fields) => db.prepare(`UPDATE look_reads SET ${Object.keys(fields).map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), now(), id);
      (async () => {
        try {
          const found = await readSiteImpl(raw, { signal: ac.signal, step: (i, state, detail) => { steps[i] = { state, detail }; save({ steps: JSON.stringify(steps) }); } });
          save({ found: JSON.stringify({ host: found.host, logos: found.logos.length, colors: found.colors.slice(0, 8).map((x) => x.hex), fonts: found.fonts.found, photos: found.photos.length }) });
          const made = await lookFromRead(found, co.id, { signal: ac.signal });
          if (ac.signal.aborted) throw new ReadError('Stopped.', 'cancel');
          const lr = db.prepare('INSERT INTO looks(company_id, name, spec, extra, source_url, status, demo, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(co.id, made.spec.name, JSON.stringify(made.spec), JSON.stringify(made.extra), found.url, 'draft', demo ? 1 : 0, u.id, now(), now());
          save({ status: 'done', look_id: Number(lr.lastInsertRowid), by_ai: made.byAi ? 1 : 0 });
        } catch (e) {
          const cancelled = ac.signal.aborted;
          save({ status: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Stopped.' : e instanceof ReadError ? e.message : 'Something went wrong reading that site. Try again, or set it up by hand.' });
          if (!(e instanceof ReadError)) console.error('your look read', e);
        } finally { running.delete(id); }
      })();
      return sendJson(res, 200, { id, scope });
    }
    if (parts[2] === 'read' && parts[3]) {
      const r = db.prepare('SELECT * FROM look_reads WHERE id = ? AND company_id = ?').get(Number(parts[3]), co.id);
      if (!r) fail(404, 'That read isn’t here.');
      if (!parts[4] && m === 'GET') {
        const look = r.look_id ? db.prepare('SELECT * FROM looks WHERE id = ?').get(r.look_id) : null;
        return sendJson(res, 200, { id: r.id, url: r.url, scope: r.scope, status: r.status, steps: J(r.steps, []), found: J(r.found), error: r.error, byAi: !!r.by_ai, look: look ? lookOut(db, look) : null });
      }
      if (parts[4] === 'cancel' && m === 'POST') {
        running.get(r.id)?.abort();
        if (r.status === 'reading') db.prepare("UPDATE look_reads SET status = 'cancelled', error = 'Stopped.', updated_at = ? WHERE id = ?").run(now(), r.id);
        log('cancel read', r.url);
        return sendJson(res, 200, { ok: true });
      }
      fail(404, 'Not found.');
    }

    // Set it up by hand: a look from a blank start
    if (p === '/api/your-look/blank' && m === 'POST') {
      canWrite();
      const n = db.prepare('SELECT COUNT(*) n FROM looks WHERE company_id = ?').get(co.id).n;
      if (n >= 40) fail(400, 'That’s 40 looks for this company. Ask the Mise team to tidy them up.');
      const spec = blankSpec(st?.name || co.name);
      const fixed = fixColors(spec.colors);
      const r = db.prepare('INSERT INTO looks(company_id, name, spec, extra, status, demo, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(co.id, spec.name, JSON.stringify(spec), JSON.stringify({ fixes: [], checked: fixed.checked, passedAsFound: fixed.passedAsFound }), 'draft', demo ? 1 : 0, u.id, now(), now());
      log('start by hand', spec.name);
      return sendJson(res, 200, lookOut(db, db.prepare('SELECT * FROM looks WHERE id = ?').get(r.lastInsertRowid)));
    }

    if (parts[2] === 'looks' && parts[3]) {
      const n = Number(String(parts[3]).replace(/^look-/, ''));
      const r = db.prepare('SELECT * FROM looks WHERE id = ? AND company_id = ?').get(n, co.id);
      if (!r) fail(404, 'That look isn’t here.');
      const rest = parts.slice(4).join('/');
      if (!rest && m === 'GET') return sendJson(res, 200, lookOut(db, r));
      canWrite();
      // 4 · Adjust: the owner's changes, checked: colours are re-checked and fixed again, files must be this look's own
      if (!rest && m === 'PATCH') {
        const b = await readJson(req, 40_000);
        const cur = J(r.spec, {}), extra = J(r.extra, {});
        const next = { ...cur, colors: { ...cur.colors }, fonts: { ...cur.fonts }, logo: { ...cur.logo } };
        if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 60) || cur.name;
        const changed = [];
        if (b.colors && typeof b.colors === 'object') for (const k of COLOR_KEYS) if (b.colors[k] !== undefined) {
          const h = normHex(String(b.colors[k])); if (!h) fail(400, 'Colours are hex codes, like #860028.');
          if (h !== next.colors[k]) changed.push(k);
          next.colors[k] = h;
        }
        if (b.fonts && typeof b.fonts === 'object') {
          for (const k of ['heading', 'accent', 'body']) if (b.fonts[k] !== undefined) {
            const f = String(b.fonts[k]).trim();
            if (!FONT_NAME.test(f)) fail(400, 'Pick a font from the list.');
            next.fonts[k] = f;
            if (next.fonts.standIn?.[k] && f !== cur.fonts[k]) next.fonts.standIn = { ...next.fonts.standIn, [k]: undefined };
          }
          if (b.fonts.headingCase === 'upper' || b.fonts.headingCase === 'title') next.fonts.headingCase = b.fonts.headingCase;
          else if (b.fonts.heading !== undefined) next.fonts.headingCase = UPPER_FACES.has(next.fonts.heading) ? 'upper' : 'title';
          next.fonts.standIn = Object.fromEntries(Object.entries(next.fonts.standIn || {}).filter(([, v]) => v));
        }
        const owned = new Set([...(extra.logos || []).map((l) => l.src), ...(extra.photos || []).map((x) => x.src), extra.icon].filter(Boolean));
        for (const v of ['dark', 'light']) if (b.logo && b.logo[v] !== undefined) {
          if (b.logo[v] === null) { delete next.logo[v]; continue; }
          const opt = (extra.logos || []).find((l) => l.src === b.logo[v]);
          if (!opt) fail(400, 'Pick one of the logos found, or upload one.');
          next.logo[v] = { src: opt.src, w: opt.w, h: opt.h, crop: opt.crop };
        }
        if (b.photo !== undefined) { if (b.photo === null) delete next.photo; else if (owned.has(b.photo)) next.photo = b.photo; else fail(400, 'Pick one of the photos, or upload one.'); }
        if (b.icon !== undefined) { if (b.icon === null) delete next.icon; else if (owned.has(b.icon)) next.icon = b.icon; else fail(400, 'Pick one of the icons found, or upload one.'); }
        // contrast: a colour the owner picked that fails is fixed and flagged (the shade changes, never the hue)
        const fixed = fixColors(next.colors, { logo: [], named: [], other: [] });
        next.colors = fixed.colors;
        if (!validSpec(next)) fail(400, 'That look isn’t complete.');
        const fixes = changed.length ? fixed.fixes : extra.fixes || [];
        db.prepare('UPDATE looks SET name = ?, spec = ?, extra = ?, updated_at = ? WHERE id = ?').run(next.name, JSON.stringify(next), JSON.stringify({ ...extra, fixes, lastFixes: fixed.fixes }), now(), r.id);
        return sendJson(res, 200, { ...lookOut(db, db.prepare('SELECT * FROM looks WHERE id = ?').get(r.id)), justFixed: fixed.fixes.filter((f) => changed.includes(f.id) || changed.includes(PAIR_FG[f.id])) });
      }
      // Upload a logo (for dark or light backgrounds), the icon, or a photo. Used as they are; SVG is drawn to PNG.
      if ((rest === 'logo' || rest === 'photo' || rest === 'icon') && m === 'POST') {
        const variant = url.searchParams.get('variant') === 'light' ? 'light' : 'dark';
        const max = rest === 'photo' ? 12e6 : 4e6;
        if (Number(req.headers['content-length'] || 0) > max) fail(413, `That file is over ${max / 1e6} MB.`);
        const chunks = []; let size = 0;
        for await (const ch of req) { size += ch.length; if (size > max) fail(413, `That file is over ${max / 1e6} MB.`); chunks.push(ch); }
        const buf = Buffer.concat(chunks);
        const extra = J(r.extra, {}), spec = J(r.spec, {});
        let a;
        try { a = await analyzeImage(buf); } catch { fail(415, 'We couldn’t open that file. Use a PNG, JPG, WebP or SVG.'); }
        if (rest === 'photo') {
          if (a.width < 600 || a.height < 400) fail(400, 'That photo is small. Use one at least 1200 px wide.');
          const sharp = (await import('sharp')).default;
          const out = await sharp(buf, { limitInputPixels: 60e6 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
          const src = saveFile(co.id, out.data, 'jpg');
          extra.photos = [{ src, w: out.info.width, h: out.info.height, from: 'upload' }, ...(extra.photos || []).filter((x) => x.src !== src)];
          spec.photo = src;
        } else {
          const ext = a.png ? 'png' : a.format === 'jpeg' ? 'jpg' : a.format === 'webp' ? 'webp' : 'png';
          const src = saveFile(co.id, a.png || buf, ext);
          if (rest === 'icon') { extra.icon = src; spec.icon = src; }
          else {
            const L = { src, w: a.width, h: a.height, crop: a.crop, variant, from: 'upload' };
            extra.logos = [L, ...(extra.logos || []).filter((x) => x.src !== src)];
            spec.logo = { ...(spec.logo || {}), [variant]: { src, w: a.width, h: a.height, crop: a.crop } };
          }
        }
        if (!validSpec(spec)) fail(400, 'That look isn’t complete.');
        db.prepare('UPDATE looks SET spec = ?, extra = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(spec), JSON.stringify(extra), now(), r.id);
        log('upload ' + rest, r.name);
        return sendJson(res, 200, lookOut(db, db.prepare('SELECT * FROM looks WHERE id = ?').get(r.id)));
      }
      // The link card as the Adjust screen draws it (1200 × 630 JPEG, in the look's own fonts): used when the look goes on
      // the whole group, so the card people get is the one the owner saw
      if (rest === 'card' && m === 'POST') {
        if (Number(req.headers['content-length'] || 0) > 2e6) fail(413, 'That card is too big.');
        const chunks = []; let size = 0;
        for await (const ch of req) { size += ch.length; if (size > 2e6) fail(413, 'That card is too big.'); chunks.push(ch); }
        const sharp = (await import('sharp')).default;
        let out;
        try {
          const mt = await sharp(Buffer.concat(chunks), { limitInputPixels: 2e6 }).metadata();
          if (mt.width !== 1200 || mt.height !== 630) fail(400, 'A link card is 1200 × 630.');
          out = await sharp(Buffer.concat(chunks)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
        } catch (e) { if (e.status) throw e; fail(415, 'That card isn’t an image we can open.'); }
        const src = saveFile(co.id, out, 'jpg');
        const extra = J(r.extra, {});
        db.prepare('UPDATE looks SET extra = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...extra, cardUpload: src }), now(), r.id);
        return sendJson(res, 200, { ok: true, card: src });
      }
      // 5 · Apply: this store, or every store in the group (and the company's own look, so new stores wear it too)
      if (rest === 'apply' && m === 'POST') {
        const b = await readJson(req, 2000);
        const scope = b.scope === 'group' ? 'group' : 'store';
        if (scope === 'group' && !groupAllowed(u)) fail(403, 'Only an owner can change every store’s look.');
        if (scope === 'store' && !st) fail(400, 'Pick a store first.');
        const spec = J(r.spec, {});
        if (!validSpec(spec)) fail(400, 'That look isn’t complete.');
        if (checkPairs(spec.colors).some((x) => !x.pass)) fail(400, 'Some colours don’t pass the contrast check yet.');
        const before = wearing(db, co);
        const id = lookId(r.id);
        db.exec('BEGIN');
        try {
          if (scope === 'store') db.prepare('UPDATE stores SET look = ? WHERE id = ? AND company_id = ?').run(id, st.id, co.id);
          else {
            db.prepare('UPDATE stores SET look = ? WHERE company_id = ? AND deleted_at IS NULL').run(id, co.id);
            // a demo copy keeps its company look (it decides which demo it is, server/demo.mjs); its stores wear the new one
            if (!co.demo) db.prepare('UPDATE companies SET brand = ? WHERE id = ?').run(id, co.id);
          }
          db.prepare("UPDATE looks SET status = 'saved', updated_at = ? WHERE id = ?").run(now(), r.id);
          db.prepare('INSERT INTO look_changes(company_id, look_id, scope, before, after, by_user, at) VALUES (?,?,?,?,?,?,?)')
            .run(co.id, r.id, scope, JSON.stringify(before), JSON.stringify(wearing(db, companyRow(db, co.id))), u.id, now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        if (scope === 'group' && !co.demo) await makeShareCard(db, r.id).catch((e) => console.error('look card', e));
        log('apply', `${r.name} → ${scope === 'group' ? 'every store' : st.name}`);
        return sendJson(res, 200, { ok: true, scope, look: id });
      }
      fail(404, 'Not found.');
    }

    // Undo: the last Apply comes off; the look stays saved, so it can go back on
    if (p === '/api/your-look/undo' && m === 'POST') {
      canWrite();
      const last = db.prepare('SELECT * FROM look_changes WHERE company_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1').get(co.id);
      if (!last) fail(400, 'There’s nothing to undo.');
      const before = J(last.before, {}), after = J(last.after, {});
      if (last.scope === 'group' && !groupAllowed(u)) fail(403, 'Only an owner can undo a change to every store.');
      if (last.scope === 'store' && u.role === 'manager' && u.store_id && !Object.keys(after.stores || {}).every((sid) => Number(sid) === u.store_id || before.stores?.[sid] === after.stores?.[sid])) fail(403, 'That change was to another store.');
      db.exec('BEGIN');
      try {
        // only what that change changed goes back (a store changed since then keeps its newer look)
        const nowWearing = wearing(db, co);
        for (const [sid, look] of Object.entries(before.stores || {})) if (after.stores?.[sid] !== look && nowWearing.stores[sid] === after.stores?.[sid]) db.prepare('UPDATE stores SET look = ? WHERE id = ? AND company_id = ?').run(look, Number(sid), co.id);
        if (before.company !== after.company && nowWearing.company === after.company) db.prepare('UPDATE companies SET brand = ? WHERE id = ?').run(before.company, co.id);
        db.prepare('UPDATE look_changes SET undone_at = ?, undone_by = ? WHERE id = ?').run(now(), u.id, last.id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      log('undo', `${nameOf(db, co, lookId(last.look_id))} off ${last.scope === 'group' ? 'every store' : 'one store'}`);
      return sendJson(res, 200, { ok: true });
    }
    fail(404, 'Not found.');
  };
}
const PAIR_FG = { ink: 'ink', muted: 'muted', accentLight: 'accentLight', label: 'label', accentDark: 'accentDark', onPanel: 'panel', onAccentLight: 'accentLight', onAccentDark: 'accentDark' };

/** The company's look files go with it (wipeCompany, data delete and demo drop). */
export function dropLookFiles(companyId) { fs.rmSync(path.join(LOOK_DIR, String(Number(companyId))), { recursive: true, force: true }); }

/* ── The link card (1200 × 630) for a company wearing a look made here ───────────────────────────────────────────── */
/** Made when the look goes on the whole group: the look's dark panel, its logo for dark backgrounds (its artwork box, at
 *  uniform scale: never recoloured or redrawn), the accent rule, and its photo fading in from the right. The words are in
 *  the preview's title and description (no text is drawn into the image: the server has no brand fonts). */
export async function makeShareCard(db, n) {
  const r = db.prepare('SELECT * FROM looks WHERE id = ?').get(n);
  const spec = r && J(r.spec);
  if (!spec || !validSpec(spec)) return null;
  const extra0 = J(r.extra, {});
  if (extra0.cardUpload && LOOK_FILE.test(extra0.cardUpload) && fs.existsSync(path.join(LOOK_DIR, extra0.cardUpload.split('/')[2], extra0.cardUpload.split('/')[3]))) {
    db.prepare('UPDATE looks SET extra = ? WHERE id = ?').run(JSON.stringify({ ...extra0, card: extra0.cardUpload }), r.id);
    return extra0.cardUpload;
  }
  const sharp = (await import('sharp')).default;
  const W = 1200, H = 630, c = spec.colors;
  const layers = [];
  const fileOf = (src) => path.join(LOOK_DIR, src.split('/')[2], src.split('/')[3]);
  if (spec.photo && fs.existsSync(fileOf(spec.photo))) {
    const ph = await sharp(fileOf(spec.photo)).resize(720, H, { fit: 'cover' }).toBuffer();
    layers.push({ input: ph, left: W - 720, top: 0 });
    const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${H}"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${c.panel}"/><stop offset="0.45" stop-color="${c.panel}" stop-opacity="0.55"/><stop offset="1" stop-color="${c.panel}" stop-opacity="0"/></linearGradient></defs><rect width="720" height="${H}" fill="url(#g)"/></svg>`);
    layers.push({ input: fade, left: W - 720, top: 0 });
  }
  const L = spec.logo.dark || spec.logo.light;
  if (L && fs.existsSync(fileOf(L.src))) {
    const [x, y, w, h] = L.crop;
    const k = Math.min(420 / w, 170 / h);
    const art = await sharp(fileOf(L.src)).extract({ left: Math.round(x), top: Math.round(y), width: Math.round(w), height: Math.round(h) }).resize(Math.round(w * k), Math.round(h * k)).png().toBuffer();
    layers.push({ input: art, left: 80, top: Math.round(H / 2 - (h * k) / 2 - 30) });
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="4"><rect width="72" height="4" fill="${c.accentDark}"/></svg>`), left: 80, top: Math.round(H / 2 + (h * k) / 2) });
  }
  const jpg = await sharp({ create: { width: W, height: H, channels: 3, background: c.panel } }).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  const src = saveFile(r.company_id, jpg, 'jpg');
  const extra = J(r.extra, {});
  db.prepare('UPDATE looks SET extra = ? WHERE id = ?').run(JSON.stringify({ ...extra, card: src }), r.id);
  return src;
}
const LINE = 'The menu, the bar, wine and service, all in one place.';
/** The link card for a company wearing a look made here (server/links.mjs shareFor), or null. */
export function dataShareFor(db, co) {
  const n = numId(lookOf(co));
  const r = n && db.prepare('SELECT * FROM looks WHERE id = ?').get(n);
  if (!r) return null;
  const card = J(r.extra, {}).card;
  if (!card || !LOOK_FILE.test(card)) return null;
  return { title: `${r.name} · The Training App`, description: `${LINE} Training on Mise Academy.`, image: card, alt: `${r.name}: the training app` };
}
