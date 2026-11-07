/* Доступ для агентов — клиентский слой (задача 1285, docs/architecture/agent-tokens.md).
   Токены доступа и служебные сотрудники: ключ кэша ['ws', id, 'api-tokens'], событие api_token помечает его
   устаревшим (app/data/realtime.ts). Типы описаны здесь по контракту REST — серверной части пока нет. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PositionSection } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

/** Токен доступа в списке (без хэша) */
export interface ApiTokenItem {
  id: string;
  name: string;
  /** Начало токена для показа в списке: gr8r_ab12cd3 */
  prefix: string;
  memberId: string;
  memberName: string;
  readOnly: boolean;
  /** null — все разделы сотрудника */
  sections: PositionSection[] | null;
  canPost: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Ответ на выпуск токена: сам токен показывается один раз */
export interface ApiTokenCreated {
  token: string;
  item: ApiTokenItem;
}

export interface CreateTokenBody {
  name: string;
  /** Свой участник; на другого — только admin и owner */
  memberId?: string;
  readOnly: boolean;
  /** null — все разделы сотрудника */
  sections?: PositionSection[] | null;
  canPost: boolean;
  expiresAt?: string | null;
}

export interface ServiceMemberBody {
  name: string;
  role: 'member' | 'guest';
  positionIds?: string[];
}

export const apiTokensKey = (ws: string) => ['ws', ws, 'api-tokens'] as const;

/** Токены воркспейса: admin и owner — все, остальные — свои */
export function useApiTokens() {
  const ws = useWsId();
  return useQuery({
    queryKey: apiTokensKey(ws),
    queryFn: async () => {
      const res = await call<{ items: ApiTokenItem[] } | ApiTokenItem[]>(ws, 'GET', '/api-tokens');
      return Array.isArray(res) ? res : (res.items ?? []);
    },
  });
}

/** Вызовы API токенов: обновляют кэш, при ошибке — тост; null при ошибке */
export function useApiTokensApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: apiTokensKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
