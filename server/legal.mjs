// Privacy Policy, Terms of Service and Help (Nov 16, from Tommy's draft of Nov 14). The words and the four blanks
// ([Company], [State], [Support email], [Date]) live in one file, content/legal.md. While any blank is empty the pages
// aren't public: /api/legal/* answers "not found" to everyone except a super admin, who gets a preview marked as a draft,
// and the app hides every link to them. Fill the four lines at the top of content/legal.md and they go public.
//
// The file is a small piece of Markdown: front matter for the blanks, then one "# " heading per page, "## " headings,
// paragraphs, "- " and "1. " lists, **bold** and *italic*. It's read on request (cached until the file changes) and sent
// as plain data, so the app never renders HTML from it.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = () => process.env.LEGAL_FILE || path.join(ROOT, 'content', 'legal.md'); // tests point this at their own copy
export const LEGAL_KINDS = { privacy: 'Privacy Policy', terms: 'Terms of Service', help: 'Help' };
const BLANKS = { '[Company]': 'company', '[State]': 'state', '[Support email]': 'supportEmail', '[Date]': 'date' };
const KEYS = ['company', 'state', 'supportEmail', 'date'];
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

let cache = null; // { file, mtime, parsed }

function read() {
  const file = FILE();
  let stat = null;
  try { stat = fs.statSync(file); } catch { /* no file: nothing is public */ }
  if (cache && cache.file === file && cache.mtime === stat?.mtimeMs) return cache.parsed;
  const parsed = parse(stat ? fs.readFileSync(file, 'utf8') : '');
  cache = { file, mtime: stat?.mtimeMs, parsed };
  return parsed;
}

/** The front matter's values and the pages' raw lines. */
export function parse(src) {
  const values = Object.fromEntries(KEYS.map((k) => [k, '']));
  let body = src.replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (m && KEYS.includes(m[1])) values[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    body = body.slice(fm[0].length);
  }
  const pages = {};
  let cur = null;
  for (const line of body.split('\n')) {
    const h = /^# (.+?)\s*$/.exec(line);
    if (h) { const kind = Object.keys(LEGAL_KINDS).find((k) => LEGAL_KINDS[k].toLowerCase() === h[1].toLowerCase()); cur = kind ? (pages[kind] = []) : null; continue; }
    if (cur) cur.push(line);
  }
  return { values, pages };
}

/** Are all four blanks filled? { filled, values, missing } */
export function legalState() {
  const { values } = read();
  const missing = KEYS.filter((k) => !values[k] || (k === 'supportEmail' && !validEmail(values[k])));
  return { filled: missing.length === 0, values, missing };
}

/** One line's words as runs: { t, b?, i?, mail?, blank? }. A blank shows as itself (marked) until it's filled. */
function runs(text, values, style = {}) {
  const out = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) { out.push(...runs(part.slice(2, -2), values, { ...style, b: true })); continue; }
    if (/^\*[^*]+\*$/.test(part)) { out.push(...runs(part.slice(1, -1), values, { ...style, i: true })); continue; }
    for (const bit of part.split(/(\[Company\]|\[State\]|\[Support email\]|\[Date\])/)) {
      if (!bit) continue;
      const key = BLANKS[bit];
      if (!key) out.push({ t: bit, ...style });
      else if (values[key]) out.push({ t: values[key], ...style, ...(key === 'supportEmail' && validEmail(values[key]) ? { mail: true } : {}) });
      else out.push({ t: bit, ...style, blank: true });
    }
  }
  return out;
}

/** A page as blocks: { h: runs } · { p: runs } · { ul: runs[] } · { ol: runs[] }. */
function blocks(lines, values) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) out.push({ p: runs(para.join(' '), values) }); para = []; };
  for (const raw of lines) {
    const line = raw.trim();
    const li = /^- (.+)$/.exec(line), ol = /^\d+\. (.+)$/.exec(line), h = /^## (.+)$/.exec(line);
    if (!line) { flush(); continue; }
    if (h) { flush(); out.push({ h: runs(h[1], values) }); continue; }
    if (li || ol) {
      flush();
      const kind = li ? 'ul' : 'ol';
      const last = out.at(-1);
      const item = runs((li || ol)[1], values);
      if (last && last[kind]) last[kind].push(item); else out.push({ [kind]: [item] });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** The page for the app: { kind, title, blocks, supportEmail, draft, missing }, or null if there's no such page. */
export function legalPage(kind) {
  if (!Object.hasOwn(LEGAL_KINDS, kind)) return null;
  const { values, pages } = read();
  if (!pages[kind]) return null;
  const st = legalState();
  return { kind, title: LEGAL_KINDS[kind], blocks: blocks(pages[kind], values), supportEmail: st.filled ? values.supportEmail : null, draft: !st.filled, missing: st.missing };
}
