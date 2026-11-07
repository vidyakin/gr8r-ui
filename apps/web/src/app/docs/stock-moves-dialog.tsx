/* «Движения» документа: у проведённого — фактические движения склада, у черновика — какие движения сделает проведение
   (сервер проводит черновик в транзакции с откатом: данные не меняются). Цена и сумма приходят только admin и owner. */
import { ArrowLeftRight, CircleAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, DialogClose, DialogContent, EmptyState, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtAmount, fmtNumber } from '@/i18n/format';
import { ApiError, errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';

export interface DocumentMove {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  qty: string;
  cost: string | null;
  amount: string | null;
  batchNumber: string | null;
  phase: number;
  lineId: string | null;
  movedAt: string;
}

export interface DocumentMoves {
  mode: 'actual' | 'preview';
  moves: DocumentMove[];
  error: { code: string; message: string; details?: unknown } | null;
  costVisible: boolean;
}

/** Без кэша: расчёт зависит от остатков в момент открытия окна */
export function useDocumentMoves(docId: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'doc-moves', docId),
    queryFn: () => call<DocumentMoves>(ws, 'GET', `/documents/${docId}/stock-moves`),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

const signed = (v: string) => fmtNumber(v, { signDisplay: 'exceptZero' });

export function StockMovesDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const t = useT();
  const q = useDocumentMoves(docId);
  const data = q.data;
  const moves = data?.moves ?? [];
  const costVisible = data?.costVisible ?? false;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={t('docs.stockMoves.title')}
        description={data ? (data.mode === 'preview' ? t('docs.stockMoves.previewLead') : t('docs.stockMoves.actualLead')) : undefined}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('docs.stockMoves.close')}</Button>
            </DialogClose>
          </>
        }
      >
        {q.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error size="sm" title={t('docs.stockMoves.loadError')}>
            {errorMessage(q.error)}
          </EmptyState>
        ) : q.isPending ? (
          <Skeleton w="100%" h={36} />
        ) : data?.error ? (
          <EmptyState icon={<CircleAlert size={20} />} error size="sm" title={t('docs.stockMoves.cannotPost')}>
            {errorMessage(new ApiError(422, data.error.code, data.error.message, data.error.details))}
          </EmptyState>
        ) : moves.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight size={20} />} size="sm" title={t('docs.stockMoves.empty')} />
        ) : (
          <table className="dt" aria-label={t('docs.stockMoves.title')}>
            <thead>
              <tr>
                <th>{t('docs.stockMoves.col.warehouse')}</th>
                <th>{t('docs.stockMoves.col.product')}</th>
                <th>{t('docs.stockMoves.col.batch')}</th>
                <th className="r">{t('docs.stockMoves.col.qty')}</th>
                {costVisible && <th className="r">{t('docs.stockMoves.col.cost')}</th>}
                {costVisible && <th className="r">{t('docs.stockMoves.col.amount')}</th>}
              </tr>
            </thead>
            <tbody>
              {moves.map((m, i) => (
                <tr key={i}>
                  <td className="muted">
                    {m.warehouseName}
                    {m.phase === 2 && <span className="faint"> · {t('docs.stockMoves.receiving')}</span>}
                  </td>
                  <td>{m.productName}</td>
                  <td>{m.batchNumber ? <span className="mono">{m.batchNumber}</span> : <span className="faint">—</span>}</td>
                  <td className={`r num ${Number(m.qty) < 0 ? 'neg' : ''}`}>{signed(m.qty)}</td>
                  {costVisible && <td className="r num muted">{fmtAmount(m.cost)}</td>}
                  {costVisible && <td className="r num">{fmtAmount(m.amount)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
