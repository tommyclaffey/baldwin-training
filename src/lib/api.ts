// Small fetch wrapper. Writes carry X-BT so the server can block cross-site requests.
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

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

export type MediaItem = { id: number; kind: 'file' | 'youtube'; title: string; url: string | null; mime: string | null; size: number | null; youtubeId: string | null; createdAt: string };
export type Video = { kind: 'youtube'; youtubeId: string; title?: string } | { kind: 'file'; url: string; mime?: string; title?: string };
export type Role = 'superadmin' | 'owner' | 'manager' | 'staff';
export type User = {
  id: number; name: string; email: string | null; role: Role; companyId: number | null; companyName: string | null;
  totpOn: boolean; superPrimary: boolean; impersonatedBy: number | null; workingIn?: number; workingInName?: string | null;
};
export const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super admin', owner: 'Owner', manager: 'Manager', staff: 'Staff' };
export const canEdit = (u: User | null | undefined) => !!u && u.role !== 'staff';
export type IndexEntry = { id: string; file: string; slug: string; name: string; title: string; section: string; nav: string; text: string; thumb?: string; blurb?: string };
