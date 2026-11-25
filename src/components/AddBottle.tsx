// Add a Bottle (Nov 25; Figma 09 · Idea Board → 47 · Add a Bottle, approved Nov 25: "go with your choice").
// One clear way to add a wine or a spirit from the page where it lives: + Add a Bottle on the Wine page, the Back Bar and
// the Bottle Scanner. Desktop: one side panel with three parts (What is it? · Photo · The basics). Phone: four steps
// (What is it? → Photo → The basics → Check it). The photo uses the bottle scanner (IS-Net cut-out, unchanged). Saving
// opens the bottle's own page with a NEW tag and a toast (View List).
// Scan on My Phone from a desktop is a QR code (decided Nov 25): the phone scans, the photo comes back to this panel.
// A bottle already on the list without a photo gets Scan This Bottle on its page (ScanThisBottleButton below).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { api, canEdit } from '../lib/api';
import { useSession } from '../lib/session';
import { useModalKeys } from '../lib/modal';
import { BottleScanner } from '../admin/scanner';

export type BottleKind = 'wine' | 'spirit';
type Col = 'wine' | 'shelf';
const COL: Record<BottleKind, Col> = { wine: 'wine', spirit: 'shelf' };
const FILLER: Record<BottleKind, string> = { wine: '/img/wine-bottle-filler.jpg', spirit: '/img/spirit-bottle-filler.jpg' };
const LIST_PAGE: Record<BottleKind, string> = { wine: '/the-bar/wine', spirit: '/the-bar/back-bar' };
const LIST_NAME: Record<BottleKind, string> = { wine: 'Wine List', spirit: 'Back Bar' };
type Entry = { id: number; slug: string; data: Record<string, unknown> & { name?: string; bottle_img?: string; spin?: string[] } };

const WINE_LISTS = ['By the glass', 'By the bottle', 'Sommelier selection', 'Bubbles'] as const;
const LIST_LABEL: Record<string, string> = { 'By the glass': 'By the Glass', 'By the bottle': 'By the Bottle', 'Sommelier selection': 'Sommelier Selection', Bubbles: 'Bubbles' };
const COLORS = ['White', 'Red'] as const;
const COUNTRIES = [['USA', 'USA'], ['Italy', 'Italy'], ['France', 'France'], ['Around the world', 'Around the World']] as const;
const SPIRITS_TOP = ['Vodka', 'Gin', 'Tequila', 'Mezcal', 'Rum'];
const WHISKEYS = ['Bourbon', 'Rye', 'Scotch', 'Irish whiskey', 'Japanese whisky', 'Canadian whisky', 'American whiskey'];
const MORE = ['Cognac', 'Pisco', 'Amaro', 'Liqueur'];
const TIERS = [['Well', 'Well'], ['Call', 'Call'], ['Premium', 'Premium'], ['Top shelf', 'Top Shelf']] as const;
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

type Form = {
  producer: string; wine: string; grape: string; region: string; vintage: string; glass: string; bottle: string;
  list: string; color: string; country: string;
  name: string; spirit: string; style: string; tier: string; price: string;
};
const EMPTY: Form = { producer: '', wine: '', grape: '', region: '', vintage: '', glass: '', bottle: '', list: 'By the bottle', color: '', country: '', name: '', spirit: '', style: '', tier: '', price: '' };
type Photo = { img?: string; spin?: string[] } | null;

