/* Журнал запусков: список слева, справа — шаги выбранного запуска с входом, выходом и ошибкой каждого. */
import * as React from 'react';
import { CircleAlert, History, RefreshCw } from 'lucide-react';
import { getNodeDef, type FlowRunStatus, type FlowStepStatus } from '@gr8r/shared';
import { Alert, Badge, Button, EmptyState, Segmented, Skeleton, type Tone } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ago } from '../lib/dates';
import { useRun, useRuns, type RunRow, type StepRow } from './data';
import { NodeIcon } from './node-meta';
import { fmtDateTime, useT } from '@/i18n';

const RUN_TONE: Record<FlowRunStatus, Tone> = { succeeded: 'green', failed: 'red', waiting: 'amber', running: 'accent', queued: 'gray', skipped: 'gray' };
const STEP_TONE: Record<FlowStepStatus, Tone> = { succeeded: 'green', failed: 'red', waiting: 'amber', retrying: 'amber', running: 'accent' };

const TRIGGER_KIND_KEY = { event: 'event', schedule: 'schedule', manual: 'manual' } as const;

export const RunStatus = ({ status }: { status: FlowRunStatus | FlowStepStatus }) => {
  const t = useT();
  return (
    <Badge tone={(RUN_TONE as Record<string, Tone>)[status] ?? STEP_TONE[status as FlowStepStatus]} dot>
      {t(`automations.status.${status}` as any)}
    </Badge>
  );
};

export function duration(from: string | null, to: string | null, tFn: (key: any, p?: any) => string): string {
  if (!from || !to) return tFn('automations.duration.dash');
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 1000) return tFn('automations.duration.ms', { n: Math.max(0, ms) });
  if (ms < 60_000) return tFn('automations.duration.s', { n: (ms / 1000).toFixed(1) });
  return tFn('automations.duration.min', { n: Math.round(ms / 60_000) });
}

const when = (iso: string) => ago(new Date(iso).getTime());

export function RunsView({ flowId, onOpenFlow }: { flowId?: string; onOpenFlow?: (id: string) => void }) {
  const t = useT();
  const [onlyFailed, setOnlyFailed] = React.useState(false);
  const runs = useRuns({ flowId, failed: onlyFailed || undefined });
  const [picked, setPicked] = React.useState<string | null>(null);
  const items = runs.data?.items ?? [];
  const selected = picked && items.some(r => r.id === picked) ? picked : (items[0]?.id ?? null);

  return (
    <div className="runs">
      <div className="runs-list">
        <div className="runs-bar">
          <Segmented
            aria-label={t('automations.runs.filterAria')}
            value={onlyFailed ? 'failed' : 'all'}
            onValueChange={v => setOnlyFailed(v === 'failed')}
            items={[
              { value: 'all', label: t('automations.runs.allRuns') },
              { value: 'failed', label: t('automations.runs.tabFailed') },
            ]}
          />
          <span className="sp" />
          <span className="faint">{runs.data ? t('automations.runs.total', { count: runs.data.total }) : ''}</span>
          <Button size="sm" variant="ghost" aria-label={t('automations.runs.refreshAria')} onClick={() => runs.refetch()}>
            <RefreshCw size={13} className={cn(runs.isFetching && 'spin')} />
          </Button>
        </div>
        {runs.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error title={t('automations.runs.loadFailed')} action={<Button size="sm" onClick={() => runs.refetch()}>{t('common.retry')}</Button>}>
            {(runs.error as Error).message}
          </EmptyState>
        ) : runs.isPending ? (
          <div style={{ padding: 16 }}>
            <Skeleton w="100%" h={44} />
          </div>
        ) : !items.length ? (
          <EmptyState icon={<History size={20} />} title={onlyFailed ? t('automations.runs.failedEmpty') : t('automations.runs.none')}>
            {onlyFailed ? t('automations.runs.failedHint') : t('automations.runs.noneHint')}
          </EmptyState>
        ) : (
          <ul className="runs-rows" aria-label={t('automations.runs.table')}>
            {items.map(r => (
              <RunItem key={r.id} run={r} on={r.id === selected} showFlow={!flowId} onPick={() => setPicked(r.id)} />
            ))}
          </ul>
        )}
      </div>
      <div className="runs-detail">{selected ? <RunDetailView id={selected} onOpenFlow={onOpenFlow} /> : <EmptyState icon={<History size={20} />} title={t('automations.runs.pick')}>{t('automations.runs.pickHint')}</EmptyState>}</div>
    </div>
  );
}

