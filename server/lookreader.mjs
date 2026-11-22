// Reads a restaurant's website for "Your Look" (Nov 22; Figma 09 · Idea Board → 44: paste 878:1393, reading 878:1570).
// "We open your home page and up to two linked pages (menu, about) and read what the browser sees: the logo in your header,
// your site icon and link-preview image, the colours in your styles, your fonts, and a few photos."
//
// Everything here is deterministic: no AI is needed to read a site (server/yourlook.mjs may ask Claude to choose roles
// first, when the API key works; it falls back to these rules). Nothing on the website changes; we only GET.
//
// Safety (the address comes from a customer, so it's treated as hostile):
//   • only http(s), default ports, no user:password@; every address it resolves to must be public (no localhost, private
//     ranges, link-local, metadata 169.254.169.254, CGNAT, multicast, IPv6 ULA/link-local, v4-mapped private), and the
//     connection is pinned to the address that was checked (so a DNS answer can't change between check and connect);
//   • redirects followed by hand, at most 3, each one checked again;
//   • a time limit per request and for the whole read, a size cap per file (counted after decompression) and in total;
//   • only HTML, CSS, JSON and images are kept; SVG is never stored or served, it's drawn to PNG first.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { normHex, NOISE, IGNORED_FONTS, PAID, SYSTEM, UPPER_FACES, standInByKind } from '../src/lib/lookspec.ts';

export const LIMITS = { html: 3e6, css: 2e6, cssTotal: 6e6, cssFiles: 24, image: 6e6, json: 1e6, perRequestMs: 10e3, totalMs: 60e3, redirects: 3, pages: 3, logoFiles: 8, photoFiles: 10 };
const UA = 'Mozilla/5.0 (compatible; MiseAcademy-LookReader/1.0; +https://www.miseacademy.app/help)';

export class ReadError extends Error { constructor(message, code = 'read') { super(message); this.code = code; } }

