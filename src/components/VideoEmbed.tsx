import type { Video } from '../lib/api';

/** Plays an uploaded video or a YouTube link, filling its box. */
export function VideoEmbed({ video, title }: { video: Video; title?: string }) {
  const label = video.title || title || 'Training video';
  if (video.kind === 'youtube') {
    return (
      <iframe
        className="video-embed"
        src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?rel=0`}
        title={label}
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  return <video className="video-embed" src={video.url} controls preload="metadata" playsInline aria-label={label} />;
}
