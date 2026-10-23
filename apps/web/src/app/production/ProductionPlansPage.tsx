/* Журнал планов производства: период, склад продукции, состояние и число строк. План открывается в карточке
   с периодами в колонках; заказы по плану — в рабочем месте /production/plan-orders. */
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarRange, CircleAlert, ClipboardList, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { useWarehouses } from '../docs/data';
import { useWorkCenters } from '../catalog/data';
import { errorMessage } from '../data/api';
import { useProductionPlanApi, useProductionPlans, type PlanListItem } from './plans-data';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved' };
const STATUS_TONE: Record<string, 'gray' | 'green'> = { draft: 'gray', approved: 'green' };
const STEP_LABEL: Record<string, string> = { week: 'Week', month: 'Month' };

export function ProductionPlansPage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const api = useProductionPlanApi();
  const warehouses = useWarehouses();
  const centers = useWorkCenters();
  const status = sp.get('status') ?? undefined;
  const list = useProductionPlans({ status });
  const rows = list.data?.items ?? [];

  const setStatus = (s: string | null) =>
    setSp(
      p => {
        const n = new URLSearchParams(p);
        if (s) n.set('status', s);
        else n.delete('status');
        return n;
      },
      { replace: true },
    );

  const columns: Column<PlanListItem>[] = [
    { id: 'name', header: 'Plan', width: 240, value: d => d.name },
    { id: 'period', header: 'Period', width: 200, value: d => d.periodFrom, cell: d => <span className="num muted">{fmtDate(parse(d.periodFrom))} — {fmtDate(parse(d.periodTo))}</span> },
    { id: 'step', header: 'Step', width: 90, value: d => d.step, cell: d => STEP_LABEL[d.step] ?? d.step },
    { id: 'warehouse', header: 'Warehouse', width: 180, value: d => d.warehouseName, cell: d => <span className="trunc muted">{d.warehouseName}</span> },
    { id: 'center', header: 'Work center', width: 170, defaultHidden: true, value: d => d.workCenterId ?? '', cell: d => <span className="trunc muted">{centers.data?.items.find((c: { id: string; name: string }) => c.id === d.workCenterId)?.name ?? '—'}</span> },
    { id: 'lines', header: 'Lines', width: 80, align: 'right', value: d => d.lineCount },
    { id: 'qty', header: 'Total', width: 110, align: 'right', value: d => Number(d.totalQty), cell: d => <span className="num">{d.totalQty}</span> },
    { id: 'status', header: 'State', width: 110, value: d => d.status, cell: d => <Badge tone={STATUS_TONE[d.status] ?? 'gray'} dot>{STATUS_LABEL[d.status] ?? d.status}</Badge> },
  ];
  const table = useDataTable(columns, { sort: { id: 'period', dir: -1 } });

  const create = async () => {
    const wh = warehouses.data?.find(w => w.kind === 'warehouse') ?? warehouses.data?.[0];
    if (!wh) return toast.error('Add a warehouse in Settings → Warehouses first');
    try {
      const plan = await api.create.mutateAsync({ name: `Production plan ${new Date().toISOString().slice(0, 10)}`, periodFrom: new Date().toISOString().slice(0, 10), periodTo: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10), step: 'week', status: 'draft', warehouseId: wh.id });
      if (plan) navigate(`/production/plans/${plan.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Production plans</h1>
          <p>How much to release in every week or month. An approved plan becomes production orders and covers the stock needs.</p>
        </div>
        <div className="acts">
          <Button onClick={() => navigate('/production/plan-orders')}>
            <ClipboardList size={14} />
            Orders by plan
          </Button>
          {canWrite && (
            <Button variant="primary" onClick={() => void create()}>
              <Plus size={14} />
              New plan
            </Button>
          )}
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label="Plan states">
        <button type="button" className={`tab${!status ? ' on' : ''}`} aria-current={!status ? 'page' : undefined} onClick={() => setStatus(null)}>
          All
        </button>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <button key={key} type="button" className={`tab${status === key ? ' on' : ''}`} aria-current={status === key ? 'page' : undefined} onClick={() => setStatus(key)}>
            {label}
          </button>
        ))}
      </nav>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the plans" action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<CalendarRange size={20} />} title="No production plans yet" action={canWrite ? <Button size="sm" onClick={() => void create()}>Create a plan</Button> : undefined}>
          A plan holds the release quantity per period: fill it by hand, by output statistics or by customer orders.
        </EmptyState>
      ) : (
        <DataTable
          aria-label="Production plans"
          columns={columns}
          rows={rows}
          table={table}
          getId={d => d.id}
          onRowClick={d => navigate(`/production/plans/${d.id}`)}
          showTotals={false}
          empty={
            <EmptyState icon={<CircleAlert size={20} />} title="No results found" action={<Button size="sm" onClick={() => setStatus(null)}>Clear filters</Button>}>
              No plans match these filters.
            </EmptyState>
          }
        />
      )}
    </div>
  );
}