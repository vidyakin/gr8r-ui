/* Формы проекта — порт projectModal, shareModal и saveView из overlays/modals.js.
   Заглушка: контракт уже используется по всему приложению, реализацию добавит отдельная задача. */
import * as React from 'react';
import { toast } from '@/components/ui';

export interface ProjectFormsApi {
  /** Новый проект */
  create(): void;
  /** Редактирование проекта (Rename & edit, Project settings, Edit в About) */
  edit(projectId: string): void;
  /** Доступ к проекту: участники и ссылка */
  share(projectId: string): void;
  /** Сохранить текущие фильтры как вид проекта */
  saveView(projectId: string): void;
}

const Ctx = React.createContext<ProjectFormsApi | null>(null);

export function ProjectFormsProvider({ children }: { children: React.ReactNode }) {
  const api = React.useMemo<ProjectFormsApi>(() => {
    const soon = (what: string) => () => toast.info(`${what} пока не перенесено`);
    return { create: soon('Создание проекта'), edit: soon('Редактирование проекта'), share: soon('Шаринг проекта'), saveView: soon('Сохранение вида') };
  }, []);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProjectForms() {
  const api = React.useContext(Ctx);
  if (!api) throw new Error('useProjectForms: нет ProjectFormsProvider');
  return api;
}
