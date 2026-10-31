/* Автоскидки и карты лояльности на клиенте (задача 1179). Ключи — под ['ws', id, 'docs', 'loyalty', …]:
   события правил, промокодов и карт инвалидируют их вместе с документами (app/data/realtime.ts). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, useWsId } from '../meta/data';

export const loyaltyKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'docs', 'loyalty', ...rest] as const;

/** Типы документов, в которых работают автоскидки (зеркало DISCOUNT_DOCUMENT_TYPES из packages/db) */
export const DISCOUNT_DOC_TYPES: readonly string[] = ['quote', 'customer_order', 'invoice', 'realization', 'act', 'work_order'];
/** Типы документов, где списываются и начисляются баллы (зеркало LOYALTY_SALE_TYPES) */
export const POINTS_DOC_TYPES: readonly string[] = ['realization', 'act', 'work_order'];

export type CardKind = 'discount' | 'bonus' | 'cumulative';

export interface DiscountRule {
  id: string;
  name: string;
  discountPct: string;
  stackable: boolean;
  promoOnly: boolean;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[];
  timeFrom: string | null;
  timeTo: string | null;
  minDocumentAmount: string;
  minLineQty: string;
  archivedAt: string | null;
}
export interface DiscountRuleDetail extends DiscountRule {
  customerIds: string[];
  priceKindIds: string[];
  productIds: string[];
  categoryIds: string[];
}
export interface DiscountRuleBody {
  id?: string;
  name: string;
  discountPct: string;
  stackable: boolean;
  promoOnly: boolean;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[];
  timeFrom: string | null;
  timeTo: string | null;
  minDocumentAmount: string;
  minLineQty: string;
  customerIds: string[];
  priceKindIds: string[];
  productIds: string[];
  categoryIds: string[];
}

export interface PromoCode {
  id: string;
  code: string;
  ruleId: string;
  ruleName: string;
  validFrom: string | null;
  validTo: string | null;
  usageLimit: number | null;
  usageCount: number;
  archivedAt: string | null;
}
export interface PromoCodeBody {
  id?: string;
  code: string;
  ruleId: string;
  validFrom?: string | null;
  validTo?: string | null;
  usageLimit?: number | null;
}

export interface LoyaltyProgram {
  accrualPct: string;
  redemptionLimitPct: string;
  expirationDays: number | null;
  cumulativeScale: { fromAmount: string; pct: string }[];
}

export interface LoyaltyCard {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  kind: CardKind;
  discountPct: string | null;
  isActive: boolean;
  archivedAt: string | null;
}
export interface LoyaltyTransaction {
  id: string;
  kind: 'accrual' | 'redemption' | 'expiration' | 'reversal';
  points: string;
  documentId: string | null;
  docNumber: string | null;
  expiresAt?: string | null;
  comment: string;
  createdAt: string;
}
export interface LoyaltyCardDetail extends Omit<LoyaltyCard, 'customerName'> {
  balance: string;
  history: LoyaltyTransaction[];
}
export interface LoyaltyCardBody {
  id?: string;
  number: string;
  customerId: string;
  kind: CardKind;
  discountPct?: string | null;
  isActive?: boolean;
}

export function useDiscountRules(archived = false) {
  const ws = useWsId();
  return useQuery({ queryKey: loyaltyKey(ws, 'rules', archived), queryFn: async () => (await call<{ items: DiscountRule[] }>(ws, 'GET', `/loyalty/discount-rules${archived ? '?archived=true' : ''}`)).items });
}
export function usePromoCodes(archived = false, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: loyaltyKey(ws, 'promo', archived), queryFn: async () => (await call<{ items: PromoCode[] }>(ws, 'GET', `/loyalty/promo-codes${archived ? '?archived=true' : ''}`)).items, enabled });
}
export function useLoyaltyProgram() {
  const ws = useWsId();
  return useQuery({ queryKey: loyaltyKey(ws, 'program'), queryFn: () => call<LoyaltyProgram>(ws, 'GET', '/loyalty/program') });
}
export function useLoyaltyCards(p: { customerId?: string | null; archived?: boolean } = {}, enabled = true) {
  const ws = useWsId();
  const q = new URLSearchParams();
  if (p.customerId) q.set('customerId', p.customerId);
  if (p.archived) q.set('archived', 'true');
  return useQuery({ queryKey: loyaltyKey(ws, 'cards', p.customerId ?? '', !!p.archived), queryFn: async () => (await call<{ items: LoyaltyCard[] }>(ws, 'GET', `/loyalty/cards?${q}`)).items, enabled });
}
export function useLoyaltyCard(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: loyaltyKey(ws, 'card', id ?? ''), queryFn: () => call<LoyaltyCardDetail>(ws, 'GET', `/loyalty/cards/${id}`), enabled: !!id });
}

export function useLoyaltyApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const wrap = async <T,>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await qc.invalidateQueries({ queryKey: loyaltyKey(ws) });
    return r;
  };
  return {
    rule: (id: string) => call<DiscountRuleDetail>(ws, 'GET', `/loyalty/discount-rules/${id}`),
    saveRule: (body: DiscountRuleBody) => wrap(call<DiscountRuleDetail>(ws, 'POST', '/loyalty/discount-rules', body)),
    updateRule: (id: string, body: Partial<DiscountRuleBody>) => wrap(call<DiscountRuleDetail>(ws, 'PATCH', `/loyalty/discount-rules/${id}`, body)),
    archiveRule: (id: string) => wrap(call(ws, 'DELETE', `/loyalty/discount-rules/${id}`)),
    restoreRule: (id: string) => wrap(call(ws, 'POST', `/loyalty/discount-rules/${id}/restore`)),
    savePromo: (body: PromoCodeBody) => wrap(call<PromoCode>(ws, 'POST', '/loyalty/promo-codes', body)),
    updatePromo: (id: string, body: Partial<PromoCodeBody>) => wrap(call<PromoCode>(ws, 'PATCH', `/loyalty/promo-codes/${id}`, body)),
    archivePromo: (id: string) => wrap(call(ws, 'DELETE', `/loyalty/promo-codes/${id}`)),
    updateProgram: (body: Partial<LoyaltyProgram>) => wrap(call<LoyaltyProgram>(ws, 'PATCH', '/loyalty/program', body)),
    saveCard: (body: LoyaltyCardBody) => wrap(call<LoyaltyCardDetail>(ws, 'POST', '/loyalty/cards', body)),
    updateCard: (id: string, body: { number?: string; discountPct?: string | null; isActive?: boolean }) => wrap(call<LoyaltyCardDetail>(ws, 'PATCH', `/loyalty/cards/${id}`, body)),
    archiveCard: (id: string) => wrap(call(ws, 'DELETE', `/loyalty/cards/${id}`)),
  };
}

/** Действия над скидками и лояльностью черновика документа */
export function useDocLoyaltyApi() {
  const ws = useWsId();
  return {
    recalc: (docId: string, promoCode: string | null) => call<{ id: string }>(ws, 'POST', `/loyalty/documents/${docId}/recalc-discounts`, { promoCode }),
    save: (docId: string, body: { promoCodeId?: string | null; loyaltyCardId?: string | null; pointsRedeemed?: string }) => call(ws, 'PUT', `/loyalty/documents/${docId}/loyalty`, body),
  };
}