const money = (v: string) => v.replace(/[^\d.]/g, '').slice(0, 7);
/** "Muga ‘Reserva’": the list's own way of writing a producer and its label. */
const wineName = (f: Form) => [f.producer.trim(), f.wine.trim() ? `‘${f.wine.trim().replace(/^['‘’"]+|['‘’"]+$/g, '')}’` : ''].filter(Boolean).join(' ');
const nameOf = (kind: BottleKind, f: Form) => (kind === 'wine' ? wineName(f) : f.name.trim());
const norm = (s: unknown) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** What's still missing before it can be added (one plain line), or null. */
function missing(kind: BottleKind, f: Form): string | null {
  if (kind === 'wine') {
    if (!f.producer.trim()) return 'Type the producer.';
    if (f.list === 'By the glass' && !f.glass) return 'Add the glass price.';
    if (f.list !== 'Bubbles' && !f.color) return 'Pick white or red.';
    if (f.list === 'By the bottle' && !f.country) return 'Pick where it sits on the bottle list.';
    return null;
  }
  if (!f.name.trim()) return 'Type the bottle’s name.';
  if (!f.spirit) return 'Pick the spirit.';
  return null;
}

/** The entry the server saves (server/cms.mjs, collections wine and shelf). Notes, pairings and the rest wait for its page. */
function dataOf(kind: BottleKind, f: Form, photo: Photo): Record<string, unknown> {
  const pic = photo?.spin ? { spin: photo.spin, bottle_img: photo.spin[0] } : photo?.img ? { bottle_img: photo.img } : {};
  const scanned = photo ? { source: `Scanned ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` } : {};
  if (kind === 'wine') {
    const color = f.list === 'Bubbles' ? 'Bubbles' : f.color;
    return { name: wineName(f), grape: f.grape.trim(), region: f.region.trim(), vintage: f.vintage.trim(), list: f.list, color,
      country: f.list === 'By the bottle' ? f.country : '', glass: f.glass, bottle: f.bottle,
      pages: [f.grape.trim(), f.region.trim()].filter(Boolean), ...pic, ...scanned };
  }
  return { name: f.name.trim(), spirit: f.spirit, styles: f.style.trim() ? [f.style.trim()] : [], tier: f.tier, price: f.price, ...pic };
}

/* ------------------------------------------------------------------ the button */

