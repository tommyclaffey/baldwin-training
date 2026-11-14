import { useEffect, useState } from 'react';
import { api, type Video } from '../lib/api';

// Captions (Nov 14, server/captions.mjs): an uploaded video's captions are looked up by its address, once per page load,
// and added as a captions track. No `default`, so each browser (and the viewer's caption setting) decides if they show.
const known = new Map<string, Promise<string | null>>();
export const forgetCaptions = (url?: string) => { if (url) known.delete(url); else known.clear(); };
function captionsOf(url: string) {
  let p = known.get(url);
  if (!p) { p = api<{ captions: string | null }>(`/api/media/captions?video=${encodeURIComponent(url)}`).then((r) => r.captions).catch(() => null); known.set(url, p); }
  return p;
}

/** Plays an uploaded video or a YouTube link, filling its box. */
export function VideoEmbed({ video, title, start = 0 }: { video: Video; title?: string; start?: number }) {
  const label = video.title || title || 'Training video';
  const fileUrl = video.kind === 'file' ? video.url : null;
  const [cc, setCc] = useState<{ for: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!fileUrl) return;
    let live = true;
    void captionsOf(fileUrl).then((url) => { if (live) setCc({ for: fileUrl, url }); });
    return () => { live = false; };
  }, [fileUrl]);
  if (video.kind === 'youtube') {
    return (
      <iframe
        className="video-embed"
        src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?rel=0${start ? `&start=${start}&autoplay=1` : ''}`}
        title={label}
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  const track = cc && cc.for === video.url ? cc.url : null;
  return (
    <video className="video-embed" src={start ? `${video.url}#t=${start}` : video.url} autoPlay={!!start} controls preload="metadata" playsInline aria-label={label}>
      {track && <track key={track} kind="captions" src={track} srcLang="en" label="English" />}
    </video>
  );
}
