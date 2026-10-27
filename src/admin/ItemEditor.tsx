// Add or edit a dish (recipe) or a house cocktail. Each one becomes its own page, built from the design.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Video } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote, ListText, Loading, PhotoField, Rows, Text, VideoField, Field } from './ui';

export type ItemType = 'dish' | 'cocktail';
type Data = Record<string, unknown> & { name?: string };
export type Item = { id: number; type: ItemType; slug: string; data: Data; updated_at: string };

const GLASSES = ['Rocks', 'Double rocks', 'Coupe', 'Nick & Nora', 'Martini', 'Highball', 'Collins', 'Copper mug', 'Wine glass', 'Flute', 'Julep cup', 'Tiki mug'];
const METHODS = ['Stirred', 'Shaken', 'Built', 'Swizzled', 'Blended', 'Thrown', 'Dry shaken'];
const ICE = ['Large cube', 'Cubed', 'Crushed', 'Pebble', 'Collins spear', 'Up (no ice)'];
const ALLERGENS = ['Dairy', 'Egg', 'Fish', 'Shellfish', 'Tree nuts', 'Peanuts', 'Wheat', 'Gluten', 'Soy', 'Sesame', 'Alcohol'];

export const typeLabel = (t: ItemType) => (t === 'dish' ? 'Recipe' : 'House cocktail');