/** "+ Add a Bottle" (managers and owners only; staff never see it). */
export function AddBottleButton({ kind = 'wine', className = 'eip-edit add-bottle-btn' }: { kind?: BottleKind; className?: string }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  if (!canEdit(user)) return null;
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add a Bottle
      </button>
      {open && <AddBottle kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}

const usePhone = () => {
  const q = '(max-width: 699px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, []);
  return m;
};

/* ------------------------------------------------------------------ the panel */

export function AddBottle({ kind: startKind = 'wine', onClose }: { kind?: BottleKind; onClose: () => void }) {
  const session = useSession();
  const nav = useNavigate();
  const phone = usePhone();
  const [kind, setKind] = useState<BottleKind>(startKind);
  const [step, setStep] = useState(1); // phone only: 1 What is it · 2 Photo · 3 The basics · 4 Check it
  const [f, setF] = useState<Form>(EMPTY);
  const [photo, setPhoto] = useState<Photo>(null);
  const [mode, setMode] = useState<'one' | 'spin' | 'skip'>('one');
  const [scan, setScan] = useState<{ spin: boolean; file?: File } | null>(null);
  const [qr, setQr] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lists, setLists] = useState<Record<Col, Entry[] | null>>({ wine: null, shelf: null });
  const panel = useRef<HTMLDivElement>(null);
  useModalKeys(panel, !scan);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !scan) onClose(); };
    window.addEventListener('keydown', esc);
    document.body.classList.add('eip-lock');
    return () => { window.removeEventListener('keydown', esc); document.body.classList.remove('eip-lock'); };
  }, [onClose, scan]);
  useEffect(() => {
    for (const c of ['wine', 'shelf'] as Col[]) api<{ entries: Entry[] }>(`/api/entries?collection=${c}`).then((r) => setLists((l) => ({ ...l, [c]: r.entries }))).catch(() => {});
  }, []);
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const name = nameOf(kind, f);
  // Already on the list (Figma 966:1878): same name, or the same producer and label, on this store's list.
  const dupe = useMemo(() => {
    const n = norm(name); if (!n) return null;
    return (lists[COL[kind]] || []).find((e) => norm(e.data.name) === n) || null;
  }, [lists, kind, name]);
  const need = missing(kind, f);

  const save = async () => {
    if (need) { setError(need); return; }
    setSaving(true); setError('');
    try {
      const out = await api<Entry>('/api/entries', { method: 'POST', body: { collection: COL[kind], data: dataOf(kind, f, photo) } });
      window.dispatchEvent(new CustomEvent('bt:entry-saved', { detail: { id: out.id } }));
      await session.reloadIndex(); session.bump();
      const where = kind === 'wine' ? LIST_LABEL[f.list] || f.list : [title(f.spirit), f.tier && title(f.tier)].filter(Boolean).join(' · ');
      onClose();
      nav('/' + out.slug, { state: { added: { kind, name: String(out.data.name || name), where, photo: !!photo, list: LIST_PAGE[kind], listName: LIST_NAME[kind] } } });
    } catch (e) { setError((e as Error).message); setSaving(false); }
  };

  const kept = (p: Photo) => { setPhoto(p); setScan(null); setQr(false); if (phone && step === 2) setStep(3); };
  const scanner = scan && (
    <BottleScanner name={name || (kind === 'wine' ? 'New wine' : 'New bottle')} detail={kind === 'wine' ? f.grape : f.spirit} kind={kind} spin={scan.spin} file={scan.file}
      onClose={() => setScan(null)} onDone={(url) => kept({ img: url })} onSpin={(frames) => kept({ spin: frames })} />
  );

  /* ---- the three parts, shared by the desktop panel and the phone steps ---- */
  const whatIsIt = (
    <div className="ab-kinds" role="radiogroup" aria-label="What is it?">
      {(['wine', 'spirit'] as BottleKind[]).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={kind === k} className={'ab-kind' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); setError(''); }}>
          {phone && <span className="ab-kind-img"><img src={FILLER[k]} alt="" /></span>}
          <span className="ab-radio" aria-hidden="true" />
          <span className="ab-kind-copy"><strong>{k === 'wine' ? 'Wine' : 'Spirit'}</strong><small>{k === 'wine' ? 'Goes on the wine list' : 'Goes on the back bar'}</small></span>
        </button>
      ))}
    </div>
  );
  const uploadInput = (label: string, cls = 'btn ghost') => (
    <label className={cls}>{label}<input type="file" hidden accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setScan({ spin: false, file }); }} /></label>
  );
  const photoThumb = (
    <span className={'ab-thumb' + (photo ? '' : ' empty')}>
      {photo ? <img src={photo.spin?.[0] || photo.img} alt={`${name || 'The bottle'}, cut out`} /> : <img src={FILLER[kind]} alt="" />}
      {photo?.spin && <span className="scan-360">360°</span>}
    </span>
  );
  const photoDesktop = (
    <div className="ab-photo">
      {photoThumb}
      <div className="ab-photo-copy">
        <strong>{photo ? (photo.spin ? `Spin · ${photo.spin.length} photos` : 'Cut out and straightened') : 'No photo yet'}</strong>
        <p>{photo ? 'Edges, base and cap should all be there. Not right? Take it again.' : 'Upload a photo of our own bottle and the scanner cuts it out on the beige. Or scan it with your phone.'}</p>
        <div className="ab-actions">
          {uploadInput(photo ? 'Upload Another' : 'Upload a Photo')}
          <button type="button" className="btn ghost" aria-expanded={qr} onClick={() => setQr(!qr)}>Scan on My Phone</button>
          {!photo && <button type="button" className="btn ghost" onClick={() => setScan({ spin: true })}>Photo by Photo</button>}
        </div>
        {photo ? <button type="button" className="ab-link" onClick={() => setPhoto(null)}>Remove the photo (add one later)</button>
          : <p className="ab-hint">Or skip it: add it now, and scan it later from its page.</p>}
      </div>
      {qr && <PhoneQr kind={kind} name={name} onPhoto={kept} onClose={() => setQr(false)} />}
    </div>
  );
  const field = (k: keyof Form, label: string, opts: { money?: boolean; placeholder?: string; mode?: 'numeric' | 'decimal'; max?: number; cls?: string } = {}) => (
    <label className={'field ab-field ' + (opts.cls || '')}>
      <span>{label}</span>
      <span className={opts.money ? 'ab-money' : undefined}>
        {opts.money && <i aria-hidden="true">$</i>}
        <input value={f[k]} inputMode={opts.money ? 'decimal' : opts.mode} maxLength={opts.max || 80} placeholder={opts.placeholder}
          onChange={(e) => set(k)(opts.money ? money(e.target.value) : e.target.value)} />
      </span>
    </label>
  );
  const chips = (label: string, k: keyof Form, opts: readonly (readonly [string, string])[], extra?: React.ReactNode) => (
    <div className="ab-chips-wrap">
      <p className="ab-chips-label" id={'ab-' + k}>{label}</p>
      <div className="ab-chips" role="radiogroup" aria-labelledby={'ab-' + k}>
        {opts.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={f[k] === v} className={'chip' + (f[k] === v ? ' on' : '')} onClick={() => set(k)(f[k] === v && k !== 'list' ? '' : v)}>{l}</button>)}
        {extra}
      </div>
    </div>
  );
  const [spiritMore, setSpiritMore] = useState<'' | 'whiskey' | 'more'>(() => '');
  const basics = kind === 'wine' ? (
    <div className="ab-grid">
      {field('producer', 'Producer', { placeholder: 'e.g. Muga' })}
      {field('wine', 'Wine', { placeholder: 'e.g. Reserva' })}
      {field('grape', 'Grape', { placeholder: 'e.g. Tempranillo', max: 60 })}
      {field('region', 'Region', { placeholder: 'e.g. Rioja', max: 60 })}
      <div className="ab-grid3 span-2">
        {field('vintage', 'Vintage', { placeholder: '2019', mode: 'numeric', max: 8 })}
        {field('glass', 'Glass price', { money: true, placeholder: '—' })}
        {field('bottle', 'Bottle price', { money: true })}
      </div>
      <div className="span-2">{chips('On the list', 'list', WINE_LISTS.map((v) => [v, LIST_LABEL[v]] as const))}</div>
      {f.list !== 'Bubbles' && <div className="span-2">{chips('Colour', 'color', COLORS.map((v) => [v, v] as const))}</div>}
      {f.list === 'By the bottle' && <div className="span-2">{chips('Bottle list column', 'country', COUNTRIES)}</div>}
    </div>
  ) : (
    <div className="ab-grid">
      {field('name', 'Name', { placeholder: 'e.g. Fortaleza Blanco', cls: 'span-2' })}
      <div className="span-2">
        {chips('Spirit', 'spirit', [...SPIRITS_TOP, ...(spiritMore === 'whiskey' || WHISKEYS.includes(f.spirit) ? WHISKEYS : []), ...(spiritMore === 'more' || MORE.includes(f.spirit) ? MORE : [])].map((v) => [v, title(v)] as const),
          <>
            {spiritMore !== 'whiskey' && !WHISKEYS.includes(f.spirit) && <button type="button" className="chip" onClick={() => setSpiritMore('whiskey')}>Whiskey</button>}
            {spiritMore !== 'more' && !MORE.includes(f.spirit) && <button type="button" className="chip" onClick={() => setSpiritMore('more')}>More</button>}
          </>)}
      </div>
      {field('style', 'Style', { placeholder: 'e.g. Blanco', max: 40, cls: 'span-2' })}
      <div className="span-2">{chips('Tier', 'tier', TIERS)}</div>
      {field('price', 'Pour price', { money: true, placeholder: '16' })}
    </div>
  );
  const dupeNote = dupe && (
    <div className="ab-dupe" role="status">
      <strong>{String(dupe.data.name)} is already on the {kind === 'wine' ? 'wine list' : 'back bar'}.</strong>
      <span>{dupe.data.bottle_img || dupe.data.spin?.length ? 'It has its photo.' : 'It has no photo yet: scan it from its page.'}</span>
      <Link to={'/' + dupe.slug} onClick={onClose}>Open Its Page</Link>
    </div>
  );
  const add = dupe ? 'Add It Anyway' : `Add to ${LIST_NAME[kind]}`;

  /* ---- desktop: one side panel (Figma 963:1509) ---- */
  if (!phone) return createPortal(
    <div className="eip ab" role="presentation">
      <div className="eip-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} className="eip-panel ab-panel" role="dialog" aria-modal="true" aria-labelledby="ab-title">
        <header className="ab-head">
          <div><h2 id="ab-title">Add a Bottle</h2><p>It goes on the list, with its own page.</p></div>
          <CloseBtn onClick={onClose} />
        </header>
        <div className="eip-body ab-body">
          <section className="ab-sec" aria-labelledby="ab-s1"><h3 id="ab-s1">1 · What is it?</h3>{whatIsIt}</section>
          <section className="ab-sec" aria-labelledby="ab-s2"><h3 id="ab-s2">2 · Photo</h3>{photoDesktop}</section>
          <section className="ab-sec" aria-labelledby="ab-s3"><h3 id="ab-s3">3 · The basics</h3>{basics}{dupeNote}</section>
          {error && <p className="eip-error" role="alert">{error}</p>}
        </div>
        <footer className="eip-foot ab-foot">
          <span className="ab-foot-note">Opens its page when it’s added</span>
          <span className="ab-foot-btns">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : add}</button>
          </span>
        </footer>
      </div>
      {scanner}
    </div>, document.body);

  /* ---- phone: four steps (Figma 964:1803 → 966:1753) ---- */
  const LABELS = ['What is it?', 'Photo', 'The basics', 'Check it'];
  const sub = step === 1 ? 'It goes on the list, with its own page' : [kind === 'wine' ? 'Wine' : 'Spirit', step === 2 && mode === 'one' ? 'One Photo' : step === 2 && mode === 'spin' ? 'Photo by Photo' : ''].filter(Boolean).join(' · ');
  const next = () => {
    if (step === 3 && need) { setError(need); return; }
    setError(''); setStep(step + 1);
  };
  const photoPhone = photo ? (
    <div className="ab-phone-photo">
      {photoThumb}
      <p><strong>{photo.spin ? `Spin · ${photo.spin.length} photos` : 'Cut out and straightened'}</strong> It goes on the bottle’s page.</p>
      <div className="ab-actions">
        <button type="button" className="btn ghost" onClick={() => setScan({ spin: !!photo.spin })}>Retake</button>
        <button type="button" className="btn ghost" onClick={() => setPhoto(null)}>Remove the Photo</button>
      </div>
    </div>
  ) : (
    <>
      <div className="ab-modes" role="radiogroup" aria-label="Add a photo of it">
        {([['one', 'One Photo', 'The front label. Cut out on the beige.', 'Best Start'], ['spin', 'Photo by Photo', '12 photos, turning it by hand. Makes a spin.', ''], ['skip', 'Skip the Photo', 'Add it now, scan it later from its page.', '']] as const).map(([m, t, l, tag]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={'ab-mode' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>
            <span className="ab-kind-copy"><strong>{t}{tag && <span className="scan-tag">{tag}</span>}</strong><small>{l}</small></span>
            <span className="ab-radio" aria-hidden="true" />
          </button>
        ))}
      </div>
      {mode !== 'skip' && (
        <div className="ab-tips">
          <strong>For a clean cut-out</strong>
          <ul><li>Stand it on the bar, a plain wall behind it.</li><li>No window or bright light behind it: it reflects in the glass.</li><li>Fill the guide, cap to base.</li></ul>
        </div>
      )}
    </>
  );
  const check = (
    <div className="ab-check">
      <span className="ab-check-img">{photoThumb}</span>
      <dl>
        <div><dt>{kind === 'wine' ? 'Wine' : 'Spirit'}</dt><dd>{[name, kind === 'wine' && f.vintage].filter(Boolean).join(' ') || '—'}</dd><button type="button" className="ab-link" onClick={() => setStep(3)}>Edit</button></div>
        <div><dt>{kind === 'wine' ? 'Grape · Region' : 'Spirit · Style'}</dt><dd>{(kind === 'wine' ? [f.grape, f.region] : [title(f.spirit), f.style]).filter(Boolean).join(' · ') || '—'}</dd><button type="button" className="ab-link" onClick={() => setStep(3)}>Edit</button></div>
        <div><dt>On the list</dt><dd>{kind === 'wine' ? [LIST_LABEL[f.list], f.glass && `Glass $${f.glass}`, f.bottle && `$${f.bottle}`].filter(Boolean).join(' · ') : [f.tier && title(f.tier), f.price && `$${f.price}`].filter(Boolean).join(' · ') || 'Back Bar'}</dd><button type="button" className="ab-link" onClick={() => setStep(3)}>Edit</button></div>
        <div><dt>Photo</dt><dd>{photo ? (photo.spin ? 'Spin' : 'Cut out') : 'None yet'}</dd><button type="button" className="ab-link" onClick={() => setStep(2)}>Edit</button></div>
      </dl>
      <p className="ab-hint">It opens its own page once it’s added. Tasting notes and pairings can wait.</p>
    </div>
  );
  return createPortal(
    <div className="ab ab-phone" role="presentation">
      <div ref={panel} className="ab-screen" role="dialog" aria-modal="true" aria-labelledby="ab-title">
        <header className="ab-head">
          <div><h2 id="ab-title">Add a Bottle</h2><p>{sub}</p></div>
          <CloseBtn onClick={onClose} />
        </header>
        <div className="ab-progress" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        <p className="ab-step">Step {step} of 4 · {LABELS[step - 1]}</p>
        <div className="ab-scroll">
          {step === 1 && <><h3 className="ab-ask">What are you adding?</h3>{whatIsIt}</>}
          {step === 2 && <><h3 className="ab-ask">Add a photo of it</h3>{photoPhone}</>}
          {step === 3 && <><span className="ab-basics-thumb">{photoThumb}</span>{basics}{dupeNote}</>}
          {step === 4 && <>{check}{dupeNote}</>}
          {error && <p className="eip-error" role="alert">{error}</p>}
        </div>
        <footer className="ab-phone-foot">
          {step > 1 && <button type="button" className="btn ghost" onClick={() => { setError(''); setStep(step - 1); }}>Back</button>}
          {step === 2 && !photo && mode !== 'skip'
            ? <span className="ab-foot-col">
                <button type="button" className="btn primary" onClick={() => setScan({ spin: mode === 'spin' })}>Open the Camera</button>
                {mode === 'one' && uploadInput('Upload a Photo Instead')}
              </span>
            : step < 4 ? <button type="button" className="btn primary" onClick={next}>Next</button>
              : <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : add}</button>}
        </footer>
      </div>
      {scanner}
    </div>, document.body);
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ab-close" aria-label="Close" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