/* ── Which addresses are public ───────────────────────────────────────────────────────────────────────────────────── */
const BLOCKED = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64], ['2001::', 32], ['2002::', 16]]) BLOCKED.addSubnet(a, p, 'ipv6');
/** True for any address that isn't on the public internet. */
export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (!v) return true;
  if (v === 4) return BLOCKED.check(ip, 'ipv4');
  const low = ip.toLowerCase();
  // IPv4 inside IPv6 (::ffff:10.0.0.1, ::ffff:a00:1, 64:ff9b::10.0.0.1): judged as the IPv4 address
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(low)?.[1];
  if (mapped) return isPrivateIp(mapped);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low);
  if (hexMapped) { const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16); return isPrivateIp([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
  return BLOCKED.check(ip, 'ipv6');
}

/** The checked form of an address: http(s), no credentials, default port, a real host name or a public IP. */
export function checkUrl(raw, base) {
  let u;
  try { u = new URL(String(raw).trim(), base); } catch { throw new ReadError('That doesn’t look like a web address.', 'url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ReadError('Only http and https web addresses can be read.', 'url');
  if (u.username || u.password) throw new ReadError('That address has a sign-in in it; paste the plain web address.', 'url');
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) throw new ReadError('That address uses an unusual port, so it can’t be read.', 'url');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) throw new ReadError('That address isn’t on the public internet.', 'private');
  if (net.isIP(host) && isPrivateIp(host)) throw new ReadError('That address isn’t on the public internet.', 'private');
  if (!net.isIP(host) && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new ReadError('That doesn’t look like a web address.', 'url');
  return u;
}
/** The public address a host name points at (every answer must be public: one private answer blocks the host). */
async function resolvePublic(host, { allowPrivate = false } = {}) {
  if (net.isIP(host)) { if (!allowPrivate && isPrivateIp(host)) throw new ReadError('That address isn’t on the public internet.', 'private'); return { address: host, family: net.isIP(host) }; }
  let all;
  try { all = await dns.promises.lookup(host, { all: true, verbatim: true }); } catch { throw new ReadError(`We couldn’t find ${host}. Check the address.`, 'dns'); }
  if (!all.length) throw new ReadError(`We couldn’t find ${host}. Check the address.`, 'dns');
  if (!allowPrivate && all.some((a) => isPrivateIp(a.address))) throw new ReadError('That address isn’t on the public internet.', 'private');
  return all[0];
}

/**
 * GET one address, safely. → { url (after redirects), status, type, body: Buffer }.
 * `kinds`: content types to accept ('html', 'css', 'json', 'image'). `_allow` is for the test suite only: the one local
 * test server); nothing in the app sets it.
 */
export async function safeFetch(raw, { maxBytes = LIMITS.html, timeoutMs = LIMITS.perRequestMs, kinds = ['html'], signal, _allow = null, base } = {}) {
  // (test only) `_allow`: 'host:port' of a local test server, let through as if it were public; every other address is checked
  const allowed = (u) => !!_allow && u.host === _allow && u.protocol === 'http:';
  const check = (r, b) => { const u = new URL(String(r).trim(), b); return allowed(u) ? u : checkUrl(r, b); };
  let url = check(raw, base);
  const deadline = AbortSignal.timeout(timeoutMs);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    if (stop.aborted) throw new ReadError(signal?.aborted ? 'Stopped.' : 'That site took too long to answer.', signal?.aborted ? 'cancel' : 'timeout');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addr = await resolvePublic(host, { allowPrivate: allowed(url) });
    const res = await new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(url, {
        method: 'GET', signal: stop, timeout: timeoutMs,
        // pinned: the socket goes to the address that was just checked, whatever DNS says next
        lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)),
        headers: { 'User-Agent': UA, Accept: kinds.includes('image') ? 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8' : kinds.includes('css') ? 'text/css,*/*;q=0.1' : kinds.includes('json') ? 'application/json' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en-US,en;q=0.8' },
      }, resolve);
      req.on('timeout', () => req.destroy(new ReadError('That site took too long to answer.', 'timeout')));
      req.on('error', reject);
      req.end();
    }).catch((e) => { throw e instanceof ReadError ? e : new ReadError(stop.aborted ? (signal?.aborted ? 'Stopped.' : 'That site took too long to answer.') : `We couldn’t open ${host}.`, stop.aborted ? (signal?.aborted ? 'cancel' : 'timeout') : 'connect'); });
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      if (hop === LIMITS.redirects) throw new ReadError('That address redirects too many times.', 'redirects');
      url = check(res.headers.location, url);
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); throw new ReadError(`${host} answered ${res.statusCode}.`, 'status'); }
    const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!typeOk(type, kinds, url.pathname)) { res.resume(); throw new ReadError(`${host} sent ${type || 'something'} where we expected ${kinds.join(' or ')}.`, 'type'); }
    if (Number(res.headers['content-length'] || 0) > maxBytes) { res.resume(); throw new ReadError('That file is too big to read.', 'size'); }
    const enc = String(res.headers['content-encoding'] || '').toLowerCase();
    const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
    const chunks = []; let size = 0;
    try {
      for await (const ch of stream) {
        size += ch.length;
        if (size > maxBytes) { res.destroy(); throw new ReadError('That file is too big to read.', 'size'); }
        chunks.push(ch);
      }
    } catch (e) { throw e instanceof ReadError ? e : new ReadError(stop.aborted ? 'That site took too long to answer.' : `We couldn’t read ${host}.`, stop.aborted ? 'timeout' : 'read'); }
    return { url: url.href, status: res.statusCode, type, body: Buffer.concat(chunks) };
  }
  throw new ReadError('That address redirects too many times.', 'redirects');
}
function typeOk(type, kinds, pathname) {
  if (kinds.includes('html') && /^(text\/html|application\/xhtml\+xml)$/.test(type)) return true;
  if (kinds.includes('css') && (type === 'text/css' || (type === 'text/plain' && /\.css$/i.test(pathname)) || (!type && /\.css$/i.test(pathname)))) return true;
  if (kinds.includes('json') && /^application\/(json|.*\+json)$/.test(type)) return true;
  if (kinds.includes('image') && (/^image\//.test(type) || (type === 'application/octet-stream' && /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(pathname)))) return true;
  return false;
}

/* ── Reading the page ─────────────────────────────────────────────────────────────────────────────────────────────── */
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/gi, '/');
/** The attributes of one tag (lower-case names). */
export function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (k === tag.slice(1).split(/[\s/>]/)[0].toLowerCase()) continue;
    if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => ({ tag: m[0], at: m.index, a: attrs(m[0]) }));
/** Everything a page says about its look. */
export function parsePage(html, pageUrl) {
  const baseHref = tags(html, 'base')[0]?.a.href;
  const base = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
  const abs = (u) => { try { return u ? new URL(u.trim(), base).href : null; } catch { return null; } };
  const metas = tags(html, 'meta');
  const meta = (k) => metas.find((m) => (m.a.property || m.a.name || '').toLowerCase() === k)?.a.content || null;
  const links = tags(html, 'link');
  const rel = (l) => (l.a.rel || '').toLowerCase().split(/\s+/);
  // where the header is: <header>…</header>, or a page builder's header block
  const hStart = html.search(/<header\b|elementor-location-header|class="[^"]*\bsite-header\b/i);
  const hEnd = hStart >= 0 ? html.indexOf('</header>', hStart) : -1;
  const inHeader = (at) => hStart >= 0 && at >= hStart && at <= (hEnd > 0 ? hEnd : hStart + 40000);
  const imgs = tags(html, 'img').map((t, i) => {
    const srcset = t.a.srcset || t.a['data-srcset'] || '';
    const widest = srcset.split(',').map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u: abs(u), w: parseInt(w) || 0 })).filter((x) => x.u).sort((a, b) => b.w - a.w)[0];
    const set = srcset.split(',').map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u: abs(u), w: parseInt(w) || 0 })).filter((x) => x.u && x.w);
    const fit = set.filter((x) => x.w >= 1200).sort((a, b) => a.w - b.w)[0]; // a photo: the smallest size that's still big
    return { src: abs(t.a['data-src'] || t.a['data-lazy-src'] || t.a['data-orig-file'] || t.a.src), widest: widest?.u || null, widestW: widest?.w || 0, photoSrc: fit?.u || null,
      alt: t.a.alt || '', cls: `${t.a.class || ''} ${t.a.id || ''}`, w: parseInt(t.a.width) || 0, h: parseInt(t.a.height) || 0, header: inHeader(t.at), order: i };
  }).filter((x) => x.src && !x.src.startsWith('data:'));
  // logos drawn inline as SVG (drawn to PNG later; never stored as SVG)
  const svgs = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)].map((m) => ({ svg: m[0], at: m.index, a: attrs(m[0].slice(0, m[0].indexOf('>') + 1)) }))
    .filter((s) => /logo|brand/i.test(`${s.a.class || ''} ${s.a.id || ''} ${s.a['aria-label'] || ''}`) && s.svg.length < 200e3)
    .map((s) => ({ svg: s.svg, header: inHeader(s.at), label: s.a['aria-label'] || '' }));
  const icons = links.filter((l) => rel(l).some((r) => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'].includes(r)) && l.a.href)
    .map((l) => ({ href: abs(l.a.href), sizes: parseInt((l.a.sizes || '').split('x')[0]) || (rel(l).includes('apple-touch-icon') ? 180 : 32), touch: rel(l).some((r) => r.startsWith('apple-touch')) }))
    .filter((x) => x.href && !/\.svg(\?|$)/i.test(x.href)).sort((a, b) => b.sizes - a.sizes);
  const sheets = links.filter((l) => rel(l).includes('stylesheet') && l.a.href).map((l) => abs(l.a.href)).filter(Boolean);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const inline = [...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => decode(m[2] ?? m[3] ?? '')).join(';\n');
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]{0,200}?)<\/a>/gi)].map((m) => ({ href: abs(attrs('<a ' + m[1] + '>').href), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })).filter((a) => a.href);
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
  return {
    url: pageUrl, title, siteName: meta('og:site_name'), themeColor: meta('theme-color'), ogImage: abs(meta('og:image') || meta('og:image:secure_url') || meta('twitter:image')),
    imgs, svgs, icons, sheets, styles, inline, anchors, wordpress: /\/wp-content\//.test(html),
    typekit: /use\.typekit\.net|p\.typekit\.net/.test(html), googleFontLinks: links.filter((l) => /fonts\.googleapis\.com/.test(l.a.href || '')).map((l) => l.a.href),
  };
}
/** Up to two more pages worth reading: the menu, then about or story. Same site only. */
export function linkedPages(page, siteHost) {
  const same = (h) => { try { const u = new URL(h); return u.hostname.replace(/^www\./, '') === siteHost && /^https?:$/.test(u.protocol); } catch { return false; } };
  const out = [];
  for (const re of [/\bmenus?\b/i, /\babout\b|\bour story\b|\bstory\b/i]) {
    const a = page.anchors.find((x) => same(x.href) && (re.test(x.text) || re.test(new URL(x.href).pathname.replace(/[-_/]/g, ' '))) && !/\.(pdf|jpe?g|png)$/i.test(x.href) && !out.includes(x.href.split('#')[0]) && x.href.split('#')[0] !== page.url.split('#')[0]);
    if (a) out.push(a.href.split('#')[0]);
  }
  return out.slice(0, LIMITS.pages - 1);
}

