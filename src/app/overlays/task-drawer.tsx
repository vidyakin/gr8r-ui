/* Карточка задачи (drawer) — порт overlays/drawer.js.
   Заглушка: контракт уже используется по всему приложению, реализацию добавит отдельная задача. */
import * as React from 'react';
import { toast } from '@/components/ui';
import { useWorkspace } from '../data/store';

export interface TaskDrawerApi {
  /** Открыть карточку задачи; subId — сразу открыть подзадачу */
  open(taskId: string, subId?: string): void;
  close(): void;
}

const Ctx = React.createContext<TaskDrawerApi | null>(null);

export function TaskDrawerProvider({ children }: { children: React.ReactNode }) {
  const { data } = useWorkspace();
  const tasks = React.useRef(data.tasks);
  tasks.current = data.tasks;
  const api = React.useMemo<TaskDrawerApi>(
    () => ({
      open(taskId) {
        const t = tasks.current.find(x => x.id === taskId);
        toast.info(`Карточка задачи ${t?.key ?? ''} пока не перенесена`);
      },
      close() {},
    }),
    [],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTaskDrawer() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTaskDrawer: нет TaskDrawerProvider');
  return api;
}