/* ------------------------------------------------------------------ Scan on My Phone (QR) */

/** The QR code on the desktop. The phone opens /admin/bottle-scanner/phone/<token>; this polls until the photo comes back. */
function PhoneQr({ kind, name, onPhoto, onClose }: { kind: BottleKind; name: string; onPhoto: (p: Photo) => void; onClose: () => void }) {
  const [h, setH] = useState<{ token: string; qr: string; link: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const make = useCallback(() => {
    setError(''); setH(null);
    api<{ token: string; qr: string; link: string }>('/api/scan/handoff', { method: 'POST', body: { kind, name } }).then(setH).catch((e) => setError((e as Error).message));
  }, [kind, name]);
  useEffect(make, [make]);
  useEffect(() => {
    if (!h) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api<{ opened: boolean; photo: string | null; spin: string[] | null }>(`/api/scan/handoff/${h.token}`);
        setOpened(r.opened);
        if (r.photo || r.spin) { onPhoto(r.spin ? { spin: r.spin } : { img: r.photo! }); return; }
      } catch (e) { setError((e as Error).message); return; }
      window.setTimeout(tick, 2500);
    };
    const t = window.setTimeout(tick, 2500);
    return () => { stop = true; window.clearTimeout(t); };
  }, [h, onPhoto]);
  return (
    <div className="ab-qr" role="group" aria-label="Scan on My Phone">
      {h ? <span className="ab-qr-code" role="img" aria-label="QR code that opens the scanner on your phone" dangerouslySetInnerHTML={{ __html: h.qr }} /> : <span className="ab-qr-code loading" aria-hidden="true" />}
      <div>
        <strong>Scan this with your phone’s camera</strong>
        <ol>
          <li>Point your phone’s camera at the code and open the link.</li>
          <li>Sign in if it asks, then take the photo.</li>
          <li>The cut-out comes back here on its own.</li>
        </ol>
        <p className="ab-qr-status" role="status">{error || (opened ? 'Your phone has it open. Waiting for the photo…' : h ? 'Waiting for your phone… The code works for 20 minutes.' : 'Making the code…')}</p>
        <div className="ab-actions">
          {error && <button type="button" className="btn ghost" onClick={make}>Make a New Code</button>}
          <button type="button" className="ab-link" onClick={onClose}>Close the Code</button>
        </div>
      </div>
    </div>
  );
}

