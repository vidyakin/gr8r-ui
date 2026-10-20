/* Форма новой задачи — порт taskModal из overlays/modals.js.
   Заглушка: контракт уже используется по всему приложению, реализацию добавит отдельная задача. */
import * as React from 'react';
import { toast } from '@/components/ui';
import type { Task } from '../data/types';

export type TaskDefaults = Partial<Pick<Task, 'project' | 'status' | 'assignee' | 'priority' | 'due'>>;

export interface TaskFormApi {
  /** Открыть форму новой задачи с предзаполненными полями */
  open(defaults?: TaskDefaults): void;
}

const Ctx = React.createContext<TaskFormApi | null>(null);

export function TaskFormProvider({ children }: { children: React.ReactNode }) {
  const api = React.useMemo<TaskFormApi>(() => ({ open: () => toast.info('Форма новой задачи пока не перенесена') }), []);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTaskForm() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useTaskForm: нет TaskFormProvider');
  return api;
}
