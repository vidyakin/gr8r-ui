/* Раздел Automations: список flow (включение, последний запуск, ошибки) и общий журнал запусков. */
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CircleAlert, Plus, Trash2, Zap } from 'lucide-react';
import { getNodeDef } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Skeleton, Tab, Tabs, TabsList, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { useT, type TKey } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { ago } from '../lib/dates';
import { useFlowApi, useFlows, type FlowSummary } from './data';
import { RunsView, RunStatus } from './RunsView';
import { nodeLabel } from './node-i18n';

export function triggerText(t: FlowSummary['trigger'], tFn: (key: TKey, params?: Record<string, string | number | null | undefined>) => string): string {
  if (!t) return tFn('automations.list.noTrigger');
  const def = getNodeDef(t.type);
  const p = t.params as Record<string, string | undefined>;
  const detail = t.type === 'trigger.schedule' ? p.cron : [p.entity, p.field && `.${p.field}`, p.to && ` → ${p.to}`].filter(Boolean).join('');
  return `${def ? nodeLabel(def) : t.type}${detail ? ` · ${detail}` : ''}`;
}

export function AutomationsPage() {
  const tab = useLocation().pathname.endsWith('/runs') ? 'runs' : 'flows';
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const flows = useFlows();
  const api = useFlowApi();
  const t = useT();
  const [removing, setRemoving] = React.useState<FlowSummary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const rows = flows.data ?? [];

  const create = async () => {
    setBusy(true);
    try {
      const f = await api.create({ name: t('automations.list.defaultName') });
      navigate(`/automations/flow/${f.id}`);
    } finally {
      setBusy(false);
    }
  };

  const columns = React.useMemo<Column<FlowSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('automations.list.col.name'),
        width: 320,
        value: f => f.name,
        cell: f => (
          <span className="col" style={{ gap: 1, minWidth: 0 }}>
            <span className="trunc" style={{ fontWeight: 450 }}>{f.name}</span>
            {f.description && <span className="trunc faint">{f.description}</span>}
          </span>
        ),
      },
      { id: 'trigger', header: t('automations.list.col.trigger'), width: 250, value: f => triggerText(f.trigger, t), cell: f => <span className="trunc muted">{triggerText(f.trigger, t)}</span> },
      {
        id: 'enabled',
        header: t('automations.list.col.enabled'),
        width: 100,
        value: f => (f.enabled ? 1 : 0),
        cell: f => (
          <span onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              role="switch"
              className="toggle"
              aria-label={f.enabled ? t('automations.list.disableAria', { name: f.name }) : t('automations.list.enableAria', { name: f.name })}
              checked={f.enabled}
              disabled={!isAdmin || f.publishedVersion === null}
              title={f.publishedVersion === null ? t('automations.list.publishFirstTitle') : undefined}
              onChange={e => void api.save(f.id, { enabled: e.target.checked }).then(() => toast(e.target.checked ? t('automations.list.onToast', { name: f.name }) : t('automations.list.offToast', { name: f.name })))}
            />
          </span>
        ),
      },
      {
        id: 'version',
        header: t('automations.list.col.version'),
        width: 190,
        value: f => f.publishedVersion ?? 0,
        cell: f =>
          f.publishedVersion === null ? (
            <Badge tone="gray">{t('automations.list.draft')}</Badge>
          ) : (
            <span className="row" style={{ gap: 6 }}>
              <span className="mono">v{f.publishedVersion}</span>
              {f.hasDraftChanges && <Badge tone="amber">{t('automations.list.unpublishedChanges')}</Badge>}
            </span>
          ),
      },
      {
        id: 'last',
        header: t('automations.list.col.lastRun'),
        width: 200,
        value: f => (f.lastRun ? new Date(f.lastRun.createdAt).getTime() : 0),
        cell: f =>
          f.lastRun ? (
            <span className="row" style={{ gap: 8 }} title={f.lastRun.error ?? undefined}>
              <RunStatus status={f.lastRun.status} />
              <span className="faint">{ago(new Date(f.lastRun.createdAt).getTime())}</span>
            </span>
          ) : (
            <span className="faint">{t('automations.list.never')}</span>
          ),
      },
      {
        id: 'errors',
        header: t('automations.list.col.errors'),
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
              <button type="button" className="ibtn ibtn-xs" aria-label={t('automations.list.deleteAria', { name: f.name })} onClick={() => setRemoving(f)}>
                <Trash2 size={13} />
              </button>
            </span>
          ) : null,
      },
    ],
    [isAdmin, api, t],
  );
  const table = useDataTable(columns, { hidden: [] });

  const newBtn = isAdmin && (
    <Button variant="primary" loading={busy} onClick={create}>
      <Plus size={14} />
      {t('automations.list.newAutomation')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('automations.list.title')}</h1>
          <p>{t('automations.list.subtitle')}</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      <Tabs value={tab} onValueChange={v => navigate(v === 'flows' ? '/automations' : '/automations/runs')} className="auto-tabs">
        <TabsList>
          <Tab value="flows" count={rows.length || undefined}>
            {t('automations.list.tabFlows')}
          </Tab>
          <Tab value="runs">{t('automations.list.tabRuns')}</Tab>
        </TabsList>
      </Tabs>
      {tab === 'runs' ? (
        <RunsView onOpenFlow={id => navigate(`/automations/flow/${id}`)} />
      ) : flows.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('automations.list.loadFailed')} action={<Button size="sm" onClick={() => flows.refetch()}>{t('common.retry')}</Button>}>
          {(flows.error as Error).message}
        </EmptyState>
      ) : flows.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('automations.list.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={f => f.id}
          showTotals={false}
          onRowClick={f => navigate(`/automations/flow/${f.id}`)}
          empty={
            <EmptyState icon={<Zap size={20} />} title={t('automations.list.empty')} action={newBtn || undefined}>
              {t('automations.list.emptyHint')}
            </EmptyState>
          }
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title={t('automations.list.deleteTitle')}
        description={removing ? t('automations.list.deleteDesc', { name: removing.name }) : undefined}
        confirmLabel={t('automations.list.deleteBtn')}
        cancelLabel={t('automations.list.cancel')}
        onConfirm={async () => {
          if (removing) {
            await api.remove(removing.id);
            toast(t('automations.toast.deletedName', { name: removing.name }));
          }
          setRemoving(null);
        }}
      />
    </div>
  );
}
