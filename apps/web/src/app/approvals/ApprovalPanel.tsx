/* Вкладка «Согласование» карточки документа и договора (задача 1199): данные GET /approvals/by-object и действия над процессом. */
import * as React from 'react';
import type { ApprovalDecision, ApprovalTargetKind } from '@erp/shared';
import { Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { withPrintCsp } from '@/lib/print-csp';
import { useIsAdmin } from '../catalog/data';
import { API_BASE } from '../data/api';
import { useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { useMyAccess } from '../positions/data';
import { ApprovalBody } from './approval-body';
import { useApprovalOfObject, useApprovalsApi, type ApprovalOfObject } from './data';

/** Открывает лист согласования в новой вкладке: HTML с сервера под meta-CSP печати */
export async function printApprovalSheet(ws: string, approvalId: string): Promise<void> {
  const r = await fetch(`${API_BASE()}/approvals/${approvalId}/print`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  const url = URL.createObjectURL(new Blob([withPrintCsp(await r.text())], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  w?.addEventListener('load', () => w.print());
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Нужна ли вкладка: модуль включён и есть что показать (маршрут подходит или процессы уже были) */
export const approvalTabVisible = (info: ApprovalOfObject | undefined): boolean => !!info && info.enabled && (!!info.route || info.rounds.length > 0);

export function ApprovalPanel({ targetKind, objectId, paymentRequest }: { targetKind: ApprovalTargetKind; objectId: string; paymentRequest?: boolean }) {
  const t = useT();
  const ws = useWsId();
  const q = useApprovalOfObject(targetKind, objectId);
  const api = useApprovalsApi();
  const me = useMyAccess().data?.memberId ?? null;
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown | null>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fn();
      if (r !== null) toast(done, { duration: 1500 });
      return r !== null;
    } finally {
      setBusy(false);
    }
  };
  if (q.isPending) return <Skeleton w="100%" h={80} />;
  if (q.isError || !q.data) return <p className="faint">{t('approvals.panel.loadFailed')}</p>;
  return (
    <ApprovalBody
      info={q.data}
      memberId={me}
      isAdmin={isAdmin}
      canWrite={canWrite}
      busy={busy}
      paymentRequest={paymentRequest}
      onStart={() => void run(() => api('POST', '/approvals', targetKind === 'document' ? { targetKind, documentId: objectId } : { targetKind, contractId: objectId }), t('approvals.panel.started'))}
      onDecide={(taskId, decision: ApprovalDecision, comment) => run(() => api('POST', `/approval-tasks/${taskId}/decide`, { decision, comment }), t('approvals.panel.decided'))}
      onCancel={(id, reason) => run(() => api('POST', `/approvals/${id}/cancel`, { reason }), t('approvals.panel.cancelled'))}
      onPrint={id => void printApprovalSheet(ws, id).catch(e => toast.error(e instanceof Error ? e.message : String(e)))}
    />
  );
}

/** Раздел «Согласование» внутри диалога договора: виден, только если модуль включён и маршрут подходит или процессы уже были */
export function ApprovalSection({ targetKind, objectId }: { targetKind: ApprovalTargetKind; objectId: string }) {
  const t = useT();
  const q = useApprovalOfObject(targetKind, objectId);
  if (!approvalTabVisible(q.data)) return null;
  return (
    <section className="stack" style={{ gap: 8 }} aria-label={t('approvals.panel.tab')}>
      <b style={{ fontSize: 12 }}>{t('approvals.panel.tab')}</b>
      <ApprovalPanel targetKind={targetKind} objectId={objectId} />
    </section>
  );
}
