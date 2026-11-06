/* Рейтинг поставщиков (задача 1276): сводка за период — сроки, полнота, качество, итог и уровень A/B/C/D.
   Строка открывает карточку поставщика (документы с плановой датой, вовремя, заказано и получено, отклонено, возвращено).
   Веса показателей и политику при уровне D меняет владелец и администратор в диалоге настроек. */
import * as React from 'react';
import { CircleAlert, Settings2, Star } from 'lucide-react';
import type { SupplierRatingLevel } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, toast, Tooltip, type Tone } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { useT } from '@/i18n';
import { fmtNumber, parseNumber } from '@/i18n/format';
import { fmtDate, parse } from '../lib/dates';
import { useIsAdmin } from '../catalog/data';
import { useModuleReady } from '../licensing/data';
import {
  defaultSupplierRatingPeriod,
  useSaveSupplierRatingSettings,
  useSupplierRating,
  useSupplierRatingSettings,
  useSupplierRatings,
  type SupplierRatingDPolicy,
  type SupplierRatingRow,
} from './supplier-rating-data';
import { DateInput } from '@/components/gr8r/date-picker';

const LEVEL_TONE: Record<SupplierRatingLevel, Tone> = { A: 'green', B: 'accent', C: 'amber', D: 'red' };

/** Уровень поставщика: бейдж A/B/C/D; пока рейтинга нет — прочерк */
export function SupplierLevelBadge({ level }: { level: SupplierRatingLevel | null }) {
  if (!level) return <span className="faint">—</span>;
  return (
    <Badge tone={LEVEL_TONE[level]} dot>
      {level}
    </Badge>
  );
}

/** Бейдж «Рейтинг A» рядом с названием контрагента: только когда включён модуль «Торговля» и рейтинг есть.
    Период — 12 месяцев по умолчанию (его же берёт расчёт на сервере). */
export function SupplierRatingBadge({ companyId }: { companyId: string }) {
  const t = useT();
  const trade = useModuleReady('trade');
  const q = useSupplierRating(trade ? companyId : null);
  const level = q.data?.level;
  if (!trade || !level) return null;
  return (
    <Tooltip content={t('supplierRating.companyBadgeHint')}>
      <Badge tone={LEVEL_TONE[level]} dot>
        {t('supplierRating.companyBadge', { level })}
      </Badge>
    </Tooltip>
  );
}

/** Процент по правилам языка; пусто — прочерк */
function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="faint">—</span>;
  return <span className="num">{fmtNumber(value, { maximumFractionDigits: 1 })}</span>;
}

/** Количество из документа: строка decimal, дробная часть — до трёх знаков */
const qty = (v: string | null) => fmtNumber(v ?? 0, { maximumFractionDigits: 3 });

