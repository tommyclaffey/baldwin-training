// Small fetch wrapper. Writes carry X-BT so the server can block cross-site requests.
import type { Brand } from './theme';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); if (status === 401 || status === 403) DENIED.add(message); } }
// Nov 15 (audit 24): a "you can't do that" answer (401/403) isn't fixed by trying again. Screens keep errors as plain text,
// so the messages of refusals are remembered here, and the shared error notes leave out Try Again for them.
const DENIED = new Set<string>();
export const isDenied = (message: string | null | undefined) => !!message && DENIED.has(message);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-BT': '1' },
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || 'Something went wrong. Try again.');
  return data as T;
}

/** Uploads a file with progress. Resolves to the saved media record. */
export function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-BT', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data: { error?: string } & MediaItem;
      try { data = JSON.parse(xhr.responseText); } catch { data = { error: 'Upload failed.' } as never; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data.error || 'Upload failed. Try again.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload stopped. Check your connection and try again.'));
    xhr.send(file);
  });
}

/** Adds (or replaces) captions on an uploaded video: a .vtt as is, or an .srt the server turns into WebVTT (Nov 14). */
export async function uploadCaptions(mediaId: number, file: File): Promise<MediaItem> {
  if (!/\.(vtt|srt)$/i.test(file.name)) throw new ApiError(415, 'Choose a captions file: .vtt or .srt.');
  const res = await fetch(`/api/media/${mediaId}/captions`, { method: 'PUT', credentials: 'same-origin', body: file,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Filename': encodeURIComponent(file.name), 'X-BT': '1' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || 'The captions didn’t upload. Try again.');
  return data as MediaItem;
}

export type MediaItem = { id: number; kind: 'file' | 'youtube'; title: string; url: string | null; mime: string | null; size: number | null; youtubeId: string | null; createdAt: string;
  /** The captions file (WebVTT) on an uploaded video, if it has one. */
  captions?: string | null };
export type Video = { kind: 'youtube'; youtubeId: string; title?: string } | { kind: 'file'; url: string; mime?: string; title?: string };
export type Role = 'superadmin' | 'owner' | 'manager' | 'staff';
export type User = { demo?: boolean; hq?: boolean; /** the look the store being worked in wears (server/looks.mjs; Nov 17: per store) */ brand?: Brand; /** a manager promoted from staff, still on their PIN (Nov 16) */ pinSignIn?: boolean;
  id: number; name: string; email: string | null; role: Role; companyId: number | null; companyName: string | null;
  totpOn: boolean; superPrimary: boolean; impersonatedBy: number | null; workingIn?: number; workingInName?: string | null;
  /** Mise team role (super admins only, Nov 16) and view only (Support, also while signed in as someone). */
  teamRole?: TeamRole | null; viewOnly?: boolean;
  storeId: number | null; store?: Store | null; canSwitchStore?: boolean; stores?: Store[];
};
export type Store = { id: number; name: string; slug: string; bookReady: boolean; /** wears a look of its own (Nov 17) */ ownLook?: boolean };
/** Privacy, Terms and Help (Nov 16): public once content/legal.md's blanks are filled. */
export type Legal = { public: boolean; supportEmail: string | null };
/** Whether an invite or promotion link also went by email (Nov 16). reason: off (email isn't set up) · demo · limit · failed */
export type MailStatus = { on: boolean; sent: boolean; reason: 'off' | 'demo' | 'limit' | 'failed' | null };
export const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super admin', owner: 'Owner', manager: 'Manager', staff: 'Staff' };
/** The Mise team (Nov 16): Owner (Tommy), Manager, Support. */
export type TeamRole = 'owner' | 'manager' | 'support';
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { owner: 'Owner', manager: 'Manager', support: 'Support' };
export const canEdit = (u: User | null | undefined) => !!u && u.role !== 'staff';
export type IndexEntry = { id: string; file: string; slug: string; name: string; title: string; section: string; nav: string; text: string; thumb?: string; blurb?: string };
