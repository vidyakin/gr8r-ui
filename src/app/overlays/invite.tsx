/* Приглашение участников — порт inviteModal из overlays/modals.js.
   Заглушка: контракт уже используется по всему приложению, реализацию добавит отдельная задача. */
import * as React from 'react';
import { toast } from '@/components/ui';

export interface InviteApi {
  open(): void;
}

const Ctx = React.createContext<InviteApi | null>(null);

export function InviteProvider({ children }: { children: React.ReactNode }) {
  const api = React.useMemo<InviteApi>(() => ({ open: () => toast.info('Приглашение участников пока не перенесено') }), []);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useInvite() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useInvite: нет InviteProvider');
  return api;
}