/** The phone side (Admin → /admin/bottle-scanner/phone/<token>): scan, then the photo goes back to the computer. */
export function PhoneScanPage() {
  const { token = '' } = useParams();
  const [h, setH] = useState<{ kind: BottleKind; name: string } | null>(null);
  const [error, setError] = useState('');
  const [scan, setScan] = useState<{ spin: boolean; file?: File } | null>(null);
  const [sent, setSent] = useState<'photo' | 'spin' | ''>('');
  useEffect(() => { document.title = 'Scan for Your Computer · Mise Academy'; api<{ kind: BottleKind; name: string }>(`/api/scan/handoff/${token}/open`, { method: 'POST' }).then(setH).catch((e) => setError((e as Error).message)); }, [token]);
  const send = async (body: { photo?: string; spin?: string[] }) => {
    setScan(null); setError('');
    try { await api(`/api/scan/handoff/${token}/photo`, { method: 'POST', body }); setSent(body.spin ? 'spin' : 'photo'); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="admin-page ab-phone-page">
      <p className="ab-step">Scan on My Phone</p>
      <h1>{sent ? 'Sent to your computer' : 'Scan the bottle'}</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && !h && <p className="muted">Opening…</p>}
      {h && !sent && (
        <>
          <p className="muted">{h.name ? <><strong>{h.name}</strong> · </> : null}{h.kind === 'wine' ? 'Wine' : 'Spirit'}. The cut-out goes straight back to Add a Bottle on your computer.</p>
          <div className="ab-tips">
            <strong>For a clean cut-out</strong>
            <ul><li>Stand it on the bar, a plain wall behind it.</li><li>No window or bright light behind it: it reflects in the glass.</li><li>Fill the guide, cap to base.</li></ul>
          </div>
          <div className="ab-foot-col">
            <button type="button" className="btn primary" onClick={() => setScan({ spin: false })}>Open the Camera</button>
            <button type="button" className="btn ghost" onClick={() => setScan({ spin: true })}>Photo by Photo</button>
            <label className="btn ghost">Upload a Photo Instead<input type="file" hidden accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setScan({ spin: false, file }); }} /></label>
          </div>
        </>
      )}
      {sent && <p className="ab-sent" role="status">{sent === 'spin' ? 'The spin is' : 'The photo is'} on your computer now. Finish the bottle there. You can close this.</p>}
      {sent && <button type="button" className="btn ghost" onClick={() => setSent('')}>Take It Again</button>}
      {scan && h && <BottleScanner name={h.name || 'Bottle'} kind={h.kind} spin={scan.spin} file={scan.file} onClose={() => setScan(null)}
        onDone={(url) => void send({ photo: url })} onSpin={(frames) => void send({ spin: frames })} />}
    </div>
  );
}

