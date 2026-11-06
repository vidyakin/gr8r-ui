/* Контроль качества (задача 1186): справочник причин брака. Раздел docs/architecture/quality.md. */
import { useQuery } from '@tanstack/react-query';
import { call, useWsId } from '../meta/data';
import { productionKey } from './data';

export interface DefectReason {
  id: string;
  name: string;
  note: string;
  archivedAt: string | null;
}

/** Действующие причины брака (архивные API не отдаёт) */
export function useDefectReasons() {
  const ws = useWsId();
  return useQuery({
    queryKey: productionKey(ws, 'defect-reasons'),
    queryFn: async () => (await call<{ items: DefectReason[] }>(ws, 'GET', '/defect-reasons?limit=200')).items,
    staleTime: Infinity,
  });
}