export function SupplierRatingsPage() {
  const t = useT();
  const def = React.useMemo(defaultSupplierRatingPeriod, []);
  const [from, setFrom] = React.useState(def.from);
  const [to, setTo] = React.useState(def.to);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const isAdmin = useIsAdmin();
  const filters = useFilterState();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const h = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(h);
  }, [filters.q]);

  const list = useSupplierRatings({ from, to });
  const all = list.data ?? [];
  const rows = React.useMemo(() => (q ? all.filter(r => r.companyName.toLowerCase().includes(q.toLowerCase())) : all), [all, q]);

  const columns = React.useMemo<Column<SupplierRatingRow>[]>(
    () => [
      { id: 'supplier', header: t('supplierRating.col.supplier'), width: 300, value: r => r.companyName, cell: r => <span className="trunc">{r.companyName}</span> },
      { id: 'orders', header: t('supplierRating.col.orders'), width: 96, align: 'right', value: r => r.ordersCount, cell: r => <span className="num">{fmtNumber(r.ordersCount)}</span> },
      { id: 'onTime', header: t('supplierRating.col.onTime'), width: 112, align: 'right', value: r => r.onTimeRate, cell: r => <Pct value={r.onTimeRate} /> },
      { id: 'completeness', header: t('supplierRating.col.completeness'), width: 128, align: 'right', value: r => r.completenessRate, cell: r => <Pct value={r.completenessRate} /> },
      { id: 'quality', header: t('supplierRating.col.quality'), width: 112, align: 'right', value: r => r.qualityRate, cell: r => <Pct value={r.qualityRate} /> },
      { id: 'total', header: t('supplierRating.col.total'), width: 96, align: 'right', value: r => r.rating, cell: r => <Pct value={r.rating} /> },
      { id: 'level', header: t('supplierRating.col.level'), width: 96, value: r => r.level ?? '', cell: r => <SupplierLevelBadge level={r.level} /> },
    ],
    [t],
  );
  // по умолчанию — от лучшего итога к худшему
  const table = useDataTable(columns, { sort: { id: 'total', dir: -1 } });

  const resetPeriod = () => {
    const p = defaultSupplierRatingPeriod();
    setFrom(p.from);
    setTo(p.to);
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('supplierRating.title')}</h1>
          <p>{t('supplierRating.lead')}</p>
        </div>
        {isAdmin && (
          <div className="acts">
            <Button onClick={() => setSettingsOpen(true)}>
              <Settings2 size={14} />
              {t('supplierRating.settings.open')}
            </Button>
          </div>
        )}
      </div>

      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('supplierRating.col.supplier') }}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        left={
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <DateInput size="sm" aria-label={t('supplierRating.period.from')} value={from} max={to} onChange={v => v && setFrom(v)} style={{ width: 148 }} required />
            <span className="muted" style={{ fontSize: 13 }}>
              {t('supplierRating.period.to')}
            </span>
            <DateInput size="sm" aria-label={t('supplierRating.period.to')} value={to} min={from} onChange={v => v && setTo(v)} style={{ width: 148 }} required />
            <Button size="sm" variant="ghost" onClick={resetPeriod}>
              {t('supplierRating.period.reset')}
            </Button>
          </div>
        }
      />

      {list.isPending ? (
        <div style={{ padding: '0 var(--gutter) 24px' }}>
          <Skeleton w="100%" h={180} />
        </div>
      ) : list.isError ? (
        <EmptyState
          icon={<CircleAlert size={20} />}
          error
          title={t('supplierRating.loadError')}
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {(list.error as Error).message}
        </EmptyState>
      ) : (
        <DataTable
          aria-label={t('supplierRating.title')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.companyId}
          onRowClick={r => setOpenId(r.companyId)}
          empty={
            <EmptyState icon={<Star size={20} />} title={t('supplierRating.empty.title')}>
              {t('supplierRating.empty.hint')}
            </EmptyState>
          }
        />
      )}

      <SupplierRatingDialog companyId={openId} from={from} to={to} onClose={() => setOpenId(null)} />
      {isAdmin && <SupplierRatingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </div>
  );
}

/* ---------------- карточка поставщика ---------------- */

