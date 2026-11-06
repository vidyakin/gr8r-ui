/* Прогноз прибыли объекта (задача 1275): вкладка карточки. Шапка — стоимость договора, факт, остаток, прогноз
   себестоимости, прибыль и маржа (убыток красным), дата и источник расчёта; таблица по категориям затрат с
   раскрытием по позициям сметы (план, факт, выполнено, остаток, прогноз, отклонение). Остаток можно заменить
   вручную — с обязательной причиной, правка помечается. Ниже — пробелы данных, исполнители по подтверждённым
   сменам и справка выручки. Суммы приходят только owner/admin: остальным вкладки нет, сервер отвечает 403. */
import * as React from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Pencil, RotateCcw } from 'lucide-react';
import { dec, fmt, type ObjectCostCategory } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Skeleton, toast } from '@/components/ui';
import { fmtAmount, fmtDateTime, fmtNumber, useT, type TKey } from '@/i18n';
import { errorMessage } from '../data/api';
import { useForecastApi, useForecastExecutors, useObjectForecast, type ForecastCategory, type ForecastItem, type ForecastOverrideInput } from './forecast-data';

const CATEGORY_LABEL: Record<ObjectCostCategory, TKey> = {
  material: 'objects.forecast.categories.material',
  labor: 'objects.forecast.categories.labor',
  subcontract: 'objects.forecast.categories.subcontract',
  // ключ не 'other': объект с полем other тип словаря принимает за форму множественного числа
  other: 'objects.forecast.categories.otherCosts',
};

const KIND_LABEL: Record<string, TKey> = {
  work: 'estimates.itemKind.work',
  material: 'estimates.itemKind.material',
  panel: 'estimates.itemKind.panel',
  subcontract: 'estimates.itemKind.subcontract',
  other: 'estimates.itemKind.otherKind',
};

