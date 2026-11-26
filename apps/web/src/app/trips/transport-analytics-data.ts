/* Запрос аналитики транспорта (задача 1216): GET /trips/analytics?from=...&to=... */
import { useQuery } from '@tanstack/react-query';
import type { TransportAnalyticsReport } from '@erp/shared';
import { call, useWsId } from '../meta/data';
import { fleetKey } from '../fleet/data';

export function useTransportAnalytics(from: string, to: string) {
  const ws = useWsId();
  const q = new URLSearchParams({ from, to }).toString();
  return useQuery({
    queryKey: fleetKey(ws, 'trips', 'analytics', from, to),
    queryFn: () => call<TransportAnalyticsReport>(ws, 'GET', `/trips/analytics?${q}`),
    enabled: !!from && !!to,
  });
}
