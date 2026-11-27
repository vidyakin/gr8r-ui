/* Прослеживаемость партии (задача 1253): двустороннее дерево.
   «Из чего сделана» — партия → документ выпуска/поступления → сырьё и полуфабрикаты (рекурсивно)
   вплоть до поставщика; «Куда ушло» — партия → выпуски, перемещения, отгрузки и заказы покупателей.
   Дерево уже собрано сервером (packages/db/src/traceability.ts, защита от циклов — в shared). */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Boxes, CircleAlert, Factory, FileText, Package, ShoppingCart, Truck, User } from 'lucide-react';
import type { TraceNode, TraceNodeKind } from '@erp/shared';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Segmented, Skeleton } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtNumber } from '@/i18n/format';
import { fmtDate, parse } from '../lib/dates';
import { call, useWsId } from '../meta/data';

const KIND_ICON: Record<TraceNodeKind, React.ReactNode> = {
  batch: <Boxes size={15} />,
  document: <FileText size={15} />,
  movement: <Truck size={15} />,
  order: <ShoppingCart size={15} />,
  supplier: <User size={15} />,
  processing: <Factory size={15} />,
};

const KIND_TONE: Record<TraceNodeKind, 'gray' | 'accent' | 'green' | 'amber'> = {
  batch: 'accent',
  document: 'gray',
  movement: 'green',
  order: 'amber',
  supplier: 'gray',
  processing: 'amber',
};

/** Данные трассировки; ошибка отдаётся сервером как 404, если партии нет */
function useBatchTrace(batchId: string, direction: 'backward' | 'forward') {
  const ws = useWsId();
  return useQuery({
    queryKey: ['ws', ws, 'batch-trace', batchId, direction],
    queryFn: () => call<{ direction: string; root: TraceNode }>(ws, 'GET', `/stock/batches/${batchId}/${direction === 'backward' ? 'from' : 'where-used'}`),
    enabled: !!batchId,
    staleTime: Infinity,
    retry: false,
  });
}

function TraceRow({ node, depth, onSelect }: { node: TraceNode; depth: number; onSelect: (n: TraceNode) => void }) {
  const t = useT();
  const clickable = (node.kind === 'batch' && !!node.batchId) || !!node.documentId;
  return (
    <>
      <div
        className={`trace-node${clickable ? ' clickable' : ''}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={() => clickable && onSelect(node)}
        onKeyDown={e => clickable && e.key === 'Enter' && onSelect(node)}
      >
        <span className="trace-kind" title={t(`batches.trace.kind.${node.kind}`)}>
          {KIND_ICON[node.kind]}
        </span>
        <span className="trace-main">
          <span className="trace-title">{node.kind === 'processing' && node.productName ? node.productName : node.title}</span>
          {node.subtitle && <span className="trace-sub muted">{node.subtitle}</span>}
        </span>
        <span className="trace-side">
          {node.qty != null && <span className="num muted">{fmtNumber(node.qty)}</span>}
          {node.date && <span className="num faint">{fmtDate(parse(node.date))}</span>}
          <Badge tone={KIND_TONE[node.kind]}>{t(`batches.trace.kind.${node.kind}`)}</Badge>
        </span>
      </div>
      {node.children.map(child => (
        <TraceRow key={`${child.id}:${depth}`} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </>
  );
}

/** Диалог трассировки партии: переключатель «из чего / куда ушло», дерево со ссылками на документы и партии */
export function BatchTraceDialog({ batch, onClose }: { batch: { batchId: string; number: string; productName: string }; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [rootBatchId, setRootBatchId] = React.useState(batch.batchId);
  const [direction, setDirection] = React.useState<'backward' | 'forward'>('backward');
  React.useEffect(() => setRootBatchId(batch.batchId), [batch.batchId]);
  const query = useBatchTrace(rootBatchId, direction);
  const root = query.data?.root;

  const onSelect = (node: TraceNode) => {
    // партия — углубляемся в её собственную трассировку; документ — уходим в карточку
    if (node.kind === 'batch' && node.batchId) setRootBatchId(node.batchId);
    else if (node.documentId) {
      navigate(`/documents/${node.documentId}`);
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="lg"
        title={t('batches.trace.title')}
        description={`${batch.number} — ${batch.productName}`}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('batches.quality.close')}</Button>
            </DialogClose>
          </>
        }
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Segmented
            value={direction}
            onValueChange={setDirection}
            aria-label={t('batches.trace.title')}
            items={[
              { value: 'backward', label: t('batches.trace.backward'), icon: <PackageSearch15 /> },
              { value: 'forward', label: t('batches.trace.forward'), icon: <ArrowRight15 /> },
            ]}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            {direction === 'backward' ? t('batches.trace.backwardHint') : t('batches.trace.forwardHint')}
          </span>
        </div>
        {query.isError ? (
          <EmptyState icon={<CircleAlert size={20} />} error size="sm" title={t('batches.trace.loadError')}>
            {(query.error as Error).message}
          </EmptyState>
        ) : query.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !root ? (
          <EmptyState icon={<Package size={20} />} size="sm" title={t('batches.trace.empty')} />
        ) : (
          <div className="trace-tree" role="tree" aria-label={t('batches.trace.title')}>
            <TraceRow node={root} depth={0} onSelect={onSelect} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Небольшие иконки-стрелки для переключателя направления (не тянем лишние зависимости)
function PackageSearch15() {
  return <Package size={14} />;
}
function ArrowRight15() {
  return <Truck size={14} />;
}
