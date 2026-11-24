/* Весовая (модуль «Добыча»): журнал взвешиваний с фильтрами, KPI-сводкой, диалогом и подсказкой по Scale API */
import * as React from 'react';
import { Info, Plus, Scale } from 'lucide-react';
import type { WeighingDirection } from '@erp/shared';
import { Badge, Button, EmptyState, Field, Input, Popover, PopoverContent, PopoverTrigger, Segmented, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/erp/data-table';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { FleetHead } from '../fleet/parts';
import { useWeighings, type Weighing } from './data';
import { WeighingDialog } from './WeighingDialog';

const API_SAMPLE = `{
  "direction": "out",
  "plateNumber": "A123BC77",
  "grossKg": 32400,
  "tareKg": 12400,
  "bulkDensity": 1.6,
  "source": "scale_api"
}`;

export function WeighingsPage() {
  const t = useT();
  const [direction, setDirection] = React.useState<'all' | WeighingDirection>('all');
  const [q, setQ] = React.useState('');
  const [edit, setEdit] = React.useState<Weighing | 'new' | null>(null);
  const query = useWeighings({ direction, q });
  const rows = query.data?.items ?? [];
  const summary = query.data?.summary ?? { count: 0, totalNetKg: 0, totalVolumeM3: 0 };

  const columns = React.useMemo<Column<Weighing>[]>(
    () => [
      { id: 'number', header: t('mining.col.number'), width: 100, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'date', header: t('mining.col.date'), width: 120, value: r => r.weighedAt, cell: r => <span className="num">{fmtDate(new Date(r.weighedAt))}</span> },
      {
        id: 'direction',
        header: t('mining.col.direction'),
        width: 110,
        value: r => r.direction,
        cell: r => <Badge tone={r.direction === 'out' ? 'accent' : 'green'}>{t(`mining.direction.${r.direction}`)}</Badge>,
      },
      { id: 'vehicle', header: t('mining.col.vehicle'), width: 130, value: r => r.vehiclePlate || r.plateNumber, cell: r => <span>{r.vehiclePlate || r.plateNumber || '—'}</span> },
      { id: 'counterparty', header: t('mining.col.counterparty'), width: 170, value: r => r.counterpartyName ?? '', cell: r => <span className="trunc">{r.counterpartyName ?? '—'}</span> },
      { id: 'product', header: t('mining.col.product'), width: 170, value: r => r.productName ?? '', cell: r => <span className="trunc">{r.productName ?? '—'}</span> },
      { id: 'gross', header: t('mining.col.gross'), width: 105, align: 'right', value: r => Number(r.grossKg), cell: r => <span className="num muted">{fmtNumber(r.grossKg)}</span> },
      { id: 'tare', header: t('mining.col.tare'), width: 100, align: 'right', value: r => Number(r.tareKg), cell: r => <span className="num muted">{fmtNumber(r.tareKg)}</span> },
      {
        id: 'net',
        header: t('mining.col.net'),
        width: 145,
        align: 'right',
        value: r => Number(r.netKg),
        cell: r => (
          <span className="num">
            <b>{fmtNumber(r.netKg)}</b> <span className="muted">({fmtNumber(Number(r.netKg) / 1000, { maximumFractionDigits: 2 })} {t('mining.unit.t')})</span>
          </span>
        ),
      },
      { id: 'volume', header: t('mining.col.volume'), width: 105, align: 'right', value: r => Number(r.volumeM3 ?? 0), cell: r => <span className="num">{r.volumeM3 ? fmtNumber(r.volumeM3, { maximumFractionDigits: 3 }) : '—'}</span> },
      { id: 'waybill', header: t('mining.col.waybill'), width: 110, value: r => r.waybillNumber, cell: r => <span className="muted">{r.waybillNumber || '—'}</span> },
      {
        id: 'source',
        header: t('mining.col.source'),
        width: 105,
        value: r => r.source,
        cell: r => <Badge tone={r.source === 'scale_api' ? 'amber' : 'gray'}>{t(`mining.source.${r.source}`)}</Badge>,
      },
    ],
    [t],
  );

  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });

  return (
    <div className="page flush">
      <FleetHead
        title={t('mining.title')}
        lead={t('mining.lead')}
        actions={
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Info size={13} />
                  {t('mining.api.title')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" style={{ width: 340, padding: 12 }}>
                <div className="stack" style={{ gap: 8 }}>
                  <b>{t('mining.api.title')}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{t('mining.api.hint')}</span>
                  <pre className="mono" style={{ fontSize: 11, margin: 0, padding: 8, background: 'var(--bg-subtle)', borderRadius: 6, overflowX: 'auto' }}>{API_SAMPLE}</pre>
                </div>
              </PopoverContent>
            </Popover>
            <Button size="sm" onClick={() => setEdit('new')}>
              <Plus size={13} />
              {t('mining.new')}
            </Button>
          </>
        }
      />
      <section className="panel plain" style={{ margin: '0 var(--gutter) 12px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Segmented
              value={direction}
              onValueChange={setDirection}
              items={[
                { value: 'all', label: t('mining.filter.all') },
                { value: 'out', label: t('mining.filter.out') },
                { value: 'in', label: t('mining.filter.in') },
              ]}
            />
            <Field label={t('mining.search')}>
              {p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <div><span className="muted">{t('mining.kpi.count')}: </span><b className="num">{fmtNumber(summary.count)}</b></div>
            <div><span className="muted">{t('mining.kpi.net')}: </span><b className="num">{fmtNumber(summary.totalNetKg / 1000, { maximumFractionDigits: 3 })}</b></div>
            <div><span className="muted">{t('mining.kpi.volume')}: </span><b className="num">{fmtNumber(summary.totalVolumeM3, { maximumFractionDigits: 3 })}</b></div>
          </div>
        </div>
      </section>
      {query.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable
          aria-label={t('mining.title')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={r => setEdit(r)}
          empty={<EmptyState icon={<Scale size={20} />} title={t('mining.empty')}>{t('mining.emptyHint')}</EmptyState>}
        />
      )}
      {edit && <WeighingDialog key={edit === 'new' ? 'new' : edit.id} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
