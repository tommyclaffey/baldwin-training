// The CMS in the admin: pick a page type, see its pages, add one or edit one by filling in its template.
import { focusImg } from '../lib/focus';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Video } from '../lib/api';
import { useSession } from '../lib/session';
import { Empty, ErrorNote, Field, Loading, PhotoField, Rows, SpinField, Text, VideoField, when } from './ui';

export type FieldDef = {
  key: string; label: string; type: string; max?: number; hint?: string; placeholder?: string; options?: string[];
  required?: boolean; section?: string; fields?: FieldDef[]; scan?: boolean;
};
export type Collection = { id: string; label: string; singular: string; prefix: string; group?: { key: string; values: string[] }; lists: string; fields: FieldDef[]; noPages?: boolean };
export type Entry = { id: number; collection: string; slug: string; data: Record<string, unknown>; sort: number; seeded: boolean; updated_at: string; edited: boolean; archivedAt?: string | null };

let cache: { collections: Record<string, Collection>; counts: Record<string, number> } | null = null;
export function useCollections() {
  const [data, setData] = useState(cache);
  const [error, setError] = useState('');
  const load = () => api<NonNullable<typeof cache>>('/api/collections').then((d) => { cache = d; setData(d); }).catch((e) => setError(e.message));
  useEffect(() => { if (!cache) load(); }, []);
  return { data, error, reload: load };
}

const GROUP_LABEL: Record<string, string> = { Stirred: 'Stirred · spirit-forward', Shaken: 'Shaken · sours and more', Tall: 'Tall and bubbly', Tropical: 'Tropical and tiki', Brunch: 'Brunch', Hot: 'Hot and after dinner' };

