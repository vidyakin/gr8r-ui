/* Таблица распределения доп. расходов по строкам оснований (задача 1385): только отрисовка, без запросов.
   Вынесена отдельно, чтобы её можно было прогнать в тесте с данными (`landed-cost-allocation.test.tsx`):
   доли приходят готовыми (их считает allocateLandedCost), у ручного способа сумма строки редактируется. */
import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { IconButton, Input } from '@/components/ui';
import { fmtAmount, fmtNumber, t } from '@/i18n';
import type { LandedCostAllocationRow } from '@erp/shared';
import type { LandedCostLineDraft } from './landed-costs-data';

export interface LandedCostAllocationTableProps {
  lines: LandedCostLineDraft[];
  /** Способ распределения: у «вручную» сумма строки — поле ввода */
  method: 'by_amount' | 'by_qty' | 'by_weight' | 'manual';
  editable: boolean;
  /** Доли по строкам из allocateLandedCost: id строки формы → сумма и процент */
  shares: Map<string, LandedCostAllocationRow>;
  onAmount: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

export function LandedCostAllocationTable({ lines, method, editable, shares, onAmount, onRemove }: LandedCostAllocationTableProps) {
  return (
    <div className="table-wrap">
      <table className="dtbl" aria-label={t('landedCosts.form.lines')}>
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th style={{ width: 150 }}>{t('landedCosts.col.baseDocument')}</th>
            <th>{t('landedCosts.col.product')}</th>
            <th style={{ width: 120 }} className="r">
              {t('landedCosts.col.qty')}
            </th>
            <th style={{ width: 130 }} className="r">
              {t('landedCosts.col.baseAmount')}
            </th>
            <th style={{ width: 100 }} className="r">
              {t('landedCosts.col.weight')}
            </th>
            <th style={{ width: 90 }} className="r">
              {t('landedCosts.col.share')}
            </th>
            <th style={{ width: 130 }} className="r">
              {t('landedCosts.col.amount')}
            </th>
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const share = shares.get(l.id);
            return (
              <tr key={l.id} data-row={i}>
                <td className="faint num">{i + 1}</td>
                <td className="mono trunc muted">{l.baseDocumentNumber || '—'}</td>
                <td className="trunc">
                  {l.productName}
                  {l.sku ? (
                    <span className="faint mono" style={{ marginLeft: 6 }}>
                      {l.sku}
                    </span>
                  ) : null}
                </td>
                <td className="r num">{fmtNumber(l.qty)}</td>
                <td className="r num">{fmtAmount(l.baseAmount)}</td>
                <td className="r num">{fmtNumber(l.weight)}</td>
                <td className="r num muted">{share ? `${share.sharePct}%` : '—'}</td>
                <td className="r">
                  {method === 'manual' ? (
                    <Input aria-label={t('landedCosts.col.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => onAmount(i, e.target.value)} />
                  ) : (
                    <span className="num">{share ? fmtAmount(share.amount) : '—'}</span>
                  )}
                </td>
                <td>
                  {editable && (
                    <IconButton size="xs" label={t('landedCosts.form.removeLine')} onClick={() => onRemove(i)}>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
