// Nov 4: leaving the demo puts your own sign-in back (the server kept it aside when the demo started).
import { api } from './api';

export async function exitDemo(refresh: () => Promise<unknown>) {
  await api('/api/demo/exit', { method: 'POST' }).catch(() => {});
  await refresh();
  location.assign('/');
}
