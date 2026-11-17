/* Документооборот → Согласования (задача 1199): «Мне на согласование», «Отправленные», «Все» (admin и выше). Строка открывает документ или договор. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, Stamp } from 'lucide-react';
import type { ApprovalBox } from '@erp/shared';
import { Badge, Button, EmptyState, Skeleton, Tab, Tabs, TabsList } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/erp/data-table';
import { fmtAmount, useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { useIsAdmin } from '../catalog/data';
import { typeLabel } from '../docs/data';
import { OverdueMark, STATE_TONE } from './approval-body';
import { approvalObjectPath, useApprovalList, type ApprovalListItem } from './data';

export function ApprovalsPage() {
  const t = useT();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [box, setBox] = React.useState<ApprovalBox>('mine');
  const list = useApprovalList(box);
  const kindLabel = (a: ApprovalListItem) => (a.targetKind === 'contract' ? t('approvals.objectKind.contract') : typeLabel(a.documentType ?? ''));
  const objectName = (a: ApprovalListItem) => `${kindLabel(a)} ${a.number ?? ''}`.trim();

  const columns: Column<ApprovalListItem>[] = [
    { id: 'object', header: t('approvals.col.object'), width: 240, value: a => objectName(a), cell: a => <span className="trunc">{objectName(a)}</span> },
    { id: 'counterparty', header: t('approvals.col.counterparty'), width: 200, value: a => a.counterpartyName ?? '', cell: a => <span className="trunc muted">{a.counterpartyName ?? '—'}</span> },
    { id: 'amount', header: t('approvals.col.amount'), width: 120, align: 'right', value: a => Number(a.total ?? 0), cell: a => (a.total ? <span className="num">{fmtAmount(a.total)}</span> : <span className="faint">—</span>) },
    { id: 'route', header: t('approvals.col.route'), width: 180, value: a => a.routeName, cell: a => <span className="trunc muted">{a.routeName}</span> },
    {
      id: 'step',
      header: t('approvals.col.step'),
      width: 190,
      value: a => a.currentStep,
      cell: a => (a.state === 'in_progress' ? <span className="trunc">{a.currentStepName || t('approvals.stepOf', { n: a.currentStep + 1, total: a.stepCount })}</span> : <span className="faint">—</span>),
    },
    { id: 'overdue', header: t('approvals.col.overdue'), width: 140, value: a => a.overdueHours, cell: a => <OverdueMark hours={a.overdueHours} /> },
    { id: 'author', header: t('approvals.col.author'), width: 150, value: a => a.authorName ?? '', cell: a => <span className="trunc muted">{a.authorName ?? '—'}</span> },
    { id: 'started', header: t('approvals.col.started'), width: 160, value: a => a.startedAt, cell: a => <span className="num muted">{fmtDateTime(a.startedAt)}</span> },
    { id: 'state', header: t('approvals.col.state'), width: 140, value: a => a.state, cell: a => <Badge tone={STATE_TONE[a.state]}>{t(`approvals.states.${a.state}`)}</Badge> },
  ];
  const table = useDataTable(columns, { sort: { id: 'started', dir: -1 } });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('approvals.title')}</h1>
          <p>{t('approvals.subtitle')}</p>
        </div>
      </div>
      <Tabs value={box} onValueChange={v => setBox(v as ApprovalBox)}>
        <TabsList aria-label={t('approvals.title')}>
          <Tab value="mine">{t('approvals.boxes.mine')}</Tab>
          <Tab value="sent">{t('approvals.boxes.sent')}</Tab>
          {isAdmin && <Tab value="all">{t('approvals.boxes.all')}</Tab>}
        </TabsList>
      </Tabs>
      <div className="pane">
        {list.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : list.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error title={t('approvals.title')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
            {(list.error as Error).message}
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState icon={<Stamp size={20} />} title={t(`approvals.empty.${box}`)}>
            {box === 'mine' ? t('approvals.empty.mineHint') : t('approvals.empty.hint')}
          </EmptyState>
        ) : (
          <DataTable columns={columns} table={table} rows={rows} getId={a => a.id} onRowClick={a => void navigate(approvalObjectPath(a))} aria-label={t('approvals.title')} />
        )}
      </div>
    </div>
  );
}
