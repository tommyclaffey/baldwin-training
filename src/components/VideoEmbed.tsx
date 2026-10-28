import type { Video } from '../lib/api';

/** Plays an uploaded video or a YouTube link, filling its box. */
export function VideoEmbed({ video, title, start = 0 }: { video: Video; title?: string; start?: number }) {
  const label = video.title || title || 'Training video';
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
  return <video className="video-embed" src={start ? `${video.url}#t=${start}` : video.url} autoPlay={!!start} controls preload="metadata" playsInline aria-label={label} />;
}
