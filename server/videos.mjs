// Real videos only (Nov 8, Tommy: "Is there anything in the app that is fake? … there are some videos at the bottom that
// aren't real … If there's no video uploaded, just have it not be there … I want to start making this into more of a real
// app versus having just a bunch of filler crap").
//   • The Video Library and Home's video row list the videos the book really has: dish and cocktail videos a manager added,
//     the classics' how-to videos, the grape and region videos, and the Court's service videos. No made-up durations,
//     "Watched" badges or "Required before your next shift".
//   • Anywhere a video frame has nothing in it, the frame goes (emptyVideoFrames).
import { clone, find, findAll, byName, startsWith, texts, setText, remove } from './templates.mjs';
import { wineVideos } from './wine.mjs';
import { HUB_VIDEOS } from './study.mjs';

const ytThumb = (v, big) => (v?.kind === 'youtube' ? `https://i.ytimg.com/vi/${v.youtubeId}/${big ? 'hqdefault' : 'mqdefault'}.jpg` : null);
/** "Cabernet Sauvignon (Everything You Need To Know) · Wine Folly" → ["Cabernet Sauvignon (Everything You Need To Know)", "Wine Folly"] */
const split = (t) => { const i = String(t || '').lastIndexOf(' · '); return i < 0 ? [String(t || ''), ''] : [t.slice(0, i), t.slice(i + 3)]; };
const SERVICE = ['Video · How to Open a Bottle of Wine', 'Video · How to Open & Serve Sparkling Wine', 'Video · How to Decant Wine'];

/** Every real video in the book, in library order: kitchen, our cocktails, service, classics, wine. */
export function libraryVideos({ recipes, house, classics, db }) {
  const out = [];
  const seen = new Set(); // one video can serve several pages (Italy and Tuscany share one): list it once
  const add = (tab, title, by, video, to, still) => {
    const id = video && (video.youtubeId || video.url);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ tab, title, by, video, to, thumb: still || ytThumb(video), big: still || ytThumb(video, true) });
  };
  for (const e of recipes) {
    const d = e.data;
    if (d.hasVideo && d.video) add('Kitchen', d.videoTitle || `${d.name} · How it’s made`, d.course || '', d.video, '/' + e.slug, d.videoStill || d.photo);
  }
  for (const e of house) if (e.data.video) add('Bar', `Making the ${e.data.name}`, 'Our cocktails', e.data.video, '/' + e.slug, e.data.photo);
  for (const name of SERVICE) {
    const id = HUB_VIDEOS[name];
    if (id) add('Service', name.slice(8), 'Court of Master Sommeliers', { kind: 'youtube', youtubeId: id, title: name.slice(8) + ' · Court of Master Sommeliers' }, '/sommelier-program');
  }
  for (const e of classics) {
    const v = e.data.video;
    if (v) add('Bar', e.data.name, split(v.title)[1] || 'Classic cocktail', v, '/' + e.slug);
  }
  if (db) {
    for (const [key, rec] of wineVideos(db)) {
      if (!rec?.video) continue;
      const [title, by] = split(rec.video.title);
      add('Wine', title || key.split('/').pop(), by, rec.video, /^wine\//.test(key) ? '/' + key : undefined);
    }
  }
  return out;
}

/** One card or list item: its picture, its words, and the video it plays. Durations and watched marks go: we don't know them. */
function fillCard(card, v, prefix) {
  card.n = `${prefix} · ${v.title}`;
  card.vid = v.video;
  const pic = find(card, byName('Thumbnail')) || card;
  const still = find(pic, startsWith('IMG/'));
  if (still) { still.n = 'IMG/' + v.title; still.f = v.thumb ? [{ img: v.thumb, m: 'FILL' }] : still.f; }
  pic.c = (pic.c || []).filter((c) => !['Duration', 'Badge', 'Watched', 'Watched track'].includes(c.n));
  const words = find(card, byName('Meta')) || find(card, byName('Copy'));
  const t = texts(words || card);
  // The words wrap inside the card's width, so a long title never widens its card and breaks the grid.
  if (words && prefix === 'Video') { words.sh = 'F'; words.w = card.w; for (const x of t) { x.sh = 'F'; x.ar = 'H'; x.w = card.w; } }
  if (t[0]) { setText(t[0], v.title); t[0].n = v.title; }
  if (t[1]) { setText(t[1], [v.tab, v.by].filter(Boolean).join(' · ')); t[1].n = t[1].s; }
  return card;
}

