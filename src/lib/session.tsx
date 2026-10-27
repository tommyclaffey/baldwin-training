import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type IndexEntry, type User } from './api';
import staticIndex from '../content/index.json';

type Session = {
  user: User | null; setupNeeded: boolean; loaded: boolean;
  refresh: () => Promise<void>; setUser: (u: User | null) => void;
  index: IndexEntry[]; indexLoaded: boolean; reloadIndex: () => Promise<void>;
  version: number; bump: () => void;
};
const Ctx = createContext<Session>(null as never);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [setupNeeded, setSetup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState<IndexEntry[]>(staticIndex as IndexEntry[]);
  const [version, setVersion] = useState(0);
  const [indexLoaded, setIndexLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User | null; setupNeeded: boolean }>('/api/me');
      setUser(me.user); setSetup(me.setupNeeded);
    } catch { setUser(null); }
    setLoaded(true);
  }, []);
  const reloadIndex = useCallback(async () => {
    try { setIndex(await api<IndexEntry[]>('/api/index')); } catch { /* keep the built-in index */ }
    setIndexLoaded(true);
  }, []);
  useEffect(() => { refresh(); reloadIndex(); }, [refresh, reloadIndex]);

  return (
    <Ctx.Provider value={{ user, setupNeeded, loaded, refresh, setUser, index, indexLoaded, reloadIndex, version, bump: () => setVersion((v) => v + 1) }}>
      {children}
    </Ctx.Provider>
  );
}
