/* Раздел Automations: список flow (включение, последний запуск, ошибки) и общий журнал запусков. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CircleAlert, Plus, Trash2, Zap } from 'lucide-react';
import { getNodeDef } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { useIsAdmin } from '../catalog/data';
import { ago } from '../lib/dates';
import { useFlowApi, useFlows, type FlowSummary } from './data';
import { RunsView, RunStatus } from './RunsView';

export function triggerText(t: FlowSummary['trigger']): string {
  if (!t) return 'No trigger';
  const def = getNodeDef(t.type);
  const p = t.params as Record<string, string | undefined>;
  const detail = t.type === 'trigger.schedule' ? p.cron : [p.entity, p.field && `.${p.field}`, p.to && ` → ${p.to}`].filter(Boolean).join('');
  return `${def?.label ?? t.type}${detail ? ` · ${detail}` : ''}`;
}

export function AutomationsPage() {
  const tab = useLocation().pathname.endsWith('/runs') ? 'runs' : 'flows';
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const flows = useFlows();
  const api = useFlowApi();
  const [removing, setRemoving] = React.useState<FlowSummary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const rows = flows.data ?? [];

  const create = async () => {
    setBusy(true);
    try {
      const f = await api.create({ name: 'New automation' });
      navigate(`/automations/flow/${f.id}`);
    } finally {
      setBusy(false);
    }
  };

  const columns = React.useMemo<Column<FlowSummary>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        width: 320,
        value: f => f.name,
        cell: f => (
          <span className="col" style={{ gap: 1, minWidth: 0 }}>
            <span className="trunc" style={{ fontWeight: 450 }}>{f.name}</span>
            {f.description && <span className="trunc faint">{f.description}</span>}
          </span>
        ),
      },
      { id: 'trigger', header: 'Trigger', width: 250, value: f => triggerText(f.trigger), cell: f => <span className="trunc muted">{triggerText(f.trigger)}</span> },
      {
        id: 'enabled',
        header: 'Enabled',
        width: 100,
        value: f => (f.enabled ? 1 : 0),
        cell: f => (
          <span onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              role="switch"
              className="toggle"
              aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.name}`}
              checked={f.enabled}
              disabled={!isAdmin || f.publishedVersion === null}
              title={f.publishedVersion === null ? 'Publish the automation first' : undefined}
              onChange={e => void api.save(f.id, { enabled: e.target.checked }).then(() => toast(e.target.checked ? `“${f.name}” is on` : `“${f.name}” is off`))}
            />
          </span>
        ),
      },
      {
        id: 'version',
        header: 'Version',
        width: 190,
        value: f => f.publishedVersion ?? 0,
        cell: f =>
          f.publishedVersion === null ? (
            <Badge tone="gray">Draft</Badge>
          ) : (
            <span className="row" style={{ gap: 6 }}>
              <span className="mono">v{f.publishedVersion}</span>
              {f.hasDraftChanges && <Badge tone="amber">unpublished changes</Badge>}
            </span>
          ),
      },
      {
        id: 'last',
        header: 'Last run',
        width: 200,
        value: f => (f.lastRun ? new Date(f.lastRun.createdAt).getTime() : 0),
        cell: f =>
          f.lastRun ? (
            <span className="row" style={{ gap: 8 }} title={f.lastRun.error ?? undefined}>
              <RunStatus status={f.lastRun.status} />
              <span className="faint">{ago(new Date(f.lastRun.createdAt).getTime())}</span>
            </span>
          ) : (
            <span className="faint">Never</span>
          ),
      },
      {
        id: 'errors',
        header: 'Errors (7d)',
        width: 110,
        align: 'right',
        value: f => f.failedRuns7d,
        cell: f => (f.failedRuns7d ? <span className="num" style={{ color: 'var(--red)', fontWeight: 500 }}>{f.failedRuns7d}</span> : <span className="faint">0</span>),
      },
      {
        id: 'actions',
        header: '',
        width: 48,
        hideable: false,
        sortable: false,
        cell: f =>
          isAdmin ? (
            <span className="row" style={{ justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
              <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${f.name}`} onClick={() => setRemoving(f)}>
                <Trash2 size={13} />
              </button>
            </span>
          ) : null,
      },
    ],
    [isAdmin, api],
  );
  const table = useDataTable(columns, { hidden: [] });

  const newBtn = isAdmin && (
    <Button variant="primary" loading={busy} onClick={create}>
      <Plus size={14} />
      New automation
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Automations</h1>
          <p>When something happens in the workspace — a task changes, a deal is won, the clock strikes — run a chain of steps.</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      <Tabs value={tab} onValueChange={v => navigate(v === 'flows' ? '/automations' : '/automations/runs')} className="auto-tabs">
        <TabsList>
          <Tab value="flows" count={rows.length || undefined}>
            Automations
          </Tab>
          <Tab value="runs">Runs</Tab>
        </TabsList>
      </Tabs>
      {tab === 'runs' ? (
        <RunsView onOpenFlow={id => navigate(`/automations/flow/${id}`)} />
      ) : flows.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load automations" action={<Button size="sm" onClick={() => flows.refetch()}>Retry</Button>}>
          {(flows.error as Error).message}
        </EmptyState>
      ) : flows.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label="Automations table"
          columns={columns}
          rows={rows}
          table={table}
          getId={f => f.id}
          showTotals={false}
          onRowClick={f => navigate(`/automations/flow/${f.id}`)}
          empty={
            <EmptyState icon={<Zap size={20} />} title="No automations yet" action={newBtn || undefined}>
              Build a flow from a trigger, conditions and actions.
            </EmptyState>
          }
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title="Delete automation?"
        description={removing ? <><b>{removing.name}</b> and its run history will be deleted.</> : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (removing) {
            await api.remove(removing.id);
            toast(`Deleted “${removing.name}”`);
          }
          setRemoving(null);
        }}
      />
    </div>
  );
}
