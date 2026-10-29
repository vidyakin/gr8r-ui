/* Лицензия арендатора во фронтенде (docs/architecture/licensing.md): набор включённых модулей приходит с GET /license,
   кэш ['ws', id, 'license'] обновляется событием license.changed (realtime). Пока набор грузится, все модули считаются включёнными,
   чтобы меню не мигало; запрет всё равно держит API (403 module_disabled). */
import { useQuery } from '@tanstack/react-query';
import type { LicenseView } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export const licenseKey = (ws: string) => ['ws', ws, 'license'] as const;

export function useLicense() {
  const ws = useWsId();
  return useQuery({ queryKey: licenseKey(ws), queryFn: () => call<LicenseView>(ws, 'GET', '/license'), staleTime: 5 * 60_000 });
}