export function ItemEditor({ type }: { type: ItemType }) {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const session = useSession();
  const [data, setData] = useState<Data | null>(isNew ? blank(type) : null);
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const base = type === 'dish' ? '/admin/recipes' : '/admin/cocktails';

  const load = () => {
    setError('');
    api<Item>(`/api/items/${id}`).then((it) => { setItem(it); setData(it.data); }).catch((e) => setError(e.message));
  };
  useEffect(() => { if (!isNew) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error && !data) return <ErrorNote error={error} retry={load} />;
  if (!data) return <Loading />;

  const set = (patch: Data) => { setData({ ...data, ...patch }); setDirty(true); setSaved(false); };
  const v = (k: string) => data[k] as string | undefined;
  const t = (k: string, label: string, opts: { hint?: string; max?: number; area?: boolean; placeholder?: string; list?: string } = {}) =>
    <Text label={label} {...opts} value={v(k)} onChange={(x) => set({ [k]: x })} />;

  const save = async () => {
    setSaving(true); setError('');
    try {
      const out = isNew
        ? await api<Item>('/api/items', { method: 'POST', body: { type, data } })
        : await api<Item>(`/api/items/${id}`, { method: 'PUT', body: { data } });
      setItem(out); setData(out.data); setDirty(false); setSaved(true);
      await session.reloadIndex(); session.bump();
      if (isNew) nav(`${base}/${out.id}`, { replace: true });
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  };
  const remove = async () => {
    if (!item || !confirm(`Delete “${data.name}”? Its page goes away for everyone. This can’t be undone.`)) return;
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      setDirty(false);
      await session.reloadIndex(); session.bump();
      nav(base);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="editor-head">
        <div>
          <Link className="crumb" to={base}>← {type === 'dish' ? 'Recipes' : 'House cocktails'}</Link>
          <h1>{isNew ? `New ${typeLabel(type).toLowerCase()}` : data.name || 'Untitled'}</h1>
        </div>
        <div className="row">
          {item && <Link className="btn ghost" to={'/' + item.slug} target="_blank">View Page</Link>}
          <button className="btn" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add It' : 'Save Changes'}</button>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      {saved && !dirty && <p className="ok" role="status">Saved. The page is updated.</p>}
      {dirty && <p className="muted small">Unsaved changes</p>}

      <section className="card">
        <h2>The basics</h2>
        <div className="grid2">
          {t('name', 'Name', { max: 120 })}
          {t('tagline', 'One line under the name', { max: 120, placeholder: type === 'dish' ? 'Braised short rib, root vegetables, red wine jus' : 'Gin, raspberry, lemon, egg white' })}
        </div>
        {t('description', 'Description', { area: true, max: 800 })}
        <PhotoField label="Main photo" hint="The first thing people see on the page. Landscape works best." value={v('photo')} onChange={(x) => set({ photo: x })} />
        {type === 'dish' ? <DishBasics data={data} set={set} /> : <CocktailBasics data={data} set={set} />}
      </section>

      {type === 'dish' ? <DishBody data={data} set={set} /> : <CocktailBody data={data} set={set} />}

      <section className="card">
        <h2>Say it at the table</h2>
        {t('say', 'How a server describes it', { area: true, max: 800, hint: 'Write it the way you’d say it to a guest.' })}
      </section>

      <div className="editor-foot">
        {item ? <button type="button" className="link-btn danger" onClick={remove}>Delete This {type === 'dish' ? 'Recipe' : 'Cocktail'}</button> : <span />}
        <button className="btn" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add It' : 'Save Changes'}</button>
      </div>
    </form>
  );
}

type Part = { data: Data; set: (p: Data) => void };
const arr = <T,>(x: unknown) => (Array.isArray(x) ? (x as T[]) : []);

function DishBasics({ data, set }: Part) {
  const allergens = arr<string>(data.allergens);
  return (
    <>
      <div className="grid3">
        <Field label="Course">
          <select value={(data.course as string) || 'Plates'} onChange={(e) => set({ course: e.target.value })}>
            <option>Passed Bites</option><option>Plates</option><option>Dessert</option>
          </select>
        </Field>
        <Text label="Station" value={data.station as string} max={40} placeholder="Sauté" onChange={(x) => set({ station: x })} />
        <Text label="Tasting score" value={data.score as string} max={10} placeholder="4.6" hint="Out of 5. Leave empty if not tasted yet." onChange={(x) => set({ score: x })} />
      </div>
      <label className="check"><input type="checkbox" checked={!!data.signature} onChange={(e) => set({ signature: e.target.checked })} /> Signature dish</label>
      <fieldset className="chips">
        <legend>Allergens</legend>
        {ALLERGENS.map((a) => (
          <label key={a} className={'chip' + (allergens.includes(a) ? ' on' : '')}>
            <input type="checkbox" checked={allergens.includes(a)} onChange={(e) => set({ allergens: e.target.checked ? [...allergens, a] : allergens.filter((x) => x !== a) })} />
            {a}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function DishBody({ data, set }: Part) {
  type Comp = { component: string; portion: string; hold: string };
  type Step = { title: string; detail: string; time: string };
  type Plate = { name: string; note: string };
  type Photo = { img: string; caption: string };
  return (
    <>
      <section className="card">
        <h2>The build</h2>
        <Rows<Comp> label="Components" hint="What goes on the plate, how much, and how it’s held." rows={arr(data.components)} max={12}
          make={() => ({ component: '', portion: '', hold: '' })} onChange={(r) => set({ components: r })}
          render={(r, s) => (
            <div className="grid3">
              <Text label="Component" value={r.component} max={80} onChange={(x) => s({ component: x })} />
              <Text label="Portion" value={r.portion} max={80} onChange={(x) => s({ portion: x })} />
              <Text label="Hold" value={r.hold} max={80} placeholder="Hot well, 2 hrs" onChange={(x) => s({ hold: x })} />
            </div>
          )} />
        <Rows<Step> label="Steps" rows={arr(data.steps)} max={12} make={() => ({ title: '', detail: '', time: '' })} onChange={(r) => set({ steps: r })}
          render={(r, s) => (
            <>
              <div className="grid2">
                <Text label="Step" value={r.title} max={80} onChange={(x) => s({ title: x })} />
                <Text label="Time (optional)" value={r.time} max={30} placeholder="4 min" onChange={(x) => s({ time: x })} />
              </div>
              <Text label="Detail" area value={r.detail} max={500} onChange={(x) => s({ detail: x })} />
            </>
          )} />
      </section>
      <section className="card">
        <h2>Plating</h2>
        <PhotoField label="Plate photo" hint="Top-down works best for the plating guide." value={data.platePhoto as string} onChange={(x) => set({ platePhoto: x })} />
        <Rows<Plate> label="Where things go (up to 4)" rows={arr(data.plating)} max={4} make={() => ({ name: '', note: '' })} onChange={(r) => set({ plating: r })}
          render={(r, s) => (
            <div className="grid2">
              <Text label="Item" value={r.name} max={60} onChange={(x) => s({ name: x })} />
              <Text label="Note" value={r.note} max={120} placeholder="12 o’clock, leaning on the purée" onChange={(x) => s({ note: x })} />
            </div>
          )} />
        <div className="grid2">
          <Text label="Pairs with" value={data.pairing as string} max={80} placeholder="Pinot Noir" onChange={(x) => set({ pairing: x })} />
          <Text label="Why it works" value={data.pairingNote as string} max={200} onChange={(x) => set({ pairingNote: x })} />
        </div>
      </section>
      <section className="card">
        <h2>Watch it made</h2>
        <p className="muted small">Shows lower on the page, under the build. The photo stays first.</p>
        <VideoField label="Video" hint="Upload a file, or paste a YouTube link." value={data.video as Video | null} onChange={(x) => set({ video: x })} />
        <div className="grid2">
          <Text label="Video title" value={data.videoTitle as string} max={120} onChange={(x) => set({ videoTitle: x })} />
          <Text label="Note under the video" value={data.videoNote as string} max={500} onChange={(x) => set({ videoNote: x })} />
        </div>
      </section>
      <section className="card">
        <h2>More photos</h2>
        <Rows<Photo> label="Photos (up to 8)" rows={arr(data.photos)} max={8} make={() => ({ img: '', caption: '' })} onChange={(r) => set({ photos: r })}
          render={(r, s) => (
            <div className="grid2">
              <PhotoField label="Photo" value={r.img} onChange={(x) => s({ img: x })} />
              <Text label="Caption" value={r.caption} max={80} onChange={(x) => s({ caption: x })} />
            </div>
          )} />
      </section>
    </>
  );
}

function CocktailBasics({ data, set }: Part) {
  const d = (k: string) => data[k] as string | undefined;
  return (
    <>
      <datalist id="glasses">{GLASSES.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="methods">{METHODS.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="ice">{ICE.map((g) => <option key={g} value={g} />)}</datalist>
      <div className="grid4">
        <Text label="Glass" list="glasses" value={d('glass')} max={60} hint="Picks the matching glass drawing." onChange={(x) => set({ glass: x })} />
        <Text label="Method" list="methods" value={d('method')} max={60} onChange={(x) => set({ method: x })} />
        <Text label="Ice" list="ice" value={d('ice')} max={60} onChange={(x) => set({ ice: x })} />
        <Text label="Garnish" value={d('garnish')} max={80} onChange={(x) => set({ garnish: x })} />
      </div>
      <ListText label="Tags" placeholder="House, Gin, Bright" hint="Separate with commas." value={arr<string>(data.tags)} onChange={(x) => set({ tags: x })} />
    </>
  );
}

function CocktailBody({ data, set }: Part) {
  const { index } = useSession();
  const pages = index.filter((e) => /^(spirits|liqueurs|bar-basics|wine)\//.test(e.slug) || e.slug.startsWith('the-bar'));
  type B = { amount: string; ingredient: string; spirit: boolean; link: string };
  const d = (k: string) => data[k] as string | undefined;
  return (
    <>
      <datalist id="pages">{pages.map((e) => <option key={e.slug} value={'/' + e.slug}>{e.name}</option>)}</datalist>
      <section className="card">
        <h2>Our build</h2>
        <Rows<B> label="Ingredients" hint="Tick the main spirit so it’s highlighted. Link an ingredient to its page if there is one." rows={arr(data.build)} max={12}
          make={() => ({ amount: '', ingredient: '', spirit: false, link: '' })} onChange={(r) => set({ build: r })}
          render={(r, s) => (
            <div className="grid-build">
              <Text label="Amount" value={r.amount} max={30} placeholder="2 oz" onChange={(x) => s({ amount: x })} />
              <Text label="Ingredient" value={r.ingredient} max={80} onChange={(x) => s({ ingredient: x })} />
              <Text label="Links to (optional)" list="pages" value={r.link} max={200} placeholder="/spirits/gin" onChange={(x) => s({ link: x })} />
              <label className="check"><input type="checkbox" checked={!!r.spirit} onChange={(e) => s({ spirit: e.target.checked })} /> Main spirit</label>
            </div>
          )} />
        <Rows<string> label="Steps" rows={arr(data.steps)} max={12} make={() => ''} onChange={(r) => set({ steps: r })}
          render={(r, s) => <Text label="Step" value={r} max={300} onChange={(x) => s(x as never)} />} />
        <Text label="How it tastes" area value={d('tasteLine')} max={300} onChange={(x) => set({ tasteLine: x })} />
      </section>
      <section className="card">
        <h2>The spirit</h2>
        <div className="grid2">
          <Text label="Spirit name" value={d('spiritName')} max={80} placeholder="Gin · London Dry" onChange={(x) => set({ spiritName: x })} />
          <Text label="Links to" list="pages" value={d('spiritLink')} max={200} placeholder="/spirits/gin" onChange={(x) => set({ spiritLink: x })} />
        </div>
        <Text label="Why this spirit" area value={d('spiritLine')} max={300} onChange={(x) => set({ spiritLine: x })} />
        <Text label="Link label" value={d('spiritLinkLabel')} max={60} placeholder="Learn gin" onChange={(x) => set({ spiritLinkLabel: x })} />
      </section>
      <section className="card">
        <h2>From the tasting</h2>
        <div className="grid3">
          <Text label="Score" value={d('score')} max={10} placeholder="4.5" hint="Out of 5." onChange={(x) => set({ score: x })} />
          <Text label="Status" value={d('status')} max={30} placeholder="On the menu" onChange={(x) => set({ status: x })} />
          <Text label="Pairs with" value={d('pairs')} max={80} onChange={(x) => set({ pairs: x })} />
        </div>
        <Text label="Guest note" area value={d('note')} max={600} onChange={(x) => set({ note: x })} />
      </section>
      <section className="card">
        <h2>The story</h2>
        <p className="muted small">Shows lower on the page. The photo stays first.</p>
        <Text label="Where it came from" area value={d('story')} max={1500} onChange={(x) => set({ story: x })} />
        <VideoField label="Video" hint="Upload a file, or paste a YouTube link." value={data.video as Video | null} onChange={(x) => set({ video: x })} />
      </section>
    </>
  );
}

function blank(type: ItemType): Data {
  return type === 'dish'
    ? { name: '', course: 'Plates', allergens: [], components: [], steps: [], plating: [], photos: [], video: null }
    : { name: '', build: [], steps: [], tags: [], video: null };
}