function SupplierRatingDialog({ companyId, from, to, onClose }: { companyId: string | null; from: string; to: string; onClose: () => void }) {
  const t = useT();
  const q = useSupplierRating(companyId, { from, to });
  const d = q.data;
  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </>
  );
  return (
    <Dialog open={!!companyId} onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('supplierRating.detail.title')}
        description={d?.companyName || undefined}
        size="sm"
        footer={
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        {q.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error title={t('supplierRating.loadError')}>
            {(q.error as Error).message}
          </EmptyState>
        ) : !d ? (
          <Skeleton w="100%" h={160} />
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <SupplierLevelBadge level={d.level} />
              <Badge tone="gray">
                {t('supplierRating.col.total')}: <Pct value={d.rating} />
              </Badge>
              <span className="faint" style={{ fontSize: 12 }}>
                {fmtDate(parse(d.from))} — {fmtDate(parse(d.to))}
              </span>
            </div>
            <dl className="kv" style={{ margin: 0 }}>
              {row(t('supplierRating.col.onTime'), <Pct value={d.onTimeRate} />)}
              {row(t('supplierRating.col.completeness'), <Pct value={d.completenessRate} />)}
              {row(t('supplierRating.col.quality'), <Pct value={d.qualityRate} />)}
              {row(t('supplierRating.col.orders'), fmtNumber(d.ordersCount))}
              {row(t('supplierRating.detail.ordersWithDueDate'), fmtNumber(d.dueDateOrders))}
              {row(t('supplierRating.detail.onTimeOrders'), fmtNumber(d.onTimeOrders))}
              {row(t('supplierRating.detail.orderedQty'), qty(d.orderedQty))}
              {row(t('supplierRating.detail.receivedQty'), qty(d.receivedQty))}
              {row(t('supplierRating.detail.rejectedQty'), qty(d.rejectedQty))}
              {row(t('supplierRating.detail.returnedQty'), qty(d.returnedQty))}
            </dl>
            {d.ordersCount === 0 && (
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                {t('supplierRating.detail.noData')}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- настройки рейтинга ---------------- */

const POLICY_OPTIONS: SupplierRatingDPolicy[] = ['none', 'warn', 'block'];

function SupplierRatingSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const q = useSupplierRatingSettings(open);
  const save = useSaveSupplierRatingSettings();
  const [onTime, setOnTime] = React.useState('40');
  const [completeness, setCompleteness] = React.useState('30');
  const [quality, setQuality] = React.useState('30');
  const [policy, setPolicy] = React.useState<SupplierRatingDPolicy>('none');
  // сохранённые значения подставляем, когда пришёл ответ; дальше правит пользователь
  React.useEffect(() => {
    if (!q.data) return;
    setOnTime(String(q.data.weights.onTime));
    setCompleteness(String(q.data.weights.completeness));
    setQuality(String(q.data.weights.quality));
    setPolicy(q.data.dPolicy);
  }, [q.data]);

  const weights = { onTime: parseNumber(onTime), completeness: parseNumber(completeness), quality: parseNumber(quality) };
  const badWeights = Object.values(weights).some(n => !Number.isFinite(n) || n < 0) || weights.onTime + weights.completeness + weights.quality <= 0;

  const submit = async () => {
    try {
      await save.mutateAsync({ weights, dPolicy: policy });
      toast(t('supplierRating.settings.saved'), { duration: 1500 });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('supplierRating.settings.title')}
        description={t('supplierRating.settings.lead')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={badWeights || save.isPending} onClick={() => void submit()}>
              {t('supplierRating.settings.save')}
            </Button>
          </>
        }
      >
        {q.isPending ? (
          <Skeleton w="100%" h={160} />
        ) : q.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error title={t('supplierRating.loadError')}>
            {(q.error as Error).message}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <h3 className="sub">{t('supplierRating.settings.weights')}</h3>
            <div className="row" style={{ gap: 8 }}>
              <Field className="grow" label={t('supplierRating.settings.onTime')} error={badWeights ? t('supplierRating.settings.badWeights') : undefined}>
                {p => <Input {...p} value={onTime} inputMode="decimal" onChange={e => setOnTime(e.target.value)} />}
              </Field>
              <Field className="grow" label={t('supplierRating.settings.completeness')}>
                {p => <Input {...p} value={completeness} inputMode="decimal" onChange={e => setCompleteness(e.target.value)} />}
              </Field>
              <Field className="grow" label={t('supplierRating.settings.quality')}>
                {p => <Input {...p} value={quality} inputMode="decimal" onChange={e => setQuality(e.target.value)} />}
              </Field>
            </div>
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              {t('supplierRating.settings.weightsHint')}
            </p>
            <Field label={t('supplierRating.settings.dPolicy')} hint={t('supplierRating.settings.dPolicyHint')}>
              {p => (
                <Select
                  id={p.id}
                  aria-describedby={p['aria-describedby']}
                  invalid={p.invalid}
                  value={policy}
                  onValueChange={v => setPolicy(v as SupplierRatingDPolicy)}
                  options={POLICY_OPTIONS.map(v => ({ value: v, label: t(`supplierRating.settings.policy.${v}` as 'supplierRating.settings.policy.none') }))}
                />
              )}
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