/* ── Colours and fonts in the styles ──────────────────────────────────────────────────────────────────────────────── */
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;
const HEX = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
/** Every solid colour in some CSS, with how often it's used. Custom properties (Elementor's kit, --brand-…) count more. */
export function cssColors(css, weight = 1, into = new Map()) {
  const add = (h, w, from) => { if (!h) return; const e = into.get(h) || { hex: h, weight: 0, from: [] }; e.weight += w; if (!e.from.includes(from)) e.from.push(from); into.set(h, e); };
  // declared colours: custom properties first (a brand's palette), the rest by use
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const name = m[1].toLowerCase(), v = m[2];
    if (/^--wp--preset|^--sc-|^--swiper|^--bs-|^--tw-|^--e-a-|^--wpforms|^--jp-|^--woocommerce/.test(name)) continue;
    const bonus = /primary|secondary|accent|brand|text|background|global-color/.test(name) ? 6 : 3;
    for (const h of colorsIn(v)) add(h, weight * bonus, 'var');
  }
  // plain uses: how many times, softened (one colour repeated 400 times in a page builder's per-widget rules isn't 400
  // times as much the brand's colour as one used 20 times)
  const plain = css.replace(/--[\w-]+\s*:[^;}]+/g, '');
  const n = new Map();
  for (const h of colorsIn(plain)) n.set(h, (n.get(h) || 0) + 1);
  for (const [h, k] of n) add(h, weight * Math.sqrt(k) * 2, weight > 1 ? 'page' : 'css');
  return into;
}
function colorsIn(s) {
  const out = [];
  for (const m of s.matchAll(HEX)) {
    const raw = m[1];
    if (raw.length === 8 && parseInt(raw.slice(6), 16) < 128) continue; // mostly see-through
    const h = normHex('#' + (raw.length === 8 ? raw.slice(0, 6) : raw));
    if (h && !NOISE.has(h)) out.push(h);
  }
  for (const m of s.matchAll(RGB)) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 0.5) continue;
    const h = '#' + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('').toUpperCase();
    if (!NOISE.has(h)) out.push(h);
  }
  return out;
}
const firstFamily = (v, vars) => {
  let s = v.trim();
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(s);
  if (ref) s = vars.get(ref[1].toLowerCase()) || ref[2] || '';
  const first = s.split(',')[0]?.trim().replace(/!important/i, '').replace(/^['"]|['"]$/g, '').trim();
  const generic = s.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).find((x) => ['serif', 'sans-serif', 'cursive', 'monospace', 'fantasy', 'display'].includes(x)) || '';
  return first && !/^var\(/.test(first) ? { name: first, generic } : null;
};
/** The faces a site uses: what headings use, what the text uses, which are self-hosted (@font-face) and which come from
 *  Google Fonts. Weighted like colours. */
export function cssFonts(sources) {
  const vars = new Map(), faces = new Map(), declared = new Set(), google = new Set();
  for (const { css } of sources) for (const m of css.matchAll(/(--[\w-]*font-family[\w-]*)\s*:\s*([^;}]+)/gi)) if (!/^--wp--preset|^--sc-|^--wp-/.test(m[1].toLowerCase())) vars.set(m[1].toLowerCase(), m[2]);
  const uses = new Map(); // per source, per face and role: softened like colours
  const add = (f, role, w) => {
    if (!f || IGNORED_FONTS.has(f.name.toLowerCase()) || f.name.length > 40 || !/^[\w .-]+$/.test(f.name)) return;
    const e = faces.get(f.name) || { name: f.name, generic: f.generic, heading: 0, body: 0, any: 0 };
    e[role] += w; e.any += w; if (!e.generic && f.generic) e.generic = f.generic;
    faces.set(f.name, e);
  };
  for (const { css, weight } of sources) {
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) { const f = /font-family\s*:\s*([^;]+)/i.exec(m[1]); if (f) declared.add(f[1].trim().replace(/^['"]|['"]$/g, '')); }
    for (const m of css.matchAll(/@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)/gi)) for (const fam of googleFamilies(m[1])) google.add(fam);
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const sel = m[1].toLowerCase(), body = m[2];
      const fm = /font-family\s*:\s*([^;]+)/i.exec(body);
      if (!fm || /@font-face/.test(sel)) continue;
      const f = firstFamily(fm[1], vars);
      const role = /\bh[1-3]\b|heading|title|display|hero|logo/.test(sel) ? 'heading' : /\b(body|html|p)\b|text|content|paragraph/.test(sel) ? 'body' : 'any';
      if (!f) continue;
      const k = f.name + '|' + role;
      const u = uses.get(k) || { f, role, n: 0, weight }; u.n++; uses.set(k, u);
    }
    for (const u of uses.values()) add(u.f, u.role === 'any' ? 'body' : u.role, (u.role === 'any' ? 0.5 : 1) * u.weight * Math.sqrt(u.n));
    uses.clear();
    // the kit's named roles (Elementor: primary = headings, text = body)
    for (const [k, v] of vars) {
      const f = firstFamily(v, vars);
      if (/primary|heading|title|display/.test(k)) add(f, 'heading', weight * 30);
      else if (/text|body|secondary|accent/.test(k)) add(f, 'body', weight * 4);
    }
  }
  return { faces: [...faces.values()], declared, google, vars };
}
export function googleFamilies(href) {
  try { return new URL(href).searchParams.getAll('family').flatMap((f) => f.split('|')).map((f) => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean); } catch { return []; }
}

/* ── Images ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
let sharpP = null;
const getSharp = async () => (sharpP ||= import('sharp').then((m) => m.default));
/** What an image is: its size, its format, whether it's see-through, how light its artwork is, its main colours (for a
 *  logo), and the box its artwork fills (a logo file with transparent margins: theme.ts Crop). SVG is drawn to PNG. */
export async function analyzeImage(buf, { svg = false } = {}) {
  const sharp = await getSharp();
  let input = buf, png = null;
  const meta0 = await sharp(buf, { limitInputPixels: 50e6 }).metadata().catch(() => null);
  if (!meta0) throw new ReadError('Not an image we can open.', 'image');
  if (svg || meta0.format === 'svg') {
    const density = Math.min(600, Math.max(72, Math.round(72 * 600 / Math.max(1, meta0.height || 100))));
    png = await sharp(buf, { density, limitInputPixels: 50e6 }).png().toBuffer();
    input = png;
  } else if (meta0.format === 'gif' || meta0.format === 'avif' || meta0.format === 'tiff' || meta0.format === 'heif') {
    png = await sharp(buf, { limitInputPixels: 50e6 }).png().toBuffer(); input = png;
  }
  const meta = await sharp(input).metadata();
  const W = meta.width, H = meta.height;
  const { data, info } = await sharp(input).ensureAlpha().resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, lsum = 0; const hist = new Map();
  const corner = [data[0], data[1], data[2], data[3]];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    opaque++;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    lsum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = hist.get(key) || { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += r; e.g += g; e.b += b; hist.set(key, e);
  }
  const px = info.width * info.height;
  const colors = [...hist.values()].sort((a, b) => b.n - a.n).slice(0, 12).filter((e) => e.n / Math.max(1, opaque) > 0.01)
    .map((e) => ({ hex: '#' + [e.r / e.n, e.g / e.n, e.b / e.n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(), share: e.n / Math.max(1, opaque) }));
  let crop = [0, 0, W, H, W, H];
  try {
    const t = await sharp(input).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
    const x = -(t.info.trimOffsetLeft || 0), y = -(t.info.trimOffsetTop || 0);
    if (t.info.width > 0 && t.info.height > 0 && x >= 0 && y >= 0) crop = [x, y, t.info.width, t.info.height, W, H];
  } catch { /* nothing to trim */ }
  return { format: png ? 'png' : meta.format, width: W, height: H, hasAlpha: !!meta.hasAlpha, seeThrough: opaque / px < 0.9, lightness: opaque ? lsum / opaque : 0,
    cornerDark: corner[3] > 200 && (0.2126 * corner[0] + 0.7152 * corner[1] + 0.0722 * corner[2]) / 255 < 0.3, colors, crop, png };
}

/* ── Choosing the logo ────────────────────────────────────────────────────────────────────────────────────────────── */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const NOT_OURS = /burger|hamburger|close-?\d*\.|menu-?icon|[-_]icon[-_.]|award|news|network|partner|press|sponsor|badge|tripadvisor|yelp|opentable|resy|toast|doordash|grubhub|ubereats|google|facebook|instagram|tiktok|twitter|apple|visa|mastercard|cbs|nbc|abc|fox|wdiv|clickon|foodnetwork|culinary|cia-|cms-|websitedesign|designs|developer|payment|certified|michelin|zagat|bestof|hour-?detroit|magazine/i;
/** Points for "this is the restaurant's own logo": its name in the file or alt text, "logo", in the header, a wordmark
 *  shape (fits the sidebar); points off for press, award and partner logos. */
export function logoScore(c, { siteKey, nameKey }) {
  const text = `${c.src || ''} ${c.alt || ''} ${c.cls || ''}`;
  const file = norm((c.src || '').split('/').pop()?.split('?')[0]);
  const all = norm(text);
  let s = 0;
  if (siteKey && (file.includes(siteKey) || norm(c.alt).includes(siteKey))) s += 6;
  else if (nameKey && nameKey.length > 3 && all.includes(nameKey)) s += 5;
  if (/logo/i.test(text)) s += 3;
  if (/custom-logo|site-logo|brand/i.test(c.cls || '')) s += 3;
  if (c.header) s += 3;
  if (c.order !== undefined && c.order < 3) s += 1;
  if (NOT_OURS.test(text) || /restaurantgroup|group/.test(file)) s -= 8;
  return s;
}

export const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);

/* ── Fonts: Google Fonts as they are, others get a free stand-in ─────────────────────────────────────────────────── */
const googleCache = new Map();
const KNOWN_GOOGLE = new Set(['Archivo', 'Montserrat', 'Cinzel', 'Bebas Neue', 'Gilda Display', 'Playfair Display', 'Lora', 'Open Sans', 'Inter', 'Lato', 'Roboto', 'Oswald', 'Poppins', 'Raleway',
  'Josefin Sans', 'Jost', 'Nunito Sans', 'DM Sans', 'DM Serif Display', 'DM Mono', 'EB Garamond', 'Libre Baskerville', 'Libre Caslon Display', 'Libre Caslon Text', 'Bodoni Moda', 'Cormorant Garamond',
  'Pinyon Script', 'Great Vibes', 'Dancing Script', 'Pacifico', 'Anton', 'Barlow', 'Barlow Condensed', 'Work Sans', 'Urbanist', 'Outfit', 'Fira Sans', 'Source Sans 3', 'PT Serif', 'Merriweather', 'Abril Fatface',
  'Archivo Narrow', 'League Gothic', 'Fjalla One', 'Italiana', 'Marcellus', 'Cormorant', 'Prata', 'Syne', 'Space Grotesk', 'Manrope', 'Karla', 'Rubik', 'Quicksand', 'Mulish', 'Noto Serif', 'Noto Sans']);
/** Is this a Google Fonts family? Asked of fonts.googleapis.com (a fixed address; 400 = no such family), cached; the
 *  built-in list answers when Google can't be reached. */
export async function isGoogleFont(name, { fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,40}$/.test(name)) return false;
  if (KNOWN_GOOGLE.has(name)) return true;
  if (googleCache.has(name)) return googleCache.get(name);
  let yes = false;
  try {
    const r = await fetchImpl('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+'), { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA } });
    yes = r.ok; await r.body?.cancel?.();
  } catch { yes = false; }
  googleCache.set(name, yes);
  return yes;
}
/** The look's three faces from what the site uses. → { heading, accent, body, headingCase, standIn, found: [{ name, kind }] } */
export async function chooseFonts({ faces, declared, google }, { isGoogle = isGoogleFont, typekit = false } = {}) {
  const kindOf = async (name) => (SYSTEM[name.toLowerCase()] ? 'system' : google.has(name) || (await isGoogle(name)) ? (declared.has(name) && typekit ? 'paid' : 'google') : 'paid');
  const byHeading = [...faces].sort((a, b) => b.heading - a.heading || b.any - a.any);
  const byBody = [...faces].sort((a, b) => b.body - a.body || b.any - a.any);
  const head = byHeading.find((f) => f.heading > 0) || byHeading[0] || null;
  const found = [];
  for (const f of [...faces].sort((a, b) => b.any - a.any).slice(0, 4)) found.push({ name: f.name, kind: await kindOf(f.name) });
  const kinds = new Map(found.map((f) => [f.name, f.kind]));
  const kind = async (n) => kinds.get(n) || (await kindOf(n));
  const standIn = {};
  let heading = 'Playfair Display', accent = 'Gilda Display', body = 'Archivo';
  if (head) {
    const k = await kind(head.name);
    const P = PAID[head.name.toLowerCase()];
    if (k === 'google') heading = head.name;
    else { heading = (k === 'system' ? null : P?.heading) || standInByKind(head.name, head.generic, 'heading'); standIn.heading = head.name; }
    if (k === 'paid' || k === 'system') { accent = P?.accent || standInByKind(head.name, head.generic, 'accent'); standIn.accent = head.name; }
    else accent = /script|hand|brush/i.test(head.name) ? head.name : standInByKind(head.name, head.generic, 'accent');
  }
  // the text face: the site's own free face if it has one (J.Baldwin's Montserrat), else its system face's stand-in
  const freeBody = [];
  for (const f of byBody) if (f !== head && (await kind(f.name)) === 'google' && !/script|hand/i.test(f.name)) freeBody.push(f);
  const sysBody = byBody.find((f) => f !== head && SYSTEM[f.name.toLowerCase()]);
  if (freeBody[0]) body = freeBody[0].name;
  else if (sysBody) { body = SYSTEM[sysBody.name.toLowerCase()]; standIn.body = sysBody.name; }
  else if (head && (await kind(head.name)) === 'google' && !UPPER_FACES.has(head.name)) body = head.name;
  if (sysBody && freeBody[0]) standIn.body = undefined;
  const systemNote = sysBody ? sysBody.name : null;
  return { heading, accent, body, headingCase: UPPER_FACES.has(heading) ? 'upper' : 'title', standIn: Object.fromEntries(Object.entries(standIn).filter(([, v]) => v)), found, systemBody: systemNote };
}