/* ---------- list of pages ---------- */
export function CollectionList() {
  const { col = '' } = useParams();
  const { data: cols, error: colErr } = useCollections();
  const c = cols?.collections[col];
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const session = useSession();
  const [archived, setArchived] = useState<Entry[] | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const load = () => {
    setError('');
    api<{ entries: Entry[] }>(`/api/entries?collection=${col}`).then((r) => setEntries(r.entries)).catch((e) => setError(e.message));
    api<{ entries: Entry[] }>(`/api/entries?collection=${col}&archived=1`).then((r) => setArchived(r.entries)).catch(() => setArchived([]));
  };
  useEffect(() => { setEntries(null); setShowArchive(false); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [col]);
  const restore = async (e: Entry) => {
    try { await api(`/api/entries/${e.id}/restore`, { method: 'POST' }); await session.reloadIndex(); session.bump(); load(); } catch (err) { setError((err as Error).message); }
  };
  const move = async (e: Entry, dir: number) => {
    try { await api(`/api/entries/${e.id}/move`, { method: 'POST', body: { dir } }); load(); } catch (err) { setError((err as Error).message); }
  };

  if (colErr) return <ErrorNote error={colErr} />;
  if (!cols) return <Loading />;
  if (!c) return <Empty title="Nothing here" />;
  const groups = c.group
    ? [...c.group.values.map((v) => ({ label: GROUP_LABEL[v] || v, items: (entries || []).filter((e) => e.data[c.group!.key] === v) })),
      { label: 'Other', items: (entries || []).filter((e) => !c.group!.values.includes(e.data[c.group!.key] as string)) }]
    : [{ label: '', items: entries || [] }];
  const page = (e: Entry) => !c.noPages;
  return (
    <div className="admin-page">
      <div className="editor-head">
        <div>
          <h1>{c.label}</h1>
          <p className="muted">{c.lists}</p>
        </div>
        <Link className="btn" to={`/admin/pages/${c.id}/new`}>New {cap(c.singular)}</Link>
      </div>
      {error && <ErrorNote error={error} retry={load} />}
      {!entries && !error && <Loading />}
      {entries && entries.length === 0 && <Empty title={`No ${c.label.toLowerCase()} yet`} />}
      {entries && groups.map((g) => g.items.length > 0 && (
        <section key={g.label} className="stack-sm">
          {g.label && <h2 className="sub">{g.label} <span className="muted small">· {g.items.length}</span></h2>}
          <div className="list">
            {g.items.map((e, i) => (
              <div key={e.id} className="list-row cms-row">
                {c.noPages ? null : (e.data.photo || e.data.bottle_img) ? <img src={(e.data.photo || e.data.bottle_img) as string} style={focusImg((e.data.photo || e.data.bottle_img) as string)} alt="" /> : <span className="thumb-empty" />}
                <Link className="grow" to={`/admin/pages/${c.id}/${e.id}`}>
                  <strong>{e.data.name as string}</strong>
                  <small>{(e.data.tagline as string) || (e.data.description as string) || subline(e.data) || '—'}</small>
                </Link>
                <small className="muted nowrap-sm">{c.noPages ? (e.edited ? `Edited ${when(e.updated_at)}` : 'From our menu') : !page(e) ? 'Food Matrix only' : e.edited ? `Edited ${when(e.updated_at)}` : c.id === 'recipe' ? 'From the Food Book' : 'From the design'}</small>
                {page(e) && <Link className="link-btn" to={'/' + e.slug} target="_blank">View</Link>}
                <div className="row-tools">
                  <button className="icon-btn" aria-label={`Move ${e.data.name} up`} disabled={i === 0} onClick={() => move(e, -1)}>↑</button>
                  <button className="icon-btn" aria-label={`Move ${e.data.name} down`} disabled={i === g.items.length - 1} onClick={() => move(e, 1)}>↓</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {archived && archived.length > 0 && (
        <section className="stack-sm">
          <button type="button" className="link-btn" aria-expanded={showArchive} onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? 'Hide' : 'Show'} the Archive ({archived.length})
          </button>
          {showArchive && (
            <div className="list">
              {archived.map((e) => (
                <div key={e.id} className="list-row cms-row archived">
                  {c.noPages ? null : e.data.photo ? <img src={e.data.photo as string} style={focusImg(e.data.photo as string)} alt="" /> : <span className="thumb-empty" />}
                  <span className="grow"><strong>{e.data.name as string}</strong><small>Archived {when(e.archivedAt || '')}</small></span>
                  <button type="button" className="btn ghost" onClick={() => void restore(e)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
/** A line for records with no description: style, how it's served, price. */
const subline = (d: Record<string, unknown>) => [
  Array.isArray(d.styles) ? (d.styles as string[]).join(', ') : d.style, d.serve === 'Draft' && d.tap ? `Tap ${d.tap}` : d.serve, d.limited ? 'Limited' : '', d.price ? `$${d.price}` : '',
].filter(Boolean).join(' · ');

/* ---------- the template form ---------- */
export function EntryEditor() {
  const { col = '', id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const session = useSession();
  const { data: cols } = useCollections();
  const c = cols?.collections[col];
  const [entry, setEntry] = useState<Entry | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setError(''); setSaved(false); setDirty(false);
    if (isNew) { setEntry(null); setData(null); return; }
    api<Entry>(`/api/entries/${id}`).then((e) => { setEntry(e); setData(e.data); }).catch((e) => setError(e.message));
  }, [id, isNew]);
  useEffect(() => { if (isNew && c && !data) setData(blank(c)); }, [isNew, c, data]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sections = useMemo(() => {
    const out: { name: string; fields: FieldDef[] }[] = [];
    for (const f of c?.fields || []) {
      const name = f.section || 'Details';
      const s = out.find((x) => x.name === name) || (out.push({ name, fields: [] }), out[out.length - 1]);
      s.fields.push(f);
    }
    return out;
  }, [c]);

  if (error && !data) return <ErrorNote error={error} />;
  if (!c || !data) return <Loading />;

  const set = (k: string, v: unknown) => { setData({ ...data, [k]: v }); setDirty(true); setSaved(false); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const out = isNew
        ? await api<Entry>('/api/entries', { method: 'POST', body: { collection: c.id, data } })
        : await api<Entry>(`/api/entries/${entry!.id}`, { method: 'PUT', body: { data } });
      setEntry(out); setData(out.data); setDirty(false); setSaved(true);
      await session.reloadIndex(); session.bump();
      if (isNew) nav(`/admin/pages/${c.id}/${out.id}`, { replace: true });
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  };
  const remove = async () => {
    if (!entry || !confirm(`Archive “${data.name}”? It leaves the book and every list. You can restore it from the Archive at the bottom of the list.`)) return;
    try {
      await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
      setDirty(false); await session.reloadIndex(); session.bump();
      nav(`/admin/pages/${c.id}`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="editor-head">
        <div>
          <Link className="crumb" to={`/admin/pages/${c.id}`}>← {c.label}</Link>
          <h1>{isNew ? `New ${c.singular}` : (data.name as string) || 'Untitled'}</h1>
          {entry && <p className="muted small">Address: /{entry.slug}</p>}
        </div>
        <div className="row">
          {entry && <Link className="btn ghost" to={'/' + entry.slug} target="_blank">View Page</Link>}
          <button className="btn" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create Page' : 'Save Changes'}</button>
        </div>
      </div>
      {error && <ErrorNote error={error} />}
      {saved && !dirty && <p className="ok" role="status">Saved. The page and every list it shows in are updated.</p>}
      {dirty && <p className="muted small">Unsaved changes</p>}

      {sections.map((s) => (
        <section key={s.name} className="card">
          <h2>{s.name}</h2>
          <div className="form-grid">
            {s.fields.map((f) => <div key={f.key} className={wide(f) ? 'span-2' : ''}>{renderField(f, data[f.key], (v) => set(f.key, v), { name: String(data.name || '') })}</div>)}
          </div>
        </section>
      ))}

      <div className="editor-foot">
        {entry ? <button type="button" className="link-btn danger" onClick={remove}>Archive This Page</button> : <span />}
        <button className="btn" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create Page' : 'Save Changes'}</button>
      </div>
    </form>
  );
}

export const wide = (f: FieldDef) => ['textarea', 'list', 'lines', 'photo', 'video', 'chips', 'tags', 'spin'].includes(f.type);

export function renderField(f: FieldDef, value: unknown, onChange: (v: unknown) => void, ctx: { name?: string } = {}): ReactNode {
  const listId = f.options?.length && f.type === 'text' ? `opts-${f.key}` : undefined;
  switch (f.type) {
    case 'text':
    case 'link':
      return (
        <>
          <Text label={f.label} hint={f.hint} max={f.max} placeholder={f.type === 'link' ? '/spirit/gin' : f.placeholder} list={f.type === 'link' ? 'cms-pages' : listId} value={(value as string) || ''} onChange={onChange} />
          {listId && <datalist id={listId}>{f.options!.map((o) => <option key={o} value={o} />)}</datalist>}
        </>
      );
    case 'textarea':
      return <Text area label={f.label} hint={f.hint} max={f.max} placeholder={f.placeholder} value={(value as string) || ''} onChange={onChange} />;
    case 'color':
      return (
        <Field label={f.label} hint={f.hint}>
          <span className="color-field"><input type="color" value={(value as string) || '#C49A6C'} onChange={(e) => onChange(e.target.value.toUpperCase())} /><code>{(value as string) || '—'}</code></span>
        </Field>
      );
    case 'select':
      return (
        <Field label={f.label} hint={f.hint}>
          <select value={(value as string) || f.options![0]} onChange={(e) => onChange(e.target.value)}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
      );
    case 'toggle':
      return <label className="check toggle-field"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> <span>{f.label}{f.hint && <small> · {f.hint}</small>}</span></label>;
    case 'photo':
      return <PhotoField label={f.label} hint={f.hint} value={(value as string) || ''} onChange={onChange} scanName={f.scan ? ctx.name || '' : undefined} />;
    case 'spin':
      return <SpinField label={f.label} hint={f.hint} value={(value as string[]) || []} onChange={onChange} name={ctx.name || ''} />;
    case 'video':
      return <VideoField label={f.label} hint={f.hint} value={(value as Video) || null} onChange={onChange} />;
    case 'tags':
      return <TagsField f={f} value={(value as string[]) || []} onChange={onChange} />;
    case 'chips': {
      const v = (value as string[]) || [];
      return (
        <fieldset className="chips">
          <legend>{f.label}</legend>
          {f.options!.map((o) => (
            <label key={o} className={'chip' + (v.includes(o) ? ' on' : '')}>
              <input type="checkbox" checked={v.includes(o)} onChange={(e) => onChange(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} />{o}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'lines':
      return (
        <Rows<string> label={f.label} hint={f.hint} rows={(value as string[]) || []} max={f.max || 10} make={() => ''} onChange={onChange}
          render={(r, s) => <Text label="Step" value={r} max={300} onChange={(x) => s(x as never)} />} />
      );
    case 'list':
      return (
        <Rows<Record<string, unknown>> label={f.label} hint={f.hint} rows={(value as Record<string, unknown>[]) || []} max={f.max || 10}
          make={() => Object.fromEntries(f.fields!.map((sf) => [sf.key, sf.type === 'toggle' ? false : '']))} onChange={onChange}
          render={(r, s) => (
            <div className="form-grid tight">
              {f.fields!.map((sf) => <div key={sf.key} className={sf.type === 'textarea' || sf.type === 'photo' ? 'span-2' : ''}>{renderField(sf, r[sf.key], (v) => s({ [sf.key]: v }))}</div>)}
            </div>
          )} />
      );
    default:
      return null;
  }
}

function TagsField({ f, value, onChange }: { f: FieldDef; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const parse = (t: string) => t.split(',').map((s) => s.trim()).filter(Boolean);
  // only follow the saved value when it changed from outside (not while typing)
  useEffect(() => { if (parse(text).join('|') !== value.join('|')) setText(value.join(', ')); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value.join('|')]);
  return <Text label={f.label} hint={f.hint || 'Separate with commas.'} placeholder={f.placeholder} value={text} onChange={(t) => { setText(t); onChange(parse(t)); }} />;
}

export function blank(c: Collection) {
  const d: Record<string, unknown> = {};
  for (const f of c.fields) d[f.key] = f.type === 'select' ? f.options![0] : ['list', 'lines', 'tags', 'chips', 'spin'].includes(f.type) ? [] : f.type === 'toggle' ? false : f.type === 'video' ? null : '';
  return d;
}

/** Page addresses for the "Links to" boxes. */
export function PageOptions() {
  const { index } = useSession();
  return <datalist id="cms-pages">{index.map((e) => <option key={e.slug} value={'/' + e.slug}>{e.name}</option>)}</datalist>;
}
