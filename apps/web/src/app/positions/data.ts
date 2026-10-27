/* Должности сотрудников и виды номенклатуры на клиенте (задача 1172, docs/architecture/positions.md).
   Ключи кэша ['ws', id, 'positions', …]: события position / product_kind / member обновляют их. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { membersWithFunction, POSITION_SECTIONS, type PositionFunction, type PositionSection, type ProductKindType } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface PositionItem {
  id: string;
  name: string;
  functions: PositionFunction[];
  /** Пусто — все разделы */
  sections: PositionSection[];
  sortOrder: number;
  productKindIds: string[];
  memberIds: string[];
}

export interface ProductKindItem {
  id: string;
  name: string;
  type: ProductKindType;
  sortOrder: number;
}

export interface MyAccess {
  memberId: string;
  positionIds: string[];
  functions: PositionFunction[];
  sections: PositionSection[];
}

export const positionsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'positions', ...rest] as const;

export function usePositions() {
  const ws = useWsId();
  return useQuery({ queryKey: positionsKey(ws, 'list'), queryFn: async () => (await call<{ items: PositionItem[] }>(ws, 'GET', '/positions')).items, staleTime: Infinity });
}

export function useProductKinds() {
  const ws = useWsId();
  return useQuery({ queryKey: positionsKey(ws, 'kinds'), queryFn: async () => (await call<{ items: ProductKindItem[] }>(ws, 'GET', '/product-kinds')).items, staleTime: Infinity });
}

/** Должности, функции и видимые разделы меню текущего участника (пока грузится — всё видимо) */
export function useMyAccess() {
  const ws = useWsId();
  return useQuery({ queryKey: positionsKey(ws, 'me'), queryFn: () => call<MyAccess>(ws, 'GET', '/positions/me'), staleTime: Infinity });
}

/** Вызов API справочников с обновлением кэша и тостом об ошибке; null при ошибке */
export function usePositionsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: positionsKey(ws) });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'catalog'] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Участники с функцией: фильтр списков выбора. Нет должностей с функцией (или данные ещё грузятся) — все участники.
    keep — уже выбранные значения: остаются в списке, даже если у участника функции нет (чтобы выбранное отображалось) */
export function useMembersWith<M extends { id: string }>(members: readonly M[], fn: PositionFunction, keep: readonly (string | null | undefined)[] = []): M[] {
  const positions = usePositions().data;
  const kept = keep.join('|');
  return React.useMemo(() => {
    if (!positions) return [...members];
    const links = positions.flatMap(p => p.memberIds.map(memberId => ({ memberId, positionId: p.id })));
    const withFn = new Set(membersWithFunction(members, positions, links, fn).map(m => m.id));
    return members.filter(m => withFn.has(m.id) || kept.split('|').includes(m.id));
  }, [members, positions, fn, kept]);
}

/** Виды номенклатуры, которые оказывает специалист: null — любые услуги */
export function specialistKindIds(s: { productKindIds?: string[] | null }): string[] | null {
  return s.productKindIds ?? null;
}

export { POSITION_SECTIONS };
