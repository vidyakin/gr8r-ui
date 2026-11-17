/* Подразделения на клиенте (docs/architecture/departments.md). Ключи кэша ['ws', id, 'departments', …]:
   события department и member.* (смена подразделения участника) обновляют их (app/data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import type { DepartmentItem } from './tree';

export type { DepartmentItem } from './tree';

export const departmentsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'departments', ...rest] as const;

export function useDepartments() {
  const ws = useWsId();
  return useQuery({ queryKey: departmentsKey(ws, 'list'), queryFn: async () => (await call<{ items: DepartmentItem[] }>(ws, 'GET', '/departments')).items, staleTime: Infinity });
}

/** Вызов API подразделений с обновлением кэша и тостом об ошибке; null при ошибке */
export function useDepartmentsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: departmentsKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
