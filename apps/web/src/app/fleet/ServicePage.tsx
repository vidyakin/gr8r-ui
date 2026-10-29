/* Автопарк → ТО и ремонты (задача 1210): регламент ТО по пробегу и/или сроку (что пора делать) и ремонты как документы с запчастями
   со склада и работами. Проведение списывает запчасти документом «Списание» на статью «Ремонт и ТО транспорта», затраты считаются
   по машине (раздел «Автопарк»). Проведённое ТО по пункту регламента отмечает его выполненным. */
import * as React from 'react';
import { Link } from 'react-router';
import { Plus, Wrench } from 'lucide-react';
import { REPAIR_KINDS, type RepairKind } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { dec, add as decAdd, mul as decMul, fmt as decFmt } from '@gr8r/shared';
import { iso, today, fmtDate, parse } from '../lib/dates';
import { useProducts } from '../catalog/data';
import { useWarehouses } from '../docs/data';
import { useFleetApi, useRepair, useRepairs, useServicePlans, useVehicles, type Repair, type RepairLine, type ServicePlan } from './data';
import { FleetHead, FormDialog, intOrNull, num, orNull } from './parts';

const ALL = 'all';
const NONE = 'none';

function PlanDialog({ plan, onClose }: { plan: ServicePlan | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  return (
    <FormDialog
      title={plan ? plan.name : t('fleet.service.newPlan')}
      fields={[
        { key: 'vehicleId', label: t('fleet.fuel.vehicle'), type: 'select', required: true, options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })) },
        { key: 'name', label: t('fleet.service.planName'), type: 'text', required: true },
        { key: 'everyKm', label: t('fleet.service.everyKm'), type: 'number' },
        { key: 'everyMonths', label: t('fleet.service.everyMonths'), type: 'number' },
        { key: 'lastKm', label: t('fleet.service.lastKm'), type: 'number', hint: t('fleet.service.lastHint') },
        { key: 'lastDate', label: t('fleet.service.lastDate'), type: 'date' },
      ]}
      initial={{ vehicleId: plan?.vehicleId ?? vehicles[0]?.id ?? '', name: plan?.name ?? '', everyKm: plan?.everyKm ? String(plan.everyKm) : '', everyMonths: plan?.everyMonths ? String(plan.everyMonths) : '', lastKm: plan?.lastKm ? String(Number(plan.lastKm)) : '', lastDate: plan?.lastDate ?? '' }}
      onClose={onClose}
      footerExtra={
        plan ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (await api('DELETE', `service-plans/${plan.id}`)) onClose();
            }}
          >
            {t('fleet.delete')}
          </Button>
        ) : null
      }
      onSubmit={async v => {
        const data = { vehicleId: String(v.vehicleId), name: String(v.name).trim(), everyKm: intOrNull(v.everyKm), everyMonths: intOrNull(v.everyMonths), lastKm: num(v.lastKm) ?? null, lastDate: orNull(v.lastDate) };
        return !!(plan ? await api('PATCH', `service-plans/${plan.id}`, data) : await api('POST', 'service-plans', data));
      }}
    />
  );
}