/* ── The whole read ───────────────────────────────────────────────────────────────────────────────────────────────── */
export const STEPS = ['open', 'logo', 'colours', 'fonts', 'match', 'photos'];
const BG_URL = /background(?:-image)?\s*:[^;}]*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
/**
 * Reads a website. `step(i, state, detail)` reports progress (i = index in STEPS; state 'run' | 'done' | 'skip').
 * → { url, host, siteName, pages, logos: [{ buf, ext, a (analyzeImage), score, src, variant }], icon: { buf, ext } | null,
 *     colors: [{ hex, weight, from }], colorCount, logoColors, fonts (chooseFonts), photos: [{ buf, src, w, h }] }
 * `fetchImpl`/`_allow`: the test suite's local server. `isGoogle`: the Google Fonts check (tests pass a stub).
 */
export async function readSite(raw, { signal, step = () => {}, fetchImpl = safeFetch, _allow = null, isGoogle } = {}) {
  const total = AbortSignal.timeout(LIMITS.totalMs);
  const stop = signal ? AbortSignal.any([signal, total]) : total;
  const get = (u, opts) => fetchImpl(u, { signal: stop, _allow, ...opts });
  const quiet = (p) => p.catch((e) => { if (signal?.aborted) throw new ReadError('Stopped.', 'cancel'); return null; });
  let input = String(raw || '').trim();
  if (!input) throw new ReadError('Paste your website’s address first.', 'url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = 'https://' + input;
  if (!_allow || new URL(input).host !== _allow) checkUrl(input);
  step(0, 'run', 'Opening ' + new URL(input).hostname);
  let home;
  try { home = await get(input, { kinds: ['html'], maxBytes: LIMITS.html }); }
  catch (e) {
    if (e.code === 'connect' && input.startsWith('https://') && !/^https:/i.test(String(raw).trim())) home = await get(input.replace(/^https:/, 'http:'), { kinds: ['html'], maxBytes: LIMITS.html });
    else throw e;
  }
  const page = parsePage(home.body.toString('utf8'), home.url);
  const host = new URL(home.url).hostname.replace(/^www\./, '');
  const extraUrls = linkedPages(page, host);
  const extra = (await Promise.all(extraUrls.map((u) => quiet(get(u, { kinds: ['html'], maxBytes: LIMITS.html }))))).filter(Boolean).map((r) => parsePage(r.body.toString('utf8'), r.url));
  const pages = [page, ...extra];
  step(0, 'done', extra.length ? `Home page and ${extra.map((p) => new URL(p.url).pathname).join(', ')}` : 'Home page');

  // styles: the page's own (inline and <style>) count three times a stylesheet's (plugins bring most of those)
  const sources = [{ css: page.styles.join('\n') + '\n' + page.inline, weight: 3 }, ...extra.map((p) => ({ css: p.styles.join('\n') + '\n' + p.inline, weight: 1.5 }))];
  const allSheets = [...new Set(pages.flatMap((p) => p.sheets))];
  const FONT_API = /fonts\.googleapis\.com|fonts-api\.wp\.com|fonts\.bunny\.net/;
  const google = new Set([...pages.flatMap((p) => p.googleFontLinks), ...allSheets.filter((u) => FONT_API.test(u))].flatMap(googleFamilies));
  // the site's own styles first (its theme, its page builder's kit, custom CSS), then bundles; shop, form and search
  // plugins never carry the brand, so they're skipped
  const PLUGIN = /\/(surecart|jetpack|woocommerce|wpforms|contact-form-7|gravityforms|wp-includes|block-library|dashicons|elementor\/assets\/lib|font-awesome|fontawesome|swiper|slick)\//i;
  const rank = (u) => (/elementor\/css\/(post|global)|\/themes\/|custom|style\.css|theme/i.test(u) ? 0 : /_static|\?\?|\/assets\/|\.css/i.test(u) ? 1 : 2);
  const sheets = allSheets.filter((u) => !FONT_API.test(u) && !PLUGIN.test(u)).sort((a, b) => rank(a) - rank(b)).slice(0, LIMITS.cssFiles);
  let cssBytes = 0;
  for (const u of sheets) {
    if (cssBytes > LIMITS.cssTotal) break;
    const r = await quiet(get(u, { kinds: ['css'], maxBytes: LIMITS.css }));
    if (!r) continue;
    cssBytes += r.body.length;
    sources.push({ css: r.body.toString('utf8'), weight: 1 });
  }

  // the logo: score every candidate, open the best few
  step(1, 'run', 'Looking in your header');
  const siteKey = norm(host.split('.').slice(0, -1).join('')).replace(/^www/, '');
  const nameKey = norm(page.siteName || page.title.split(/[|–—-]/)[0]);
  const cands = new Map();
  const addCand = (c) => { if (!c.src || cands.has(c.src)) return; c.score = logoScore(c, { siteKey, nameKey }); cands.set(c.src, c); };
  for (const p of pages) for (const im of p.imgs) if (/logo|brand/i.test(`${im.src} ${im.alt} ${im.cls}`) || im.header) addCand({ src: im.widest && /logo/i.test(im.widest) ? im.widest : im.src, alt: im.alt, cls: im.cls, header: im.header, order: im.order });
  // WordPress sites list their uploads: the logo files are usually there (J.Baldwin's full-colour logo is only there)
  if (page.wordpress) {
    const wp = await quiet(get(new URL('/wp-json/wp/v2/media?search=logo&per_page=30&_fields=source_url,alt_text', home.url).href, { kinds: ['json'], maxBytes: LIMITS.json }));
    try { for (const m of JSON.parse(wp?.body.toString('utf8') || '[]')) if (typeof m?.source_url === 'string') addCand({ src: m.source_url, alt: m.alt_text || '', cls: '', header: false, fromLibrary: true }); } catch { /* not JSON */ }
  }
  const svgCands = pages.flatMap((p) => p.svgs).slice(0, 2).map((s, i) => ({ svgText: s.svg, src: 'inline-svg-' + i, alt: s.label, cls: 'logo', header: s.header, score: 0 }));
  for (const s of svgCands) s.score = logoScore(s, { siteKey, nameKey }) + 2;
  const top = [...cands.values(), ...svgCands].filter((c) => c.score >= 3).sort((a, b) => b.score - a.score).slice(0, LIMITS.logoFiles);
  const logos = [];
  await Promise.all(top.map(async (c) => {
    let buf;
    if (c.svgText) buf = Buffer.from(c.svgText);
    else { const r = await quiet(get(c.src, { kinds: ['image'], maxBytes: LIMITS.image })); if (!r) return; buf = r.body; }
    const svg = !!c.svgText || /svg/.test(c.src.split('?')[0].split('.').pop() || '') || buf.subarray(0, 300).toString('utf8').includes('<svg');
    const a = await analyzeImage(buf, { svg }).catch(() => null);
    // a logo has some size to it (a 75 × 42 menu arrow in the header isn't one)
    if (!a || a.width < 100 || a.height < 24 || a.crop[2] < 80) return;
    const [, , cw, ch] = a.crop;
    const aspect = cw / Math.max(1, ch);
    // white (or light) artwork on a see-through file is for dark backgrounds; coloured or dark artwork is for light ones;
    // a logo on its own solid block goes where its block reads
    const variant = a.seeThrough ? (a.lightness > 0.72 ? 'dark' : 'light') : a.cornerDark ? 'dark' : 'light';
    const fit = aspect >= 2.5 ? 4 : aspect >= 1.5 ? 2 : 0;
    const keep = a.png || buf;
    const ext = a.png ? 'png' : a.format === 'jpeg' ? 'jpg' : a.format === 'webp' ? 'webp' : 'png';
    logos.push({ buf: a.format === 'png' || a.png ? keep : keep, ext, a, src: c.svgText ? 'inline SVG' : c.src, score: c.score + fit, variant });
  }));
  // one file per artwork (a site often has the same logo at several sizes)
  logos.sort((x, y) => y.score - x.score || y.a.width - x.a.width);
  const seen = new Set();
  const uniq = logos.filter((l) => { const k = sha(l.buf); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const nDark = uniq.filter((l) => l.variant === 'dark').length, nLight = uniq.length - nDark;
  step(1, uniq.length ? 'done' : 'skip', uniq.length ? `${uniq.length} version${uniq.length === 1 ? '' : 's'}: ${[nDark && 'white for dark', nLight && 'full colour for light'].filter(Boolean).join(', ')}` : 'No logo we could use: upload one');
  // the site icon: the biggest touch icon, else the biggest icon
  const iconLink = pages[0].icons.find((i) => i.touch) || pages[0].icons[0];
  let icon = null;
  if (iconLink) {
    const r = await quiet(get(iconLink.href, { kinds: ['image'], maxBytes: 2e6 }));
    const a = r && (await analyzeImage(r.body).catch(() => null));
    if (a && a.width >= 32) icon = { buf: a.png || r.body, ext: a.png ? 'png' : a.format === 'jpeg' ? 'jpg' : a.format === 'webp' ? 'webp' : 'png', w: a.width, h: a.height, src: iconLink.href };
  }

  // colours: the styles, the theme colour, and the main colours of the logos (their own pixels)
  step(2, 'run', 'Reading your styles');
  const colorMap = new Map();
  for (const s of sources) cssColors(s.css, s.weight, colorMap);
  const tc = normHex(page.themeColor || '');
  if (tc) { const e = colorMap.get(tc) || { hex: tc, weight: 0, from: [] }; e.weight += 30; e.from.push('meta'); colorMap.set(tc, e); }
  const logoColors = [];
  for (const l of uniq.slice(0, 3)) for (const c of l.a.colors) {
    if (c.share < 0.04) continue;
    const h = normHex(c.hex); if (!h) continue;
    logoColors.push(h);
    const e = colorMap.get(h) || { hex: h, weight: 0, from: [] }; e.weight += 40 * Math.min(1, c.share * 3); if (!e.from.includes('logo')) e.from.push('logo'); colorMap.set(h, e);
  }
  const colors = [...colorMap.values()].sort((a, b) => b.weight - a.weight);
  const colorCount = colors.filter((c) => c.weight >= 3).length;
  step(2, 'done', `${colorCount} in your styles; ${Math.min(6, colorCount)} used most`);

  // fonts
  step(3, 'run', 'Reading your fonts');
  const fontInfo = cssFonts(sources);
  for (const g of google) fontInfo.google.add(g);
  const fonts = await chooseFonts(fontInfo, { isGoogle, typekit: pages.some((p) => p.typekit) });
  step(3, 'done', fonts.found.length ? fonts.found.map((f) => f.name + (f.kind === 'paid' ? ' (paid)' : f.kind === 'system' ? ' (system)' : '')).join(', ') : 'No fonts named in your styles');
  const paid = fonts.found.filter((f) => f.kind !== 'google').map((f) => f.name);
  step(4, paid.length ? 'done' : 'skip', paid.length ? `Free stand-ins: ${[fonts.standIn.heading && `${fonts.heading} for ${fonts.standIn.heading}`, fonts.standIn.body && `${fonts.body} for ${fonts.standIn.body}`].filter(Boolean).join(', ') || fonts.heading}` : 'Every font is free to use');

  // photos: big images on the pages, the link-preview image, section backgrounds
  step(5, 'run', 'Picking photos');
  const logoSrcs = new Set(uniq.map((l) => l.src));
  const isPhotoName = (u) => !/logo|icon|badge|award|sprite|favicon|placeholder|avatar|emoji|flag|map|qr|button|arrow|close|menu-bar|burger-bar/i.test(u.split('?')[0].split('/').pop() || '');
  const photoCands = [];
  const addPhoto = (u, w = 0) => { if (u && !logoSrcs.has(u) && isPhotoName(u) && !photoCands.some((p) => p.key === baseKey(u))) photoCands.push({ src: u, key: baseKey(u), w }); };
  if (page.ogImage) addPhoto(page.ogImage, 1200);
  for (const p of pages) for (const im of p.imgs) if (Math.max(im.w, im.widestW) >= 600 && !/logo/i.test(im.cls + im.alt)) addPhoto(im.photoSrc || im.src, Math.max(im.w, im.widestW));
  for (const s of sources.slice(0, 1 + extra.length)) for (const m of s.css.matchAll(BG_URL)) { try { addPhoto(new URL(decode(m[1]), home.url).href, 800); } catch { /* bad url */ } }
  const photos = [];
  for (let i = 0; i < Math.min(photoCands.length, LIMITS.photoFiles) && photos.length < 6; i += 3) {
    const batch = await Promise.all(photoCands.slice(i, i + 3).map(async (c) => {
      const r = await quiet(get(c.src, { kinds: ['image'], maxBytes: LIMITS.image }));
      if (!r) return null;
      try {
        const sharp = await getSharp();
        const m = await sharp(r.body, { limitInputPixels: 60e6 }).metadata();
        if (m.format === 'svg' || (m.width || 0) < 600 || (m.height || 0) < 400) return null;
        const ar = m.width / m.height; if (ar < 0.5 || ar > 2.6) return null;
        const out = await sharp(r.body, { limitInputPixels: 60e6 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        return { buf: out.data, src: c.src, w: out.info.width, h: out.info.height };
      } catch { return null; }
    }));
    for (const b of batch) if (b && photos.length < 6) photos.push(b);
  }
  step(5, 'done', `${photos.length} photo${photos.length === 1 ? '' : 's'}`);
  return { url: home.url, host, siteName: page.siteName || page.title.split(/[|–—]/)[0].trim() || host, pages: pages.map((p) => p.url), logos: uniq, icon, colors, colorCount, logoColors, fonts, photos };
}
const baseKey = (u) => { try { const f = new URL(u).pathname.split('/').pop() || ''; return f.replace(/-\d+x\d+(?=\.)/, '').replace(/\.(webp|jpe?g|png|avif)$/i, '').replace(/-(scaled|e\d+)$/, '').toLowerCase(); } catch { return u; } };
