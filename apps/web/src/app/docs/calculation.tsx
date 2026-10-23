/* Значения параметров спецификации в строке заказа покупателя и калькуляция заказа: состав по спецификациям,
   источник цены себестоимости, наценка и применение цены к строкам. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Calculator } from 'lucide-react';
import { CALC_LINE_LABELS, COST_PRICE_SOURCE_LABELS, type CostPriceSource, type SpecParamDef } from '@gr8r/shared';
import { Alert, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { call, useWsId } from '../meta/data';
import { errorMessage } from '../data/api';
import { useT } from '@/i18n';

/** Параметры спецификации товара: по ним считаются формулы строк */
export function useSpecParams(productId: string | null | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: ['ws', ws, 'spec-params', productId], queryFn: async () => (await call<{ params: SpecParamDef[] }>(ws, 'GET', `/products/${productId}/params`)).params, enabled: !!productId, staleTime: 60_000 });
}

/** Диалог значений параметров строки заказа */
export function ParamsDialog({ productId, productName, values, onChange, onClose }: { productId: string; productName: string; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const t = useT();
  const params = useSpecParams(productId);
  const list = params.data ?? [];
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('docs.calculation.dialog.paramsTitle')}
        description={productName}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('docs.calculation.dialog.close')}</Button>
            </DialogClose>
          </>
        }
      >
        {params.isPending ? (
          <Skeleton w="100%" h={28} />
        ) : !list.length ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('docs.calculation.dialog.noParams')}
          </p>
        ) : (
          <div className="contents">
            {list.map(p => (
              <Field key={p.key} label={p.name} hint={p.stockDimension ? t('docs.calculation.dialog.stockDim') : undefined}>
                {f => (
                  <>
                    {p.type === 'boolean' ? (
                      <input
                        id={f.id}
                        type="checkbox"
                        aria-label={p.name}
                        checked={!!values[p.key]}
                        onChange={e => onChange({ ...values, [p.key]: e.currentTarget.checked })}
                      />
                    ) : p.type === 'select' ? (
                      <select className="select" id={f.id} value={String(values[p.key] ?? '')} onChange={e => onChange({ ...values, [p.key]: e.target.value })}>
                        <option value="">—</option>
                        {(p.options?.choices ?? []).map(c => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input {...f} inputMode="decimal" value={String(values[p.key] ?? '')} onChange={e => onChange({ ...values, [p.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    )}
                  </>
                )}
              </Field>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- калькуляция заказа ---------------- */

export interface CalculationLine {
  id: string;
  kind: 'material' | 'semi' | 'work' | 'expense' | 'extra';
  name: string;
  qty: string;
  price: string | null;
  amount: string | null;
  unitCost: string | null;
}

export interface Calculation {
  id: string;
  documentId: string;
  priceSource: CostPriceSource;
  markupPct: string;
  costTotal: string | null;
  lineCostTotal: string | null;
  priceTotal: string | null;
  lines: CalculationLine[];
}

/** Калькуляция заказа покупателя: состав по спецификациям, наценка и применение цены к строкам */
export function CalculationDialog({ documentId, onClose, onApplied }: { documentId: string; onClose: () => void; onApplied: () => void }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const calc = useQuery({ queryKey: ['ws', ws, 'calculation', documentId], queryFn: async () => (await call<{ calculation: Calculation | null }>(ws, 'GET', `/order-calculations/${documentId}`)).calculation, staleTime: 10_000 });

  const recalc = useMutation({
    mutationFn: (body: { priceSource?: CostPriceSource; markupPct?: string }) => call<Calculation>(ws, 'POST', '/order-calculations', { customerOrderId: documentId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', ws, 'calculation', documentId] }),
    onError: e => toast.error(errorMessage(e)),
  });
  const patch = useMutation({
    mutationFn: (body: { priceSource?: CostPriceSource; markupPct?: string }) => call<Calculation>(ws, 'PATCH', `/order-calculations/${calc.data?.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', ws, 'calculation', documentId] }),
    onError: e => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => call(ws, 'POST', `/order-calculations/${calc.data?.id}/apply`, { documentId }),
    onSuccess: () => {
      toast(t('docs.calculation.dialog.applied'));
      onApplied();
      qc.invalidateQueries({ queryKey: ['ws', ws, 'calculation', documentId] });
    },
    onError: e => toast.error(errorMessage(e)),
  });

  const c = calc.data;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={t('docs.calculation.dialogTitle')}
        description={t('docs.calculation.dialogLead')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('docs.calculation.dialog.close')}</Button>
            </DialogClose>
            <Button variant="secondary" disabled={busy || recalc.isPending} onClick={() => (setBusy(true), recalc.mutate({}))}>
              {t('docs.calculation.dialog.recalculate')}
            </Button>
            <Button variant="primary" disabled={busy || apply.isPending || !c} onClick={() => (setBusy(true), apply.mutate())}>
              {t('docs.calculation.dialog.apply')}
            </Button>
          </>
        }
      >
        {calc.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : calc.isError ? (
          <Alert tone="danger" title={t('docs.calculation.dialog.loadError')}>
            {(calc.error as Error).message}
          </Alert>
        ) : !c ? (
          <EmptyState icon={<Calculator size={20} />} title={t('docs.calculation.dialog.emptyTitle')} action={<Button size="sm" onClick={() => recalc.mutate({})}>{t('docs.calculation.dialog.calculate')}</Button>}>
            {t('docs.calculation.dialog.emptyHint')}
          </EmptyState>
        ) : (
          <div className="contents">
            <div className="row" style={{ gap: 10 }}>
              <Field label={t('docs.calculation.dialog.priceSource')} className="grow">
                {f => (
                  <select
                    className="select"
                    id={f.id}
                    value={c.priceSource}
                    onChange={e => patch.mutate({ priceSource: e.target.value as CostPriceSource })}
                  >
                    {Object.entries(COST_PRICE_SOURCE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('docs.calculation.dialog.markup')} className="grow">
                {f => <Input {...f} inputMode="decimal" value={c.markupPct} onChange={e => patch.mutate({ markupPct: e.target.value })} />}
              </Field>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>{t('docs.calculation.dialog.col.item')}</th>
                  <th>{t('docs.calculation.dialog.col.type')}</th>
                  <th className="right">{t('docs.calculation.dialog.col.qty')}</th>
                  <th className="right">{t('docs.calculation.dialog.col.price')}</th>
                  <th className="right">{t('docs.calculation.dialog.col.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map(l => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td className="muted">{CALC_LINE_LABELS[l.kind] ?? l.kind}</td>
                    <td className="right num">{l.qty}</td>
                    <td className="right num">{l.price ?? '—'}</td>
                    <td className="right num">{l.amount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ gap: 16, justifyContent: 'flex-end' }}>
              <span className="muted">{t('docs.calculation.dialog.cost')}: {c.costTotal ?? '—'}</span>
              <span className="muted">{t('docs.calculation.dialog.priceTotal')}: {c.priceTotal ?? '—'}</span>
            </div>
            {c.costTotal === null && (
              <Alert tone="info" title={t('docs.calculation.dialog.costHidden')}>
                <CircleAlert size={14} /> {t('docs.calculation.dialog.costHiddenHint')}
              </Alert>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