const money = (v: string | null | undefined) => (v == null ? '—' : fmtAmount(v));
const hours = (v: string | null | undefined) => (v == null ? '—' : fmtNumber(v, { maximumFractionDigits: 3 }));
const percentText = (v: string | null) => (v == null ? '—' : `${fmtNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
/** Убыток (отрицательные числа) — красным */
const negClass = (v: string | null | undefined) => (v != null && v.startsWith('-') ? 'r num neg' : 'r num');

/** Цель ручной правки остатка: позиция сметы или категория затрат целиком */
interface EditTarget {
  itemId?: string;
  category?: ObjectCostCategory;
  name: string;
  remaining: string;
  reason: string;
  exists: boolean;
}

/** Диалог правки остатка: новое значение и обязательная причина */
function OverrideDialog({ objectId, target, onClose }: { objectId: string; target: EditTarget; onClose: () => void }) {
  const tt = useT();
  const api = useForecastApi(objectId);
  const [remaining, setRemaining] = React.useState(target.remaining);
  const [reason, setReason] = React.useState(target.reason);
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    const body: ForecastOverrideInput = {
      ...(target.itemId ? { estimateItemId: target.itemId } : { category: target.category ?? null }),
      remaining: remaining.replace(',', '.'),
      reason,
    };
    setBusy(true);
    try {
      await api.save.mutateAsync(body);
      toast(tt('objects.common.saved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await api.remove.mutateAsync(target.itemId ? { estimateItemId: target.itemId } : { category: target.category ?? null });
      toast(tt('objects.forecast.overrideRemoved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="sm"
        title={tt('objects.forecast.overrideTitle', { name: target.name })}
        description={tt('objects.forecast.overrideHint')}
        footer={
          <>
            {target.exists && (
              <Button variant="secondary" disabled={busy} onClick={() => void reset()}>
                <RotateCcw size={14} />
                {tt('objects.forecast.overrideRemove')}
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {tt('common.cancel')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {tt('common.save')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('objects.forecast.overrideValue')} hint={tt('objects.forecast.overrideValueHint')}>
            {p => <Input {...p} inputMode="decimal" value={remaining} onChange={e => setRemaining(e.target.value)} />}
          </Field>
          <Field label={tt('objects.forecast.overrideReason')} hint={tt('objects.forecast.overrideReasonHint')}>
            {p => <Input {...p} value={reason} onChange={e => setReason(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Строка позиции сметы в раскрытии категории */
function ItemRow({ item, onEdit }: { item: ForecastItem; onEdit: (t: EditTarget) => void }) {
  const tt = useT();
  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <span style={{ width: 16 }} />
          <div className="col" style={{ gap: 2 }}>
            <span>
              {item.name} <span className="faint">· {tt(KIND_LABEL[item.kind] ?? 'estimates.itemKind.work')}</span>
            </span>
            {item.kind === 'work' && (
              <span className="faint" style={{ fontSize: 11 }}>
                {tt('objects.forecast.hoursLine', { plan: hours(item.planHours), fact: hours(item.factHours), rest: hours(item.remainingHours), forecast: hours(item.forecastHours) })}
                {' · '}
                {tt(`objects.forecast.basis.${item.basis}`)}
              </span>
            )}
            {item.overridden && (
              <span className="faint" style={{ fontSize: 11 }}>
                <Badge tone="amber">{tt('objects.forecast.manual')}</Badge> {item.overrideReason}
              </span>
            )}
            {item.noCostPrice && (
              <span className="faint" style={{ fontSize: 11 }}>
                {tt('objects.forecast.noCostPriceLine')}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="r num">{money(item.planCost)}</td>
      <td className="r num">{money(item.factCost)}</td>
      <td className="r num">
        {item.donePct == null ? '—' : `${percentText(item.donePct)} (${fmtNumber(item.doneQty)} / ${fmtNumber(item.qty)})`}
      </td>
      <td className="r num">{money(item.remaining)}</td>
      <td className="r num">{money(item.forecast)}</td>
      <td className={negClass(item.deviation)}>{money(item.deviation)}</td>
      <td className="r">
        <IconButton label={tt('objects.forecast.override')} onClick={() => onEdit({ itemId: item.id, name: item.name, remaining: item.remaining ?? '0', reason: item.overrideReason ?? '', exists: item.overridden })}>
          <Pencil size={14} />
        </IconButton>
      </td>
    </tr>
  );
}

/** Итог по категории затрат с раскрытием по позициям */
function CategoryRow({ cat, onEdit }: { cat: ForecastCategory; onEdit: (t: EditTarget) => void }) {
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <tr>
        <td>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            {cat.items.length ? (
              <IconButton label={tt('objects.forecast.expand')} onClick={() => setOpen(o => !o)}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </IconButton>
            ) : (
              <span style={{ width: 24 }} />
            )}
            <b>{tt(CATEGORY_LABEL[cat.category])}</b>
            {cat.overridden && (
              <span className="faint" style={{ fontSize: 11 }}>
                <Badge tone="amber">{tt('objects.forecast.manual')}</Badge> {cat.overrideReason}
              </span>
            )}
          </div>
        </td>
        <td className="r num">{money(cat.planCost)}</td>
        <td className="r num">{money(cat.factCost)}</td>
        <td className="r num">—</td>
        <td className="r num">{money(cat.remaining)}</td>
        <td className="r num">{money(cat.forecast)}</td>
        <td className={negClass(cat.deviation)}>{money(cat.deviation)}</td>
        <td className="r">
          <IconButton
            label={tt('objects.forecast.override')}
            onClick={() => onEdit({ category: cat.category, name: tt(CATEGORY_LABEL[cat.category]), remaining: cat.remaining ?? '0', reason: cat.overrideReason ?? '', exists: cat.overridden })}
          >
            <Pencil size={14} />
          </IconButton>
        </td>
      </tr>
      {open && cat.items.map(item => <ItemRow key={item.id} item={item} onEdit={onEdit} />)}
    </>
  );
}

export function ForecastTab({ objectId }: { objectId: string }) {
  const tt = useT();
  const forecast = useObjectForecast(objectId);
  const executors = useForecastExecutors(objectId);
  const [editing, setEditing] = React.useState<EditTarget | null>(null);
  if (forecast.isPending) return <Skeleton w="100%" h={160} />;
  if (forecast.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} />;
  const f = forecast.data;
  const t = f.totals;
  const loss = t.profit != null && t.profit.startsWith('-');
  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* Шапка: стоимость договора, факт, остаток, прогноз себестоимости, прибыль и маржа */}
      <div className="stats">
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.contract')}</div>
          <div className="v num">{money(t.contractValue)}</div>
          <div className="d">{tt('objects.forecast.total.contractHint')}</div>
        </div>
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.fact')}</div>
          <div className="v num">{money(t.factCost)}</div>
          <div className="d">{tt('objects.forecast.total.factHint')}</div>
        </div>
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.remaining')}</div>
          <div className="v num">{money(t.remaining)}</div>
          <div className="d">{tt('objects.forecast.total.remainingHint')}</div>
        </div>
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.forecast')}</div>
          <div className="v num">{money(t.forecastCost)}</div>
          <div className="d">{tt('objects.forecast.total.forecastHint', { pct: fmtNumber(f.overheadPct, { maximumFractionDigits: 2 }) })}</div>
        </div>
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.profit')}</div>
          <div className={loss ? 'v num neg' : 'v num'}>{money(t.profit)}</div>
          <div className={loss ? 'd bad' : 'd'}>{loss ? tt('objects.forecast.loss') : tt('objects.forecast.total.profitHint')}</div>
        </div>
        <div className="stat">
          <div className="k">{tt('objects.forecast.total.margin')}</div>
          <div className={loss ? 'v num neg' : 'v num'}>{percentText(t.marginPct)}</div>
          <div className="d">{tt('objects.forecast.total.marginHint')}</div>
        </div>
      </div>
      <p className="faint" style={{ fontSize: 11 }}>
        {tt('objects.forecast.computedAt', { at: fmtDateTime(f.computedAt) })} ·{' '}
        {tt('objects.forecast.source', { shifts: String(f.source.shifts), subActs: String(f.source.subActs) })}
      </p>

      {/* Таблица по категориям с раскрытием по позициям сметы */}
      <div className="table-wrap">
        <table className="dtbl" aria-label={tt('objects.forecast.title')}>
          <thead>
            <tr>
              <th>{tt('objects.forecast.column.category')}</th>
              <th className="r" style={{ width: 130 }}>{tt('objects.forecast.column.plan')}</th>
              <th className="r" style={{ width: 130 }}>{tt('objects.forecast.column.fact')}</th>
              <th className="r" style={{ width: 150 }}>{tt('objects.forecast.column.done')}</th>
              <th className="r" style={{ width: 130 }}>{tt('objects.forecast.column.remaining')}</th>
              <th className="r" style={{ width: 130 }}>{tt('objects.forecast.column.forecast')}</th>
              <th className="r" style={{ width: 130 }}>{tt('objects.forecast.column.deviation')}</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {f.categories.map(cat => (
              <CategoryRow key={cat.category} cat={cat} onEdit={setEditing} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><b>{tt('objects.forecast.totalRow')}</b></td>
              <td className="r num"><b>{money(t.planCost)}</b></td>
              <td className="r num"><b>{money(t.factCost)}</b></td>
              <td className="r num">—</td>
              <td className="r num"><b>{money(t.remaining)}</b></td>
              <td className="r num"><b>{money(t.forecastCost)}</b></td>
              <td className={negClass(t.forecastCost == null ? null : fmt(dec(t.forecastCost) - dec(t.planCost), 2))}>
                <b>{t.forecastCost == null ? '—' : fmtAmount(fmt(dec(t.forecastCost) - dec(t.planCost), 2))}</b>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 11 }}>{tt('objects.forecast.hint')}</p>

      {/* Пробелы данных: показываются, а не считаются нулём */}
      <section className="panel" style={{ padding: 12 }} aria-label={tt('objects.forecast.gaps.title')}>
        <b style={{ fontSize: 13 }}>{tt('objects.forecast.gaps.title')}</b>
        {f.gaps.length ? (
          <ul className="col" style={{ gap: 4, margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {f.gaps.map((g, i) => (
              <li key={`${g.code}-${i}`}>
                {g.code === 'no_estimate' && tt('objects.forecast.gaps.no_estimate')}
                {g.code === 'no_cost_price' && tt('objects.forecast.gaps.no_cost_price', { count: String(g.count ?? 0) })}
                {g.code === 'no_labor_fact' && tt('objects.forecast.gaps.no_labor_fact', { name: g.name ?? '' })}
                {g.code === 'no_rate_hours' && tt('objects.forecast.gaps.no_rate_hours', { hours: hours(g.hours), count: String(g.count ?? 0) })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>{tt('objects.forecast.gaps.empty')}</p>
        )}
      </section>

      {/* Исполнители: подтверждённые смены объекта */}
      <section className="panel" style={{ padding: 12 }} aria-label={tt('objects.forecast.executors.title')}>
        <b style={{ fontSize: 13 }}>{tt('objects.forecast.executors.title')}</b>
        {executors.isPending ? (
          <Skeleton w="100%" h={60} />
        ) : !executors.data?.items.length ? (
          <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>{tt('objects.forecast.executors.empty')}</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="dtbl">
              <thead>
                <tr>
                  <th>{tt('objects.forecast.executors.member')}</th>
                  <th>{tt('objects.forecast.executors.positions')}</th>
                  <th className="r" style={{ width: 110 }}>{tt('objects.forecast.executors.hours')}</th>
                  <th className="r" style={{ width: 130 }}>{tt('objects.forecast.executors.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {executors.data.items.map(e => (
                  <tr key={e.memberId}>
                    <td>
                      {e.memberName}
                      {e.personnelNumber && <span className="faint"> · {e.personnelNumber}</span>}
                    </td>
                    <td className="muted">
                      {e.positions.map(p => `${p.name ?? tt('objects.forecast.executors.noPosition')} — ${hours(p.hours)} ч`).join('; ')}
                      {e.hoursWithoutCost !== '0.00' && <div className="neg">{tt('objects.forecast.executors.noRate', { hours: hours(e.hoursWithoutCost) })}</div>}
                    </td>
                    <td className="r num">{hours(e.hours)}</td>
                    <td className="r num">{money(e.costAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><b>{tt('objects.forecast.totalRow')}</b></td>
                  <td className="r num"><b>{hours(executors.data.totals.hours)}</b></td>
                  <td className="r num"><b>{money(executors.data.totals.costAmount)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Выручка для справки: выполнено / принято / выставлено / оплачено */}
      <section className="panel" style={{ padding: 12 }} aria-label={tt('objects.forecast.revenue.title')}>
        <b style={{ fontSize: 13 }}>{tt('objects.forecast.revenue.title')}</b>
        <div className="stats" style={{ marginTop: 8, padding: 0 }}>
          <div className="stat">
            <div className="k">{tt('objects.forecast.revenue.done')}</div>
            <div className="v num">{money(f.revenue.done)}</div>
          </div>
          <div className="stat">
            <div className="k">{tt('objects.forecast.revenue.accepted')}</div>
            <div className="v num">{money(f.revenue.accepted)}</div>
          </div>
          <div className="stat">
            <div className="k">{tt('objects.forecast.revenue.invoiced')}</div>
            <div className="v num">{money(f.revenue.invoiced)}</div>
          </div>
          <div className="stat">
            <div className="k">{tt('objects.forecast.revenue.paid')}</div>
            <div className="v num">{money(f.revenue.paid)}</div>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>{tt('objects.forecast.revenue.hint')}</p>
      </section>

      {editing && <OverrideDialog objectId={objectId} target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
