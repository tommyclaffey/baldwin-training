// One-time (Nov 16): copies Baldwin Restaurant Group's own material out of a checkout of this repo made before the move
// (origin/main at 003225c) into its private account folder, outside the repo. Run once; the result is the source of truth
// for BRG's account content from then on (~/Coding/mise-private/baldwin, not in git).
//
//   node scripts/account-content/extract-baldwin.mjs <checkout before the move> [out = ~/Coding/mise-private/baldwin]
//
// out/account/   exactly what goes on the volume at DATA_DIR/accounts/1/ (copy-to-volume.mjs puts it there)
// out/research/  BRG's own documents the content was written from; kept for reference, never deployed
// out/MANIFEST.json  every file, where it came from in the repo, and its sha256
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const src = path.resolve(process.argv[2] || '');
const out = path.resolve(process.argv[3] || path.join(os.homedir(), 'Coding/mise-private/baldwin'));
if (!fs.existsSync(path.join(src, 'content/cms/recipe.json'))) { console.error('Give a checkout from before the move (it has content/cms/recipe.json).'); process.exit(1); }
if (out.startsWith(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'))) { console.error('The account folder must be outside the repo.'); process.exit(1); }

// The designed pages that are BRG's own, or carry its own bookings and offers. The shared templates in content/templates/
// replace them for everyone else.
export const PAGES = {
  '23-2': 'Our Story: the Baldwin family, its three restaurants, its values (photos from jbaldwins.com, testabarra.com, thebaldwinshelby.com)',
  '30-2': 'Floor Plan: The Baldwin’s room, table numbers and areas (+ its table positions, content/floorplan.json)',
  '25-2': 'Wine: The Baldwin’s wine program ($22 wine flight, $30 sommelier flight)',
  '353-2': 'Sommelier Program · About: the Court sittings BRG hosts at Testa Barra, dates, Jeffrey Baldwin',
  '354-2': 'Sommelier Level 1 · Exam Details: at Testa Barra, Feb 22–23, 2027',
  '355-2': 'Sommelier Level 2 · Exam Details: at Testa Barra, Feb 24, 2027',
  '360-2': 'Sommelier Level 1 (old page): Book Feb 22–23',
  '391-32': 'Sommelier Program hub: "We host it" dates and the Book your seat band (the hub every program’s page is drawn from)',
  '392-31': 'Sommelier Level 1: Book Feb 22–23 (the level page every program’s levels are drawn from)',
  '394-31': 'Sommelier Level 2: Book Feb 24, 2027 · $849',
};
const FILES = [
  // [repo path, account path (null = research, not deployed), what it is]
  ...['recipe', 'house', 'wine', 'shelf', 'beer'].map((c) => [`content/cms/${c}.json`, `cms/${c}.json`, `The Baldwin’s ${{ recipe: 'Food Book dishes', house: 'Drink Book house cocktails and specs', wine: 'wine list', shelf: 'back bar', beer: 'beers' }[c]} (CMS seeds)`]),
  ...fs.readdirSync(path.join(src, 'content/hospitality')).map((f) => [`content/hospitality/${f}`, `programs/hospitality/${f}`, 'BRG’s own Hospitality Program lessons (BRG-worded)']),
  ...['01f36254e089.png', 'ee47badaceaf.png', 'f223bafcb24c.png', 'logo-white.png'].map((f) => [`public/img/${f}`, `public/img/${f}`, 'The Baldwin group’s logos']),
  ...['776a14643abe.jpg', '6bd0dc353bed.jpg', 'b466158d38db.jpg', '96244451ba05.jpg', '9b4ee3a03607.jpg'].map((f) => [`public/img/${f}`, `public/img/${f}`, 'The Baldwin group’s photos (exterior, interior, family, J.Baldwin’s calamari, Testa Barra spread)']),
  ['public/img/a44d537f3278.png', 'public/img/a44d537f3278.png', 'The Baldwin’s floor plan drawing'],
  ...fs.readdirSync(path.join(src, 'public/icons')).filter((f) => f.startsWith('the-baldwin-')).map((f) => [`public/icons/${f}`, `public/icons/${f}`, 'The Baldwin’s app icons (its logo mark)']),
  ...fs.readdirSync(path.join(src, 'content/research/hospitality')).map((f) => [`content/research/hospitality/${f}`, null, 'BRG’s own documents: Hospitality 101 and The Art of Table Service']),
  ...fs.readdirSync(path.join(src, 'content/research/books-nov5')).map((f) => [`content/research/books-nov5/${f}`, null, 'The Baldwin’s Food Book and Drink Book, read into JSON (Nov 5)']),
  ['content/floorplan.json', null, 'The Baldwin’s table positions (also inside account/pages/30-2.json as planTables)'],
];

fs.rmSync(out, { recursive: true, force: true });
const manifest = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const put = (rel, buf, from, what) => {
  const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  manifest.push({ file: rel, from, what, bytes: buf.length, sha256: sha(buf) });
};
for (const [from, to, what] of FILES) put(to ? 'account/' + to : 'research/' + from.replace(/^content\/research\//, '').replace(/^content\//, ''), fs.readFileSync(path.join(src, from)), from, what);
// Pages: BRG's versions exactly as the app serves them today, and their search entries.
const index = JSON.parse(fs.readFileSync(path.join(src, 'public/content/index.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(src, 'content/floorplan.json'), 'utf8'));
for (const [file, what] of Object.entries(PAGES)) {
  const page = JSON.parse(fs.readFileSync(path.join(src, 'public/content/pages', file + '.json'), 'utf8'));
  if (file === '30-2') page.planTables = plan.tables; // the Floor Plan's own tables travel with it (server/interact.mjs)
  put(`account/pages/${file}.json`, Buffer.from(JSON.stringify(page)), `public/content/pages/${file}.json` + (file === '30-2' ? ' + content/floorplan.json' : ''), what);
}
put('account/pages/index.json', Buffer.from(JSON.stringify(index.filter((e) => PAGES[e.file]))), 'public/content/index.json', 'Search entries for those pages');
put('account/account.json', Buffer.from(JSON.stringify({
  name: 'Baldwin Restaurant Group', company: 1, seedStore: 1, seedKeyPrefix: '',
  note: 'Baldwin Restaurant Group’s own content (Nov 16): its menu seeds go to The Baldwin (store 1). Seed keys keep no prefix: they came from the public repo before Nov 16. Placed on the volume at /data/accounts/1 by scripts/account-content/copy-to-volume.mjs.',
}, null, 1)), '(new)', 'Account settings: which store the menu seeds fill');
fs.writeFileSync(path.join(out, 'MANIFEST.json'), JSON.stringify({ made: new Date().toISOString(), from: src, files: manifest }, null, 1));
console.log(`${manifest.length} files → ${out} (${(manifest.reduce((a, m) => a + m.bytes, 0) / 1e6).toFixed(1)} MB)`);