/* ------------------------------------------------------------------ on the bottle's own page */

/** "Scan This Bottle" on a wine or back-bar bottle's page with no photo yet (managers). Straight to the camera and the
 *  cut-out, then back to this page with the photo on it. */
export function ScanThisBottleButton({ col, id }: { col: string; id: number }) {
  const { user, bump } = useSession();
  const [e, setE] = useState<Entry | null>(null);
  const [scan, setScan] = useState(false);
  const [error, setError] = useState('');
  const ok = canEdit(user) && (col === 'wine' || col === 'shelf');
  useEffect(() => { setE(null); if (ok) api<Entry>(`/api/entries/${id}`).then(setE).catch(() => {}); }, [ok, id]);
  if (!ok || !e || e.data.bottle_img || e.data.spin?.length) return null;
  const kind: BottleKind = col === 'wine' ? 'wine' : 'spirit';
  const keep = async (patch: Record<string, unknown>) => {
    setScan(false);
    try {
      const data = { ...e.data, ...patch };
      if (kind === 'wine' && patch.bottle_img) data.source = `Scanned ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      setE(await api<Entry>(`/api/entries/${id}`, { method: 'PUT', body: { data } }));
      window.dispatchEvent(new CustomEvent('bt:entry-saved', { detail: { id } }));
      bump();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <>
      <button type="button" className="eip-edit scan-this" aria-haspopup="dialog" onClick={() => setScan(true)} title={error || undefined}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M10 7h4v3l1 2v5H9v-5l1-2V7z" /></svg>
        Scan This Bottle
      </button>
      {error && <span className="sr-only" role="alert">{error}</span>}
      {scan && <BottleScanner name={String(e.data.name || 'Bottle')} kind={kind} onClose={() => setScan(false)}
        onDone={(url) => void keep({ bottle_img: url })} onSpin={(frames) => void keep({ spin: frames, bottle_img: frames[0] })} />}
    </>
  );
}

/** After Add a Bottle: the NEW tag and the toast on the bottle's page (Figma 966:1822), with View List. */
export function AddedToast() {
  const location = useLocation();
  const nav = useNavigate();
  const added = (location.state as { added?: { kind: BottleKind; name: string; where: string; photo: boolean; list: string; listName: string } } | null)?.added;
  const [shown, setShown] = useState(added || null);
  useEffect(() => {
    if (!added) return;
    setShown(added);
    nav(location.pathname + location.search, { replace: true, state: null }); // once: a refresh doesn't show it again
    const t = window.setTimeout(() => setShown(null), 9000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added]);
  if (!shown) return null;
  return createPortal(
    <div className="ab-toast" role="status">
      <span className="ab-new">New</span>
      <span className="ab-toast-copy"><strong>Added to the {shown.kind === 'wine' ? 'wine list' : 'back bar'}</strong><small>{[shown.where, shown.photo ? 'with its photo' : 'no photo yet'].filter(Boolean).join(' · ')}</small></span>
      <Link to={shown.list} className="ab-toast-link">View List</Link>
      <button type="button" className="ab-toast-x" aria-label="Close" onClick={() => setShown(null)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>, document.body);
}
