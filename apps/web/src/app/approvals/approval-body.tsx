/* Содержимое вкладки «Согласование» (задача 1199): состояние, этапы и задачи, кнопки решений. Чистое представление без запросов —
   данные и действия приходят пропсами (контейнер — ApprovalPanel.tsx), поэтому рендерится в тесте с готовыми данными. */
import * as React from 'react';
import { Printer } from 'lucide-react';
import type { ApprovalDecision, ApprovalState } from '@erp/shared';
import { Alert, Badge, Button, Dialog, DialogContent, Field, Textarea } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import type { ApprovalOfObject, ApprovalTaskView, ApprovalView } from './data';

export const STATE_TONE: Record<ApprovalState, 'amber' | 'green' | 'red' | 'gray'> = { in_progress: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' };

/** «Просрочено на N ч» красным; пусто, если срока нет или он не истёк */
export function OverdueMark({ hours }: { hours: number }) {
  const t = useT();
  if (hours <= 0) return null;
  return <span className="approval-overdue" style={{ color: 'var(--red)', fontWeight: 500 }}>{t('approvals.overdue', { hours })}</span>;
}

function TaskRow({ task, mine, onDecide }: { task: ApprovalTaskView; mine: boolean; onDecide: (task: ApprovalTaskView, d: ApprovalDecision) => void }) {
  const t = useT();
  const tone = task.state === 'done' ? (task.decision === 'reject' ? 'red' : 'green') : task.state === 'pending' ? 'amber' : 'gray';
  return (
    <li className="approval-task" style={{ padding: '6px 0', borderTop: '1px solid var(--line, transparent)' }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>{task.memberName}</b>
        {task.positionName && <span className="faint">{t('approvals.panel.asPosition', { position: task.positionName })}</span>}
        <Badge tone={tone}>{task.state === 'done' && task.decision ? t(`approvals.decisions.${task.decision}`) : t(`approvals.taskStates.${task.state}`)}</Badge>
        {task.decidedAt && <span className="faint">{fmtDateTime(task.decidedAt)}</span>}
        {task.state === 'pending' && task.dueAt && <span className="faint">{t('approvals.dueAt', { date: fmtDateTime(task.dueAt) })}</span>}
        <OverdueMark hours={task.overdueHours} />
        {mine && task.state === 'pending' && (
          <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            <Button size="sm" variant="primary" onClick={() => onDecide(task, 'approve')}>{t('approvals.panel.approve')}</Button>
            <Button size="sm" onClick={() => onDecide(task, 'reject')}>{t('approvals.panel.reject')}</Button>
            <Button size="sm" variant="ghost" onClick={() => onDecide(task, 'comment')}>{t('approvals.panel.comment')}</Button>
          </span>
        )}
      </div>
      {task.comment && <p className="muted" style={{ margin: '4px 0 0' }}>{task.comment}</p>}
      {task.notes.map((n, i) => (
        <p key={i} className="muted" style={{ margin: '4px 0 0' }}>
          <span className="faint">{fmtDateTime(n.at)} · </span>
          {n.text}
        </p>
      ))}
    </li>
  );
}

/** Круг согласования: этапы снимка маршрута и задачи участников */
function RoundView({ ap, memberId, onDecide }: { ap: ApprovalView; memberId: string | null; onDecide: (task: ApprovalTaskView, d: ApprovalDecision) => void }) {
  const t = useT();
  return (
    <div className="stack" style={{ gap: 10 }}>
      {ap.snapshot.steps.map((s, i) => {
        const tasks = ap.tasks.filter(x => x.stepIndex === i);
        return (
          <section key={i} aria-label={s.name || t('approvals.stepOf', { n: i + 1, total: ap.snapshot.steps.length })}>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <b>{s.name || t('approvals.stepOf', { n: i + 1, total: ap.snapshot.steps.length })}</b>
              <span className="faint">{t(`approvals.stepMode.${s.mode}`)}</span>
              {ap.state === 'in_progress' && ap.currentStep === i && <Badge tone="amber">{t('approvals.stepOf', { n: i + 1, total: ap.snapshot.steps.length })}</Badge>}
            </div>
            {tasks.length ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {tasks.map(x => (
                  <TaskRow key={x.id} task={x} mine={x.memberId === memberId && ap.state === 'in_progress'} onDecide={onDecide} />
                ))}
              </ul>
            ) : (
              <p className="faint">{t('approvals.panel.noTasks')}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export interface ApprovalBodyProps {
  info: ApprovalOfObject;
  /** Мой members.id: свои задачи получают кнопки решений */
  memberId: string | null;
  isAdmin: boolean;
  canWrite: boolean;
  busy?: boolean;
  /** Заявка на расход: процесс запускается проведением, ручной кнопки нет */
  paymentRequest?: boolean;
  onStart: () => void;
  /** true — решение сохранено, диалог закрывается */
  onDecide: (taskId: string, decision: ApprovalDecision, comment: string) => Promise<boolean>;
  onCancel: (approvalId: string, reason: string) => Promise<boolean>;
  onPrint: (approvalId: string) => void;
}

export function ApprovalBody({ info, memberId, isAdmin, canWrite, busy, paymentRequest, onStart, onDecide, onCancel, onPrint }: ApprovalBodyProps) {
  const t = useT();
  const [deciding, setDeciding] = React.useState<{ task: ApprovalTaskView; decision: ApprovalDecision } | null>(null);
  const [comment, setComment] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const cur = info.current;
  const last = cur ?? info.rounds[0] ?? null;
  const history = info.rounds.filter(r => r.id !== cur?.id);
  const isContract = last?.targetKind === 'contract';
  const needComment = deciding?.decision !== 'approve';
  const canCancel = !!cur && canWrite && (isAdmin || cur.authorId === memberId);

  return (
    <div className="approval-panel stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={info.gate === 'approved' ? 'green' : info.gate === 'in_progress' ? 'amber' : info.gate === 'outdated' ? 'red' : 'gray'} dot>
          {t(`approvals.gate.${info.gate}`)}
        </Badge>
        {info.route && <span className="muted">{t('approvals.panel.routeLine', { name: info.route.name })}</span>}
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          {info.canStart && canWrite && (
            <Button variant="primary" disabled={busy} onClick={onStart}>{t('approvals.panel.start')}</Button>
          )}
          {canCancel && <Button variant="ghost" disabled={busy} onClick={() => { setReason(''); setCancelling(true); }}>{t('approvals.panel.cancel')}</Button>}
          {last && (
            <Button variant="ghost" onClick={() => onPrint(last.id)}>
              <Printer size={14} />
              {t('approvals.panel.print')}
            </Button>
          )}
        </span>
      </div>

      {info.route && <p className="faint" style={{ margin: 0 }}>{info.route.required ? t('approvals.panel.requiredNote') : t('approvals.panel.optionalNote')}</p>}
      {!info.route && !last && <p className="faint" style={{ margin: 0 }}>{t('approvals.panel.noRoute')}</p>}
      {paymentRequest && !cur && info.canStart === false && info.route && <p className="faint" style={{ margin: 0 }}>{t('approvals.panel.paymentRequestStart')}</p>}
      {paymentRequest && cur && <Alert tone="info">{t('approvals.panel.paymentRequest')}</Alert>}
      {info.gate === 'outdated' && <Alert tone="warn">{t('approvals.panel.outdated')}</Alert>}
      {cur?.changedSinceSubmit && <Alert tone="warn">{isContract ? t('approvals.panel.changedContract') : t('approvals.panel.changed')}</Alert>}

      {last && (
        <section className="stack" style={{ gap: 8 }} aria-label={t('approvals.panel.round', { n: last.round })}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>{t('approvals.panel.round', { n: last.round })}</b>
            <Badge tone={STATE_TONE[last.state]}>{t(`approvals.states.${last.state}`)}</Badge>
            {last.authorName && <span className="faint">{t('approvals.panel.author', { name: last.authorName })}</span>}
            <span className="faint">{t('approvals.panel.sentAt', { date: fmtDateTime(last.startedAt) })}</span>
            {last.finishedAt && <span className="faint">{t('approvals.panel.finishedAt', { date: fmtDateTime(last.finishedAt) })}</span>}
          </div>
          {last.state === 'cancelled' && last.cancelReason && <p className="muted" style={{ margin: 0 }}>{t('approvals.panel.cancelReason', { text: last.cancelReason })}</p>}
          <RoundView ap={last} memberId={memberId} onDecide={(task, decision) => { setComment(''); setDeciding({ task, decision }); }} />
        </section>
      )}

      {history.length > 0 && (
        <details>
          <summary>{t('approvals.panel.rounds')} ({history.length})</summary>
          <div className="stack" style={{ gap: 14, marginTop: 8 }}>
            {history.map(r => (
              <section key={r.id} className="stack" style={{ gap: 6 }} aria-label={t('approvals.panel.round', { n: r.round })}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <b>{t('approvals.panel.round', { n: r.round })}</b>
                  <Badge tone={STATE_TONE[r.state]}>{t(`approvals.states.${r.state}`)}</Badge>
                  <span className="faint">{t('approvals.panel.sentAt', { date: fmtDateTime(r.startedAt) })}</span>
                  <Button size="sm" variant="ghost" onClick={() => onPrint(r.id)}>{t('approvals.panel.print')}</Button>
                </div>
                <RoundView ap={r} memberId={null} onDecide={() => {}} />
              </section>
            ))}
          </div>
        </details>
      )}

      <Dialog open={!!deciding} onOpenChange={o => !o && setDeciding(null)}>
        <DialogContent size="sm" title={deciding ? t(`approvals.panel.decideTitle.${deciding.decision}`) : ''}>
          <div className="stack" style={{ gap: 12 }}>
            <Field label={`${t('approvals.panel.commentLabel')} (${needComment ? t('approvals.panel.commentRequired') : t('approvals.panel.commentOptional')})`}>
              {p => <Textarea {...p} rows={4} maxLength={4000} value={comment} onChange={e => setComment(e.target.value)} />}
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" onClick={() => setDeciding(null)}>{t('approvals.panel.close')}</Button>
              <Button
                variant="primary"
                disabled={busy || (needComment && !comment.trim())}
                onClick={async () => {
                  if (deciding && (await onDecide(deciding.task.id, deciding.decision, comment.trim()))) setDeciding(null);
                }}
              >
                {t('approvals.panel.send')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent size="sm" title={t('approvals.panel.cancelTitle')} description={t('approvals.panel.cancelHint')}>
          <div className="stack" style={{ gap: 12 }}>
            <Field label={t('approvals.panel.reasonLabel')}>{p => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />}</Field>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" onClick={() => setCancelling(false)}>{t('approvals.panel.close')}</Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  if (cur && (await onCancel(cur.id, reason.trim()))) setCancelling(false);
                }}
              >
                {t('approvals.panel.cancelConfirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