/** The Video Library page: the first video plays at the top, the next four are Up Next, every video is in the grid. */
export function fillVideoLibrary(page, list) {
  const m = page.main;
  const featured = find(m, byName('Featured'));
  const grid = find(m, byName('Grid'));
  if (!featured || !grid) return;
  const allSection = find(m, byName('Section · All videos'));
  if (!list.length) {
    remove(m, featured); if (allSection) remove(m, allSection);
    const tabs = find(m, byName('Tabs wrap')); if (tabs) remove(m, tabs);
    return;
  }
  const first = list[0];
  const player = find(featured, byName('Player'));
  if (player) {
    player.vid = first.video;
    const still = find(player, startsWith('IMG/'));
    if (still && first.big) still.f = [{ img: first.big, m: 'FILL' }];
    if (still) still.n = 'IMG/' + first.title;
    const t = player.c.filter((c) => c.t === 'T');
    if (t[0]) { setText(t[0], first.title); t[0].n = first.title; }
    if (t[1]) { setText(t[1], [first.tab, first.by].filter(Boolean).join(' · ')); t[1].n = t[1].s; }
  }
  const why = find(featured, byName('Why')); if (why) remove(featured, why);
  const next = find(featured, byName('Up next'));
  if (next) {
    const items = next.c.filter(startsWith('Item · '));
    const proto = items.find((i) => !find(i, byName('Watched'))) || items[0];
    const rest = list.slice(1, 5);
    if (!rest.length) remove(featured, next);
    else next.c = [...next.c.filter((c) => !startsWith('Item · ')(c)), ...rest.map((v) => fillCard(clone(proto), v, 'Item'))];
  }
  const cards = grid.c.filter(startsWith('Video · '));
  const proto = cards.find((c) => !find(c, byName('Watched')) && !find(c, byName('Badge'))) || cards[0];
  grid.c = list.map((v) => fillCard(clone(proto), v, 'Video'));
}

/** Home's video row: three real videos, one from each kind when there are, or no row at all. */
export function fillHomeVideos(page, list) {
  const sec = find(page.main, byName('Section · Video Library'));
  const row = sec && find(sec, byName('Videos'));
  if (!row) return;
  const picks = [];
  for (const tab of ['Kitchen', 'Bar', 'Service', 'Wine']) { const v = list.find((x) => x.tab === tab); if (v) picks.push(v); }
  for (const v of list) if (picks.length < 3 && !picks.includes(v)) picks.push(v);
  if (!picks.length) { remove(page.main, sec); return; }
  const proto = row.c.find(startsWith('Video · '));
  row.c = picks.slice(0, 3).map((v) => fillCard(clone(proto), v, 'Video'));
}

/** A video frame with no video in it goes. Where the band is only there for the video (a dish's Watch It Made, a wine's
 *  Learn More), the band goes; where it also tells a story, the story stays and takes the full width. */
export function emptyVideoFrames(page, slug, file = '') {
  // The Sommelier Program's lessons: a lesson with no video opens on its photo, by design (Nov 1).
  if (/^sommelier-program/.test(slug || '') || /^(l|m)-/.test(file)) return;
  const m = page.main;
  const plays = (n) => !!n.vid || (n.c || []).some(plays);
  const isFrame = (n) => ((n.n || '').startsWith('Video slot') || n.n === 'Player') && !plays(n);
  for (;;) {
    const path = chainTo(m, isFrame);
    if (!path) break;
    const frame = path[path.length - 1];
    const story = path.find((n) => n.n === 'The story');
    if (story) {
      remove(story, frame);
      const copy = find(story, byName('Copy'));
      if (copy) copy.sh = 'F';
      const body = copy ? texts(copy).slice(2).map((t) => String(t.s || '').trim()).join(' ') : '';
      if (!body) remove(m, story); // nothing to say either (a "bar lead to add" note stays for managers; staff never see it)
    } else {
      const band = path[1] && path[1] !== frame ? path[1] : null; // the page-level band holding the frame
      remove(band ? m : path[path.length - 2], band || frame);
    }
  }
}
function chainTo(n, pred, path = []) {
  if (pred(n)) return [...path, n];
  for (const c of n.c || []) { const r = chainTo(c, pred, [...path, n]); if (r) return r; }
  return null;
}