function PlansTab() {
  const t = useT();
  const list = useServicePlans();
  const [edit, setEdit] = React.useState<ServicePlan | 'new' | null>(null);
  const columns = React.useMemo<Column<ServicePlan>[]>(
    () => [
      { id: 'vehicle', header: t('fleet.fuel.vehicle'), width: 120, value: r => r.plate, cell: r => <b>{r.plate}</b> },
      { id: 'name', header: t('fleet.service.planName'), width: 230, value: r => r.name, cell: r => r.name },
      { id: 'interval', header: t('fleet.service.interval'), width: 190, value: r => r.everyKm ?? 0, cell: r => <span className="muted">{[r.everyKm ? `${fmtNumber(r.everyKm)} ${t('fleet.unit.km')}` : '', r.everyMonths ? `${r.everyMonths} ${t('fleet.unit.months')}` : ''].filter(Boolean).join(' / ')}</span> },
      { id: 'last', header: t('fleet.service.last'), width: 190, value: r => r.lastDate ?? '', cell: r => <span className="num muted">{r.lastKm ? `${fmtNumber(r.lastKm)} ${t('fleet.unit.km')}` : ''}{r.lastDate ? ` · ${fmtDate(parse(r.lastDate))}` : ''}</span> },
      { id: 'next', header: t('fleet.service.next'), width: 190, value: r => Number(r.due.leftKm ?? 1e9), cell: r => <span className="num">{r.due.dueKm ? `${fmtNumber(r.due.dueKm)} ${t('fleet.unit.km')}` : ''}{r.due.dueDate ? ` · ${fmtDate(parse(r.due.dueDate))}` : ''}</span> },
      {
        id: 'state',
        header: t('fleet.service.state'),
        width: 190,
        value: r => (r.due.overdue ? 0 : r.due.soon ? 1 : 2),
        cell: r => {
          const text = [r.due.leftKm !== null ? t('fleet.service.leftKm', { km: fmtNumber(r.due.leftKm) }) : '', r.due.leftDays !== null ? t('fleet.service.leftDays', { d: r.due.leftDays }) : ''].filter(Boolean).join(' · ');
          return <Badge tone={r.due.overdue ? 'red' : r.due.soon ? 'amber' : 'green'}>{r.due.overdue ? t('fleet.service.overdue') : text || '—'}</Badge>;
        },
      },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'state', dir: 1 } });
  return (
    <>
      <div className="row" style={{ margin: '0 var(--gutter) 12px' }}>
        <Button size="sm" variant="ghost" onClick={() => setEdit('new')}>
          <Plus size={13} />
          {t('fleet.service.newPlan')}
        </Button>
      </div>
      <DataTable aria-label={t('fleet.service.plans')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={setEdit} empty={<EmptyState icon={<Wrench size={20} />} title={t('fleet.service.noPlans')}>{t('fleet.service.noPlansHint')}</EmptyState>} />
      {edit && <PlanDialog key={edit === 'new' ? 'new' : edit.id} plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const blankLine = (kind: 'part' | 'work'): RepairLine => ({ kind, productId: null, name: '', qty: '1', price: '0' });

function RepairDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const api = useFleetApi();
  const vehicles = useVehicles().data?.items ?? [];
  const warehouses = useWarehouses().data ?? [];
  const goods = useProducts({ kind: 'goods' }).data ?? [];
  const plans = useServicePlans().data?.items ?? [];
  const detail = useRepair(id);
  const r = id ? detail.data : null;
  const [lines, setLines] = React.useState<RepairLine[]>([]);
  const [loaded, setLoaded] = React.useState(!id);
  React.useEffect(() => {
    if (r && !loaded) {
      setLines((r.lines ?? []).map(l => ({ ...l, qty: String(Number(l.qty)), price: String(Number(l.price)) })));
      setLoaded(true);
    }
  }, [r, loaded]);
  if (id && !r) return null;
  const posted = r?.status === 'posted';
  const draft = !r || r.status === 'draft';
  const setLine = (i: number, patch: Partial<RepairLine>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const direct = lines.filter(l => !l.productId).reduce((s, l) => decAdd(s, decMul(dec(l.qty || '0'), dec(l.price || '0'))), 0n);
  const payload = (v: Record<string, string | boolean>) => ({
    vehicleId: String(v.vehicleId),
    kind: v.kind as RepairKind,
    date: String(v.date),
    odometer: num(v.odometer) ?? null,
    planId: v.planId === NONE ? null : String(v.planId),
    warehouseId: v.warehouseId === NONE ? null : String(v.warehouseId),
    description: String(v.description),
    lines: lines.filter(l => l.name.trim() || l.productId).map(l => ({ kind: l.kind, productId: l.kind === 'part' ? l.productId : null, name: l.name.trim() || goods.find(g => g.id === l.productId)?.name || '—', qty: num(l.qty) ?? '1', price: l.productId ? '0' : num(l.price) ?? '0' })),
  });
  const save = (v: Record<string, string | boolean>) => (r ? api<Repair>('PATCH', `repairs/${r.id}`, payload(v)) : api<Repair>('POST', 'repairs', payload(v)));
  return (
    <FormDialog
      title={r ? `${r.number} · ${t(`fleet.repairKind.${r.kind}`)}` : t('fleet.repair.new')}
      description={r ? t(`fleet.repairStatus.${r.status}`) : undefined}
      size="lg"
      hideSubmit={!draft}
      fields={[
        { key: 'vehicleId', label: t('fleet.fuel.vehicle'), type: 'select', required: true, options: vehicles.map(v => ({ value: v.id, label: `${v.plate} ${v.name}`.trim() })) },
        { key: 'kind', label: t('fleet.repair.kind'), type: 'select', options: REPAIR_KINDS.map(k => ({ value: k, label: t(`fleet.repairKind.${k}`) })) },
        { key: 'date', label: t('fleet.repair.date'), type: 'date', required: true },
        { key: 'odometer', label: t('fleet.vehicle.odometer'), type: 'number' },
        { key: 'planId', label: t('fleet.repair.plan'), type: 'select', options: [{ value: NONE, label: t('fleet.repair.noPlan') }, ...plans.map(p => ({ value: p.id, label: `${p.plate} · ${p.name}` }))] },
        { key: 'warehouseId', label: t('fleet.repair.warehouse'), type: 'select', hint: t('fleet.repair.warehouseHint'), options: [{ value: NONE, label: t('fleet.repair.noWarehouse') }, ...warehouses.map(w => ({ value: w.id, label: w.name }))] },
        { key: 'description', label: t('fleet.repair.description'), type: 'textarea' },
      ]}
      initial={{ vehicleId: r?.vehicleId ?? vehicles[0]?.id ?? '', kind: r?.kind ?? 'repair', date: r?.date ?? iso(today()), odometer: r?.odometer ? String(Number(r.odometer)) : '', planId: r?.planId ?? NONE, warehouseId: r?.warehouseId ?? NONE, description: r?.description ?? '' }}
      onClose={onClose}
      onSubmit={async v => !!(await save(v))}
      footerExtra={(v, close) =>
        r ? (
          <>
            {draft && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await api('DELETE', `repairs/${r.id}`)) close();
                }}
              >
                {t('fleet.delete')}
              </Button>
            )}
            {draft && (
              <Button
                variant="secondary"
                onClick={async () => {
                  if ((await save(v)) && (await api('POST', `repairs/${r.id}/post`))) close();
                }}
              >
                {t('fleet.repair.post')}
              </Button>
            )}
            {posted && (
              <Button
                variant="secondary"
                onClick={async () => {
                  if (await api('POST', `repairs/${r.id}/unpost`)) close();
                }}
              >
                {t('fleet.repair.unpost')}
              </Button>
            )}
          </>
        ) : null
      }
      extra={() => (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label">{t('fleet.repair.lines')}</div>
            {draft && (
              <span className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => setLines(ls => [...ls, blankLine('part')])}>{t('fleet.repair.addPart')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setLines(ls => [...ls, blankLine('work')])}>{t('fleet.repair.addWork')}</Button>
              </span>
            )}
          </div>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Badge tone={l.kind === 'part' ? 'accent' : 'violet'}>{t(`fleet.repair.line.${l.kind}`)}</Badge>
              {l.kind === 'part' && (
                <Select size="sm" disabled={!draft} aria-label={t('fleet.repair.stockPart')} value={l.productId ?? NONE} onValueChange={x => setLine(i, { productId: x === NONE ? null : x, name: x === NONE ? l.name : goods.find(g => g.id === x)?.name ?? l.name })} options={[{ value: NONE, label: t('fleet.repair.boughtPart') }, ...goods.map(g => ({ value: g.id, label: g.name }))]} />
              )}
              <Input size="sm" style={{ minWidth: 220, flex: 1 }} disabled={!draft} aria-label={t('fleet.repair.lineName')} placeholder={t('fleet.repair.lineName')} value={l.name} onChange={e => setLine(i, { name: e.target.value })} />
              <Input size="sm" style={{ width: 80 }} inputMode="decimal" disabled={!draft} aria-label={t('fleet.repair.qty')} value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} />
              {l.productId ? <span className="muted" style={{ width: 110, textAlign: 'right' }}>{t('fleet.repair.byStockCost')}</span> : <Input size="sm" style={{ width: 110 }} inputMode="decimal" disabled={!draft} aria-label={t('fleet.repair.price')} value={l.price} onChange={e => setLine(i, { price: e.target.value })} />}
              {draft && <Button size="sm" variant="ghost" aria-label={t('fleet.delete')} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>×</Button>}
            </div>
          ))}
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span>{t('fleet.repair.direct')}: <b className="num">{fmtAmount(decFmt(direct, 2))}</b></span>
            {posted && r && (
              <>
                <span>{t('fleet.repair.parts')}: <b className="num">{fmtAmount(r.partsCost)}</b></span>
                {r.writeOffDocumentId && <Link className="crm-link" to={`/documents/${r.writeOffDocumentId}`}>{t('fleet.repair.writeOff')}</Link>}
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}

function RepairsTab() {
  const t = useT();
  const vehicles = useVehicles().data?.items ?? [];
  const [from, setFrom] = React.useState(iso(new Date(today().getTime() - 90 * 86400000)));
  const [to, setTo] = React.useState(iso(today()));
  const [vehicle, setVehicle] = React.useState(ALL);
  const [kind, setKind] = React.useState(ALL);
  const list = useRepairs({ from, to, ...(vehicle === ALL ? {} : { vehicleId: vehicle }), ...(kind === ALL ? {} : { kind }) });
  const [edit, setEdit] = React.useState<string | 'new' | null>(null);
  const columns = React.useMemo<Column<Repair>[]>(
    () => [
      { id: 'number', header: t('fleet.repair.number'), width: 150, value: r => r.number, cell: r => <b>{r.number}</b> },
      { id: 'date', header: t('fleet.repair.date'), width: 110, value: r => r.date, cell: r => <span className="num">{fmtDate(parse(r.date))}</span> },
      { id: 'vehicle', header: t('fleet.fuel.vehicle'), width: 120, value: r => r.plate, cell: r => r.plate },
      { id: 'kind', header: t('fleet.repair.kind'), width: 120, value: r => r.kind, cell: r => t(`fleet.repairKind.${r.kind}`) },
      { id: 'description', header: t('fleet.repair.description'), width: 280, value: r => r.description, cell: r => <span className="trunc muted">{r.description || '—'}</span> },
      { id: 'parts', header: t('fleet.repair.parts'), width: 120, align: 'right', value: r => Number(r.partsCost), cell: r => <span className="num">{fmtAmount(r.partsCost)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.partsCost), 0))}</span> },
      { id: 'direct', header: t('fleet.repair.direct'), width: 120, align: 'right', value: r => Number(r.directCost), cell: r => <span className="num">{fmtAmount(r.directCost)}</span>, total: rows => <span className="num">{fmtAmount(rows.reduce((s, r) => s + Number(r.directCost), 0))}</span> },
      { id: 'status', header: t('fleet.repair.status'), width: 120, value: r => r.status, cell: r => <Badge tone={r.status === 'posted' ? 'green' : r.status === 'cancelled' ? 'red' : 'gray'}>{t(`fleet.repairStatus.${r.status}`)}</Badge> },
    ],
    [t],
  );
  const table = useDataTable(columns, { sort: { id: 'date', dir: -1 } });
  return (
    <>
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('fleet.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={t('fleet.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={t('fleet.fuel.vehicle')}>
            {p => <Select id={p.id} aria-label={t('fleet.fuel.vehicle')} value={vehicle} onValueChange={setVehicle} options={[{ value: ALL, label: t('fleet.all') }, ...vehicles.map(v => ({ value: v.id, label: v.plate }))]} />}
          </Field>
          <Field label={t('fleet.repair.kind')}>
            {p => <Select id={p.id} aria-label={t('fleet.repair.kind')} value={kind} onValueChange={setKind} options={[{ value: ALL, label: t('fleet.all') }, ...REPAIR_KINDS.map(k => ({ value: k, label: t(`fleet.repairKind.${k}`) }))]} />}
          </Field>
          <Button size="sm" onClick={() => setEdit('new')}>
            <Plus size={13} />
            {t('fleet.repair.new')}
          </Button>
        </div>
      </section>
      {list.isPending ? (
        <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>
      ) : (
        <DataTable aria-label={t('fleet.repair.title')} columns={columns} rows={list.data?.items ?? []} table={table} getId={r => r.id} onRowClick={r => setEdit(r.id)} empty={<EmptyState icon={<Wrench size={20} />} title={t('fleet.repair.empty')}>{t('fleet.repair.emptyHint')}</EmptyState>} />
      )}
      {edit && <RepairDialog key={edit} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function ServicePage() {
  const t = useT();
  const [tab, setTab] = React.useState<'plans' | 'repairs'>('plans');
  return (
    <div className="page flush">
      <FleetHead title={t('fleet.service.title')} lead={t('fleet.service.lead')} />
      <nav className="tabs doc-tabs" aria-label={t('fleet.service.title')}>
        {(['plans', 'repairs'] as const).map(x => (
          <button key={x} type="button" className={`tab${x === tab ? ' on' : ''}`} aria-current={x === tab ? 'page' : undefined} onClick={() => setTab(x)}>
            {x === 'plans' ? t('fleet.service.plans') : t('fleet.repair.title')}
          </button>
        ))}
      </nav>
      {tab === 'plans' ? <PlansTab /> : <RepairsTab />}
    </div>
  );
}
