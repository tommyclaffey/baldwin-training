import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type IndexEntry, type User } from './api';
import { markDemo } from './demo';
import { setSessionBrand } from './theme';

type Session = {
  user: User | null; setupNeeded: boolean; superSetupNeeded: boolean; loaded: boolean;
  refresh: () => Promise<void>; setUser: (u: User | null) => void;
  index: IndexEntry[]; indexLoaded: boolean; reloadIndex: () => Promise<void>;
  version: number; bump: () => void;
};
const Ctx = createContext<Session>(null as never);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [setupNeeded, setSetup] = useState(false);
  const [superSetupNeeded, setSuperSetup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The page index comes from the server, to signed-in people only (it isn't in the public app bundle).
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [indexLoaded, setIndexLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User | null; setupNeeded: boolean; superSetupNeeded: boolean }>('/api/me');
      markDemo(!!me.user?.demo);
      setSessionBrand(me.user?.brand); // Nov 11: the look follows the company
      setUser(me.user); setSetup(me.setupNeeded); setSuperSetup(me.superSetupNeeded);
    } catch { setUser(null); setSessionBrand(null); }
    setLoaded(true);
  }, []);
  const reloadIndex = useCallback(async () => {
    try { setIndex(await api<IndexEntry[]>('/api/index')); } catch { /* keep the built-in index */ }
    setIndexLoaded(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // Load the index whenever someone signs in (or someone else does on this device).
  useEffect(() => { if (user) reloadIndex(); else { setIndex([]); setIndexLoaded(false); } }, [user?.id, user?.workingIn, reloadIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ user, setupNeeded, superSetupNeeded, loaded, refresh, setUser, index, indexLoaded, reloadIndex, version, bump: () => setVersion((v) => v + 1) }}>
      {children}
    </Ctx.Provider>
  );
}
