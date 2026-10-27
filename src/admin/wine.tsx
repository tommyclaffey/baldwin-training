// Wine videos: the "Learn more about …" video on every wine style, country, grape and region page,
// and the video on each wine on the list (it plays from the play button on the wine's photo).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Video } from '../lib/api';
import { ErrorNote, Loading, Text, VideoField, when } from './ui';

type Item = { key: string; name: string; slug: string; video: Video | null; note: string; updatedAt?: string };
type Group = { label: string; items: Item[] };

export function WineVideos() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { setError(''); api<{ groups: Group[] }>('/api/wine-videos').then((r) => setGroups(r.groups)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const saved = (key: string, it: Partial<Item>) => setGroups((gs) => gs && gs.map((g) => ({ ...g, items: g.items.map((x) => (x.key === key ? { ...x, ...it } : x)) })));

  const total = groups?.reduce((s, g) => s + g.items.length, 0) || 0;
  const done = groups?.reduce((s, g) => s + g.items.filter((x) => x.video).length, 0) || 0;
  return (
    <div className="admin-page">
      <div className="editor-head">
        <div>
          <h1>Wine Videos</h1>
          <p className="muted">Every wine style, country, grape and region page has a <strong>Learn more about …</strong> section. Add a video here and it plays there. A wine on the list gets a play button on its photo.</p>
        </div>
        {groups && <span className="admin-pill">{done} of {total} have a video</span>}
      </div>
      {error && <ErrorNote error={error} retry={load} />}
      {!groups && !error && <Loading />}
      {groups?.map((g) => (
        <section key={g.label} className="stack-sm">
          <h2 className="sub">{g.label} <span className="muted small">· {g.items.filter((x) => x.video).length} of {g.items.length}</span></h2>
          <div className="list">
            {g.items.map((it) => (
              <div key={it.key} className="list-row wine-row">
                <div className="wine-row-top">
                  <span className={'dot-status' + (it.video ? ' on' : '')} aria-hidden="true" />
                  <div className="grow">
                    <strong>{it.name}</strong>
                    <small>{it.video ? `${it.video.title || (it.video.kind === 'youtube' ? 'YouTube video' : 'Uploaded video')} · ${when(it.updatedAt)}` : 'No video yet'}</small>
                  </div>
                  <Link className="link-btn" to={'/' + it.slug} target="_blank">View</Link>
                  <button className="btn ghost" onClick={() => setOpen(open === it.key ? null : it.key)} aria-expanded={open === it.key}>
                    {open === it.key ? 'Close' : it.video ? 'Edit' : 'Add Video'}
                  </button>
                </div>
                {open === it.key && <Editor item={it} onSaved={(v) => saved(it.key, v)} onDone={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Editor({ item, onSaved, onDone }: { item: Item; onSaved: (v: Partial<Item>) => void; onDone: () => void }) {
  const [video, setVideo] = useState<Video | null>(item.video);
  const [note, setNote] = useState(item.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isWine = item.key.startsWith('wine:');
  const save = async (v: Video | null) => {
    setBusy(true); setError('');
    try {
      const r = await api<{ video: Video | null; note: string }>('/api/wine-videos', { method: 'PUT', body: { key: item.key, video: v, note } });
      onSaved({ video: r.video, note: r.note, updatedAt: new Date().toISOString() });
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="wine-editor stack-sm">
      <VideoField label={isWine ? `Video for ${item.name}` : `Learn more about ${item.name}`} value={video} onChange={setVideo}
        hint="Upload a file or paste a YouTube link. Long videos are better on YouTube." />
      {!isWine && (
        <Text label="Line next to the video (optional)" value={note} onChange={setNote} max={400} area
          hint="Leave blank to use the standard line, e.g. “A short video on Cabernet: how it tastes, where it grows…”" />
      )}
      {error && <ErrorNote error={error} />}
      <div className="row">
        <button className="btn" disabled={busy || (!video && !item.video)} onClick={() => save(video)}>{busy ? 'Saving…' : !video && item.video ? 'Remove Video' : 'Save'}</button>
        <button className="link-btn" style={{ alignSelf: 'center' }} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
