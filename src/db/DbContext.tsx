import { createContext, useContext, type ReactNode } from 'react';
import type { Db } from './client';

const Ctx = createContext<Db | null>(null);

export function DbProvider({ db, children }: { db: Db; children: ReactNode }) {
  return <Ctx.Provider value={db}>{children}</Ctx.Provider>;
}

export function useDb(): Db {
  const db = useContext(Ctx);
  if (!db) throw new Error('useDb called outside DbProvider');
  return db;
}
