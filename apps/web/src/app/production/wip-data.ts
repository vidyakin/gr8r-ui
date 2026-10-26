/* Остаток НЗП по участкам: данные экрана (задача 1137). Суммы сервер отдаёт только ролям с доступом к себестоимости. */
import { useQuery } from '@tanstack/react-query';
import { call, useWsId } from '../meta/data';
import { productionKey } from './data';

export interface WipStage {
  stageId: string | null;
  name: string;
  sortOrder: number;
  done: string;
}

export interface WipItem {
  key: string;
  itemName: string;
  stages: WipStage[];
  qty: string;
  amount: string | null;
}

export interface WipOrder {
  orderId: string | null;
  number: string | null;
  date: string | null;
  items: WipItem[];
  amount: string | null;
}

export interface WipCenter {
  workCenterId: string | null;
  workCenterName: string | null;
  orders: WipOrder[];
  amount: string | null;
}

export interface WipBalance {
  date: string;
  centers: WipCenter[];
  total: string | null;
}

/** Остаток НЗП на дату; участок — необязательный фильтр */
export function useWipBalance(date: string, workCenterId: string) {
  const ws = useWsId();
  const qs = new URLSearchParams({ date, ...(workCenterId ? { workCenterId } : {}) }).toString();
  return useQuery({ queryKey: productionKey(ws, 'wip', date, workCenterId), queryFn: () => call<WipBalance>(ws, 'GET', `/production/wip?${qs}`), enabled: !!date });
}
