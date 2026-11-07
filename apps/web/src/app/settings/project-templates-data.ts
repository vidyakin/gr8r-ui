/* Шаблоны проектов на клиенте (docs/architecture/task-modules.md, «Шаблоны проектов»).
   Ключи кэша ['ws', id, 'project-templates', …]: событие project_template обновляет их (realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { engineFor } from '../data/engine';
import { call, useWsId } from '../meta/data';

export interface ProjectTemplateItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  durationDays: number | null;
  disabled: boolean;
  taskCount: number;
  subtaskCount: number;
}

export const projectTemplatesKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'project-templates', ...rest] as const;

/** Все шаблоны (enabledOnly — только для выбора при создании проекта) */
export function useProjectTemplates(enabledOnly = false) {
  const ws = useWsId();
  return useQuery({
    queryKey: projectTemplatesKey(ws, enabledOnly ? 'enabled' : 'all'),
    queryFn: async () => (await call<{ items: ProjectTemplateItem[] }>(ws, 'GET', `/project-templates${enabledOnly ? '?enabled=true' : ''}`)).items,
    staleTime: Infinity,
  });
}

/** Вызов API шаблонов с обновлением кэша и тостом об ошибке; null при ошибке */
export function useProjectTemplatesApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, `/project-templates${path}`, json);
        void qc.invalidateQueries({ queryKey: projectTemplatesKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Создать проект из шаблона и дождаться, пока проект и задачи появятся в кэше экранов; возвращает id проекта и число задач */
export function useCreateProjectFromTemplate() {
  const ws = useWsId();
  const qc = useQueryClient();
  const api = useProjectTemplatesApi();
  return React.useCallback(
    async (templateId: string, body: { name: string; startDate: string; description?: string; icon?: string; color?: string; teamId?: string | null; leadId?: string | null }) => {
      const r = await api<{ project: { id: string }; taskCount: number }>('POST', `/${templateId}/create-project`, body);
      if (!r) return null;
      const engine = engineFor(qc, ws);
      await Promise.all((['projects', 'tasks', 'activity'] as const).map(n => qc.refetchQueries({ queryKey: engine.key(n) })));
      return { id: r.project.id, taskCount: r.taskCount };
    },
    [api, qc, ws],
  );
}
