/* Акты выполненных работ объекта на клиенте (задача 1273): список со сводкой выручки, предложение строк по виду,
   карточка акта и действия — подпись, отмена подписи, выставление счёта и акта.
   Запросы живут под ['ws', id, 'objects', …]: события object_act.* и document.* сбрасывают их через realtime. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObjectActKind, ObjectActStatus } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export interface ObjectActLine {
  id: string;
  actId: string;
  estimateItemId: string | null;
  sortOrder: number;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  vatRate: string;
  /** Сумма без НДС */
  amount: string;
}

export interface ActDocumentRef {
  id: string;
  number: string | null;
  status: string;
}

export interface ObjectAct {
  id: string;
  objectId: string;
  number: string;
  actDate: string;
  periodFrom: string;
  periodTo: string;
  kind: ObjectActKind;
  milestoneId: string | null;
  milestoneName: string | null;
  status: ObjectActStatus;
  signedAt: string | null;
  signedBy: string | null;
  signedByName: string | null;
  invoiceDocumentId: string | null;
  actDocumentId: string | null;
  invoiceDocument: ActDocumentRef | null;
  actDocument: ActDocumentRef | null;
  note: string;
  lines: ObjectActLine[];
  totals: { net: string; vat: string; total: string };
  /** Выставлено и оплачено (документы акта и взаиморасчёты) */
  invoiced: string;
  paid: string;
  createdAt: string;
  updatedAt: string;
}

/** Сводка выручки объекта: выполнено (по смете), принято, выставлено, оплачено */
export interface ObjectRevenue {
  done: string | null;
  accepted: string | null;
  invoiced: string | null;
  paid: string | null;
}

export interface ObjectActs {
  objectId: string;
  items: ObjectAct[];
  revenue: ObjectRevenue;
}

export interface ActSuggestionLine {
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  vatRate: string;
  amount: string;
  doneQty?: string;
  acceptedQty?: string;
}

export interface ActSuggestion {
  objectId: string;
  kind: ObjectActKind;
  milestoneId: string | null;
  periodFrom: string;
  periodTo: string;
  lines: ActSuggestionLine[];
  totals: { net: string; vat: string; total: string };
  hours?: { hours: string; rate: string | null };
}

export interface ActInput {
  kind?: ObjectActKind;
  actDate?: string;
  periodFrom?: string;
  periodTo?: string;
  milestoneId?: string | null;
  lines?: { estimateItemId: string; qty: string }[];
  note?: string;
}

export const actsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'objects', 'acts', ...rest] as const;

/** Акты объекта и сводка выручки */
export function useObjectActs(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: actsKey(ws, 'list', objectId), queryFn: () => call<ObjectActs>(ws, 'GET', `/objects/${objectId}/acts`), enabled: !!objectId });
}

/** Предложение строк акта по виду, периоду и вехе; при выключенном enabled — не запрашивается */
export function useActSuggestion(objectId: string | undefined, params: { kind: ObjectActKind; from?: string; to?: string; milestoneId?: string | null }, enabled = true) {
  const ws = useWsId();
  const sp = new URLSearchParams({ kind: params.kind });
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.milestoneId) sp.set('milestoneId', params.milestoneId);
  return useQuery({
    queryKey: actsKey(ws, 'suggestion', objectId, sp.toString()),
    queryFn: () => call<ActSuggestion>(ws, 'GET', `/objects/${objectId}/acts/suggestion?${sp}`),
    enabled: !!objectId && enabled,
  });
}

export function useObjectAct(actId: string | null | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: actsKey(ws, 'detail', actId), queryFn: () => call<ObjectAct>(ws, 'GET', `/object-acts/${actId}`), enabled: !!actId });
}

/** Действия с актами: создать, поправить черновик, удалить, подписать, отменить подпись, выставить */
export function useObjectActApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'objects'] });
    // выставление создаёт документы и начисление: обновляем журналы и взаиморасчёты
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'money'] });
  };
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await done();
    return r;
  };
  return {
    create: (objectId: string, body: ActInput) => wrap(call<ObjectAct>(ws, 'POST', `/objects/${objectId}/acts`, body)),
    update: (id: string, body: ActInput) => wrap(call<ObjectAct>(ws, 'PATCH', `/object-acts/${id}`, body)),
    remove: (id: string) => wrap(call(ws, 'DELETE', `/object-acts/${id}`)),
    sign: (id: string) => wrap(call<ObjectAct>(ws, 'POST', `/object-acts/${id}/sign`, {})),
    unsign: (id: string) => wrap(call<ObjectAct>(ws, 'POST', `/object-acts/${id}/unsign`, {})),
    invoice: (id: string) => wrap(call<{ invoiceDocumentId: string; actDocumentId: string; warnings: string[]; act: ObjectAct }>(ws, 'POST', `/object-acts/${id}/invoice`, {})),
  };
}
