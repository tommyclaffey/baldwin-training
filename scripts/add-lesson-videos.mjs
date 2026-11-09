// Nov 9 (Tommy: "adding as many videos as possible to the training program based on subject"). Takes the research
// files content/research/videos/found-*.json and puts each video on its lesson section (v3.sections[].video), after
// checking it again with YouTube's oEmbed. A section that already has a video keeps it. Usage: node scripts/add-lesson-videos.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(ROOT, 'content/research/videos');
const found = fs.readdirSync(dir).filter((f) => /^found-.*\.json$/.test(f)).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const files = new Map();
const load = (f) => { const p = path.isAbsolute(f) ? f : path.join(ROOT, f); if (!files.has(p)) files.set(p, JSON.parse(fs.readFileSync(p, 'utf8'))); return [p, files.get(p)]; };
let added = 0, skipped = []; const changed = new Set();
const seen = new Map(); // youtubeId → lesson slug, so a video isn't reused across lessons
for (const p0 of fs.readdirSync(path.join(ROOT, 'content')).filter((d) => ['bar', 'beer', 'manual', 'manual-l2'].includes(d)))
  for (const f of fs.readdirSync(path.join(ROOT, 'content', p0)).filter((x) => x.endsWith('.json'))) { const [, c] = load(path.join('content', p0, f)); for (const s of c.v3?.sections || []) if (s.video?.youtubeId) seen.set(s.video.youtubeId, c.slug); }
for (const v of found) {
  const [p, c] = load(v.file);
  const s = (c.v3?.sections || []).find((x) => x.name === v.section);
  if (!s) { skipped.push(`${c.slug} · ${v.section}: no such section`); continue; }
  if (s.video?.youtubeId) { skipped.push(`${c.slug} · ${v.section}: already has one`); continue; }
  if (seen.has(v.youtubeId) && seen.get(v.youtubeId) !== c.slug) { skipped.push(`${c.slug} · ${v.section}: video already used in ${seen.get(v.youtubeId)}`); continue; }
  const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.youtubeId}&format=json`);
  if (!r.ok) { skipped.push(`${c.slug} · ${v.section}: oEmbed ${r.status}`); continue; }
  const o = await r.json();
  s.video = { youtubeId: v.youtubeId, title: o.title, by: o.author_name, ...(v.length ? { length: v.length } : {}) };
  seen.set(v.youtubeId, c.slug); added++; changed.add(p);
}
for (const p of changed) { const raw = fs.readFileSync(p, 'utf8'); const ind = /^\{\n( +)"/.exec(raw)?.[1].length || 1; fs.writeFileSync(p, JSON.stringify(files.get(p), null, ind) + '\n'); }
console.log(`added ${added}`); if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
