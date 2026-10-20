/* Состояние воркспейса: один reducer вместо прямых мутаций глобального объекта S из оригинала.
   Компоненты читают данные через useWorkspace() и меняют их только через dispatch(action). */
import * as React from 'react';
import { seed } from './seed';
import type { Status, WorkspaceData } from './types';

export type Action = { type: 'task/toggleDone'; id: string } | { type: 'task/setStatus'; id: string; status: Status };

function reducer(d: WorkspaceData, a: Action): WorkspaceData {
  switch (a.type) {
    case 'task/toggleDone':
      return {
        ...d,
        tasks: d.tasks.map(t =>
          t.id !== a.id ? t : t.status === 'done' ? { ...t, status: 'todo', completedAt: undefined, updated: Date.now() } : { ...t, status: 'done', completedAt: Date.now(), updated: Date.now() },
        ),
      };
    case 'task/setStatus':
      return { ...d, tasks: d.tasks.map(t => (t.id === a.id ? { ...t, status: a.status, updated: Date.now() } : t)) };
  }
}

const Ctx = React.createContext<{ data: WorkspaceData; dispatch: React.Dispatch<Action> } | null>(null);

export function WorkspaceProvider({ children, initial }: { children: React.ReactNode; initial?: WorkspaceData }) {
  const [data, dispatch] = React.useReducer(reducer, initial, i => i ?? seed());
  const value = React.useMemo(() => ({ data, dispatch }), [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useWorkspace() нужно вызывать внутри <WorkspaceProvider>');
  return c;
}
