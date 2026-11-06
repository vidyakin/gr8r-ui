/* Субподряд объекта на клиенте (задача 1274): сводка субподряда, заказы субподрядчикам, акты субподрядчика,
   предложение строк из заказа и действия — создание черновика, правка, удаление, приёмка, отклонение, отмена приёмки.
   Запросы живут под ['ws', id, 'objects', …]: события object_sub_act.* и document.* сбрасывают их через realtime. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObjectSubActStatus } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export interface SubActLine {
  id: string;
  actId: string;
  estimateItemId: string | null;
  sortOrder: number;
  name: string;
  unitCode: string;
  unitSymbol: string;
  /** Предъявлено субподрядчиком */
  qty: string;
  /** Цена субподрядчика без НДС */
  price: string;
  /** Принято (≤ qty) */
  acceptedQty: string;
  defectReasonId: string | null;
  reasonName: string | null;
  note: string;
  rejectedQty: string;
  amount: string;
  acceptedAmount: string;
  rejectedAmount: string;
}

export interface SubActMaterial {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  note: string;
}

export interface SubActDocumentRef {
  id: string;
  number: string | null;
  status: string;
}

export interface SubAct {
  id: string;
  objectId: string;
  counterpartyId: string;
  counterpartyName: string;
  orderId: string | null;
  orderNumber: string | null;
  number: string;
  docNumber: string;
  docDate: string;
  periodFrom: string;
  periodTo: string;
  status: ObjectSubActStatus;
  acceptedAt: string | null;
  acceptedByName: string | null;
  rejectedAt: string | null;
  rejectReason: string;
  receiptDocumentId: string | null;
  writeOffDocumentId: string | null;
  receiptDocument: SubActDocumentRef | null;
  writeOffDocument: SubActDocumentRef | null;
  note: string;
  lines: SubActLine[];
  materials: SubActMaterial[];
  totals: { presented: string; accepted: string; rejected: string };
  paid: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractAmounts {
  ordered: string | null;
  presented: string;
  accepted: string;
  rejected: string;
  paid: string;
}

export interface SubcontractReason {
  reasonId: string | null;
  reasonName: string;
  amount: string;
  qty: string;
}

export interface SubcontractOrder {
  id: string;
  number: string | null;
  date: string;
  status: string;
  counterpartyId: string | null;
  counterpartyName: string;
  ordered: string;
  accepted: string;
}

export interface SubcontractParty {
  counterpartyId: string;
  counterpartyName: string;
  presented: string;
  accepted: string;
  rejected: string;
  paid: string;
  acts: number;
}

export interface SubcontractSummary {
  objectId: string;
  amounts: SubcontractAmounts;
  reasons: SubcontractReason[];
  orders: SubcontractOrder[];
  /** Сводка по субподрядчикам объекта */
  counterparties: SubcontractParty[];
}

export interface SubcontractList {
  objectId: string;
  items: SubAct[];
  subcontract: SubcontractSummary;
}

export interface SubActSuggestionLine {
  orderLineId: string;
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  price: string;
  amount: string;
  orderedQty: string;
  acceptedQty: string;
}

export interface SubActSuggestion {
  objectId: string;
  orderId: string;
  counterpartyId: string;
  docNumber: string;
  docDate: string;
  lines: SubActSuggestionLine[];
}

export interface SubActLineInput {
  estimateItemId?: string | null;
  name?: string;
  unitCode?: string;
  qty: string;
  price?: string;
  acceptedQty?: string;
  defectReasonId?: string | null;
  note?: string;
}

export interface SubActMaterialInput {
  productId: string;
  qty: string;
  note?: string;
}

export interface SubActInput {
  counterpartyId?: string;
  orderId?: string | null;
  docNumber?: string;
  docDate?: string;
  periodFrom?: string;
  periodTo?: string;
  lines?: SubActLineInput[];
  materials?: SubActMaterialInput[];
  note?: string;
}

export interface AcceptedSubAct {
  receiptDocumentId: string | null;
  writeOffDocumentId: string | null;
  /** Коды предупреждений: период закрыт (документ черновик), бюджета превышен (warn) */
  warnings: string[];
  act: SubAct;
}

export const subcontractKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'objects', 'subcontract', ...rest] as const;

/** Акты субподрядчика объекта и сводка субподряда */
export function useSubcontractList(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: subcontractKey(ws, 'list', objectId), queryFn: () => call<SubcontractList>(ws, 'GET', `/objects/${objectId}/sub-acts`), enabled: !!objectId });
}

/** Предложение строк акта из заказа субподрядчику: остаток к приёмке */
export function useSubActSuggestion(objectId: string | undefined, orderId: string | null, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: subcontractKey(ws, 'suggestion', objectId, orderId),
    queryFn: () => call<SubActSuggestion>(ws, 'GET', `/objects/${objectId}/sub-acts/suggestion?orderId=${orderId}`),
    enabled: !!objectId && !!orderId && enabled,
  });
}

/** Действия с актами субподрядчика: создать, поправить черновик, удалить, принять, отклонить, отменить приёмку */
export function useSubActApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'objects'] });
    // приёмка создаёт поступление и списание: обновляем журналы, бюджет и взаиморасчёты
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'money'] });
  };
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await done();
    return r;
  };
  return {
    create: (objectId: string, body: SubActInput) => wrap(call<SubAct>(ws, 'POST', `/objects/${objectId}/sub-acts`, body)),
    update: (id: string, body: SubActInput) => wrap(call<SubAct>(ws, 'PATCH', `/sub-acts/${id}`, body)),
    remove: (id: string) => wrap(call(ws, 'DELETE', `/sub-acts/${id}`)),
    accept: (id: string) => wrap(call<AcceptedSubAct>(ws, 'POST', `/sub-acts/${id}/accept`, {})),
    reject: (id: string, reason: string) => wrap(call<SubAct>(ws, 'POST', `/sub-acts/${id}/reject`, { reason })),
    unaccept: (id: string) => wrap(call<SubAct>(ws, 'POST', `/sub-acts/${id}/unaccept`, {})),
  };
}