function RunItem({ run, on, showFlow, onPick }: { run: RunRow; on: boolean; showFlow: boolean; onPick: () => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" className={cn('run-row', on && 'on')} onClick={onPick} aria-current={on || undefined} data-status={run.status}>
        <div className="run-r1">
          <RunStatus status={run.status} />
          {showFlow && <span className="trunc run-flow">{run.flowName}</span>}
          <span className="sp" />
          <span className="faint">{when(run.createdAt)}</span>
        </div>
        <div className="run-r2 faint">
          {t(`automations.runs.runTriggerKind.${TRIGGER_KIND_KEY[run.triggerKind]}`)} · v{run.version} · {duration(run.startedAt ?? run.createdAt, run.finishedAt, t)} · {run.stepCount} {run.stepCount === 1 ? 'step' : 'steps'}
        </div>
        {run.error && <div className="run-err trunc">{run.error}</div>}
      </button>
    </li>
  );
}

function RunDetailView({ id, onOpenFlow }: { id: string; onOpenFlow?: (flowId: string) => void }) {
  const t = useT();
  const q = useRun(id);
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton w="100%" h={80} /></div>;
  if (q.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={t('automations.runs.loadFailed')}>{(q.error as Error).message}</EmptyState>;
  const r = q.data;
  return (
    <div className="run-detail">
      <div className="run-dh">
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <h2 className="sec">{r.flowName}</h2>
          <RunStatus status={r.status} />
          <span className="sp" />
          {onOpenFlow && (
            <Button size="sm" variant="secondary" onClick={() => onOpenFlow(r.flowId)}>
              {t('automations.runs.openFlow')}
            </Button>
          )}
        </div>
        <div className="faint run-meta">
          {t('automations.runs.metaLine', { kind: t(`automations.runs.runTriggerKind.${TRIGGER_KIND_KEY[r.triggerKind]}`), v: r.version, time: fmtDateTime(r.startedAt ?? r.createdAt), duration: duration(r.startedAt ?? r.createdAt, r.finishedAt, t) })}
        </div>
      </div>
      {r.error && (
        <Alert tone="danger" title={r.status === 'skipped' ? t('automations.runs.runSkipped') : t('automations.runs.runFailed')}>
          {r.error}
        </Alert>
      )}
      <ol className="steps" aria-label={t('automations.runs.stepsTitle')}>
        {r.steps.map(s => (
          <StepItem key={s.id} step={s} />
        ))}
        {!r.steps.length && <li className="faint" style={{ padding: 12 }}>{t('automations.runs.stepsNone')}</li>}
      </ol>
    </div>
  );
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function StepItem({ step }: { step: StepRow }) {
  const t = useT();
  const def = getNodeDef(step.nodeType);
  const [open, setOpen] = React.useState(step.status === 'failed');
  return (
    <li className={cn('step', step.status === 'failed' && 'failed')} data-status={step.status}>
      <button type="button" className="step-h" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="step-n">{step.seq}</span>
        <span className="step-ico">
          <NodeIcon name={def?.icon ?? 'zap'} size={13} />
        </span>
        <span className="step-t trunc">{def?.label ?? step.nodeType}</span>
        <span className="faint mono trunc step-id">{step.nodeId}</span>
        <span className="sp" />
        {step.attempt > 1 && <span className="faint">{t('automations.runs.attempt', { n: step.attempt })}</span>}
        <span className="faint">{duration(step.startedAt, step.finishedAt, t)}</span>
        <RunStatus status={step.status} />
      </button>
      {step.error && <div className="step-err">{step.error}</div>}
      {open && (
        <div className="step-body">
          <div>
            <div className="label">{t('automations.runs.input')}</div>
            <pre className="code">{json(step.input)}</pre>
          </div>
          <div>
            <div className="label">{t('automations.runs.output')}</div>
            <pre className="code">{step.output ? json(step.output) : t('automations.duration.dash')}</pre>
          </div>
        </div>
      )}
    </li>
  );
}
