/* Поля скидок и лояльности в шапке документа продаж (задача 1179): промокод, карта лояльности, списание баллов и кнопка
   «Пересчитать скидки». Всё это — действия над черновиком: сначала сохраняется форма, затем идёт запрос, ответ заменяет форму. */
import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { redemptionLimit } from '@gr8r/shared';
import { Button, Field, Input, Select, toast } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { POINTS_DOC_TYPES, useDocLoyaltyApi, useLoyaltyCard, useLoyaltyCards, useLoyaltyProgram } from '../loyalty/data';
import type { DocDetail } from './data';

const NO_CARD = 'none';
const num = (s: string) => s.trim().replace(',', '.');

export function DocLoyaltyFields({
  doc,
  customerId,
  editable,
  total,
  flush,
  load,
  onApplied,
}: {
  doc: DocDetail;
  /** Клиент из формы (ещё не обязательно сохранённый) */
  customerId: string | null;
  editable: boolean;
  /** Сумма документа с НДС по форме — для предела списания баллов */
  total: string;
  flush: () => Promise<boolean>;
  /** Перечитать документ с сервера (ответ попадает в кэш) */
  load: () => Promise<DocDetail | null | undefined>;
  onApplied: (d: DocDetail) => void;
}) {
  const t = useT();
  const api = useDocLoyaltyApi();
  const saved = doc.loyalty ?? null;
  const [promo, setPromo] = React.useState(saved?.promoCode ?? '');
  const [cardId, setCardId] = React.useState(saved?.loyaltyCardId ?? NO_CARD);
  const [points, setPoints] = React.useState(saved ? String(Number(saved.pointsRedeemed)) : '0');
  const [busy, setBusy] = React.useState(false);
  const cards = useLoyaltyCards({ customerId }, editable && !!customerId);
  const card = useLoyaltyCard(cardId !== NO_CARD ? cardId : undefined);
  const program = useLoyaltyProgram();
  const canPoints = POINTS_DOC_TYPES.includes(doc.type);
  const bonus = card.data?.kind === 'bonus' || (cardId === saved?.loyaltyCardId && saved?.loyaltyCardKind === 'bonus');
  const limit = program.data ? redemptionLimit(total, program.data.redemptionLimitPct) : '0.00';

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      if (!(await flush())) return;
      await fn();
      const d = await load();
      if (d) onApplied(d);
      if (message) toast(message, { duration: 2000 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Промокод хранится на документе после успешной проверки сервером; пустое поле сбрасывает его */
  const recalc = (nextCard: string = cardId) =>
    act(async () => {
      if (nextCard !== (saved?.loyaltyCardId ?? NO_CARD)) await api.save(doc.id, { loyaltyCardId: nextCard === NO_CARD ? null : nextCard });
      if (!promo.trim() && saved?.promoCodeId) await api.save(doc.id, { promoCodeId: null });
      await api.recalc(doc.id, promo.trim() || null);
    }, t('loyalty.doc.recalculated'));

  const savePoints = () => {
    if (num(points) === String(Number(saved?.pointsRedeemed ?? 0))) return;
    const v = /^\d+(\.\d+)?$/.test(num(points)) ? num(points) : '0';
    void act(() => api.save(doc.id, { pointsRedeemed: v }), t('loyalty.doc.pointsSaved'));
  };

  if (!editable && !saved) return null;
  return (
    <>
      <Field label={t('loyalty.doc.promoCode')}>
        {p =>
          editable ? (
            <Input {...p} className="mono" maxLength={40} value={promo} placeholder={t('loyalty.doc.promoPlaceholder')} onChange={e => setPromo(e.target.value)} onKeyDown={e => e.key === 'Enter' && void recalc()} />
          ) : (
            <div className="doc-ro mono">{saved?.promoCode ?? '—'}</div>
          )
        }
      </Field>
      <Field label={t('loyalty.doc.card')} hint={bonus && card.data ? t('loyalty.doc.cardBalance', { n: fmtAmount(card.data.balance) }) : undefined}>
        {p =>
          editable ? (
            <Select
              id={p.id}
              disabled={busy || !customerId}
              value={cardId}
              onValueChange={v => {
                setCardId(v);
                void recalc(v);
              }}
              options={[{ value: NO_CARD, label: t('loyalty.doc.noCard') }, ...(cards.data ?? []).filter(c => c.isActive || c.id === cardId).map(c => ({ value: c.id, label: c.number }))]}
              aria-label={t('loyalty.doc.card')}
            />
          ) : (
            <div className="doc-ro mono">{saved?.loyaltyCardNumber ?? '—'}</div>
          )
        }
      </Field>
      {canPoints && (bonus || Number(saved?.pointsRedeemed ?? 0) > 0) && (
        <Field label={t('loyalty.doc.points')} hint={editable ? t('loyalty.doc.pointsHint', { limit: fmtNumber(limit), pct: fmtNumber(program.data?.redemptionLimitPct ?? 0) }) : undefined}>
          {p =>
            editable ? (
              <Input {...p} inputMode="decimal" className="r" disabled={busy} value={points} onChange={e => setPoints(e.target.value)} onBlur={savePoints} />
            ) : (
              <div className="doc-ro num">{fmtAmount(saved?.pointsRedeemed ?? 0)}</div>
            )
          }
        </Field>
      )}
      {editable && (
        <Field label=" ">
          {() => (
            <Button disabled={busy} onClick={() => void recalc()}>
              <RefreshCw size={14} />
              {t('loyalty.doc.recalc')}
            </Button>
          )}
        </Field>
      )}
    </>
  );
}
