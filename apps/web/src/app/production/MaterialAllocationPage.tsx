/* Распределение материалов по итогам смены (задача 1135): журнал и форма документа. Форма как в 1С: шапка сверху,
   табличные части во вкладках («Материалы» — факт смены, «Выпуски» — выпуски участка за период, «Распределение» —
   результат), комментарий внизу. Правила — docs/architecture/production-shift-allocation.md. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { DocTabs } from '../docs/doc-tabs';
import { useWarehouses } from '../docs/data';
import { useSnapshot } from './data';
import { useAllocation, useAllocationApi, useAllocations, type AllocationDetail } from './allocation-data';
import { fmtNumber } from '@/i18n/format';
import { t, tProductionEnum, useT } from '@/i18n';

const today = () => new Date().toISOString().slice(0, 10);

interface FormLine {
  key: string;
  id?: string;
  productId: string;
  qty: string;
}

/** Количество без хвоста нулей: 6.000 → 6 */
const trim = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

export function MaterialAllocationsPage() {
  const tt = useT();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const list = useAllocations({ q: q || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.allocation.title')}</h1>
          <p>{t('production.allocation.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void navigate('/material-allocations/new')}>
              <FilePlus2 size={14} />
              {t('production.allocation.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('production.common.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.allocation.title')} action={<Button size="sm" onClick={() => list.refetch()}>{t('production.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={t('production.allocation.none')}>
          {t('production.allocation.noneHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={t('production.allocation.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t('production.field.number')}</th>
                <th style={{ width: 120 }}>{t('production.field.date')}</th>
                <th style={{ width: 110 }}>{t('production.field.status')}</th>
                <th style={{ width: 200 }}>{t('production.allocation.colWorkCenter')}</th>
                <th style={{ width: 220 }}>{t('production.allocation.colPeriod')}</th>
                <th>{t('production.field.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/material-allocations/${r.id}`} className="crm-link">
                      {r.number ?? t('production.workbench.draft')}
                    </Link>
                  </td>
                  <td className="muted">{r.date}</td>
                  <td>
                    <Badge tone={r.status === 'posted' ? 'green' : r.status === 'cancelled' ? 'neutral' : 'gray'} dot>
                      {tProductionEnum('docStatus', r.status, r.status)}
                    </Badge>
                  </td>
                  <td className="trunc">{r.workCenterName ?? '—'}</td>
                  <td className="muted">{r.periodFrom === r.periodTo ? r.periodFrom : `${r.periodFrom} — ${r.periodTo}`}</td>
                  <td className="trunc">{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- карточка документа ---------------- */

const toForm = (d: AllocationDetail): FormLine[] => d.lines.map(l => ({ key: l.id, id: l.id, productId: l.productId, qty: trim(l.qty) }));

export function MaterialAllocationPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const api = useAllocationApi();
  const doc = useAllocation(isNew ? undefined : id);
  const navigate = useNavigate();
  const snapshot = useSnapshot();
  const warehouses = useWarehouses();
  const centers = (snapshot.data?.workCenters ?? []).filter(w => !w.archivedAt && w.materialMode === 'shift');
  const materials = (snapshot.data?.materials ?? []).filter(m => m.kind === 'goods');

  const [date, setDate] = React.useState(today());
  const [periodFrom, setPeriodFrom] = React.useState(today());
  const [periodTo, setPeriodTo] = React.useState(today());
  const [workCenterId, setWorkCenterId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<FormLine[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const loadedAt = React.useRef<string | null>(null);

  const detail = isNew ? null : doc.data;
  // карточка кладётся в форму при открытии и после каждого ответа сервера (проведение, заполнение)
  React.useEffect(() => {
    if (!detail) return;
    const stamp = `${detail.id}:${detail.status}:${JSON.stringify(detail.lines)}`;
    if (loadedAt.current === stamp) return;
    loadedAt.current = stamp;
    const first = loadedFor.current !== detail.id;
    loadedFor.current = detail.id;
    setLines(toForm(detail));
    if (first) {
      setDate(detail.date);
      setPeriodFrom(detail.periodFrom);
      setPeriodTo(detail.periodTo);
      setWorkCenterId(detail.workCenterId ?? '');
      setWarehouseId(detail.warehouseId ?? '');
      setComment(detail.comment);
    }
  }, [detail]);

  const editable = canWrite && (!detail || detail.status === 'draft');
  const center = (snapshot.data?.workCenters ?? []).find(w => w.id === workCenterId);
  const defaultWarehouse = center?.warehouseId ?? '';
  const valid = !!workCenterId && periodFrom <= periodTo;
  const postable = valid && lines.length > 0 && lines.every(l => l.productId && Number(l.qty) > 0);

  const body = () => ({
    workCenterId,
    warehouseId: warehouseId || defaultWarehouse || null,
    date,
    periodFrom,
    periodTo,
    comment,
    lines: lines.filter(l => l.productId).map(l => ({ id: l.id, productId: l.productId, qty: l.qty || '0' })),
  });

  const run = async (fn: () => Promise<AllocationDetail | void>, ok?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok, { duration: 1500 });
      return r ?? null;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const r = await run(() => (detail ? api.update(detail.id, body()) : api.create(body())), tt('production.allocation.saved'));
    if (r && !detail) await navigate(`/material-allocations/${r.id}`, { replace: true });
  };
  const fill = async (kind: 'norms' | 'stock') => {
    if (!detail) return;
    // шапка (участок, склад, период) уходит на сервер до заполнения: оно считается по сохранённому
    const saved = await run(() => api.update(detail.id, { workCenterId, warehouseId: warehouseId || defaultWarehouse || null, date, periodFrom, periodTo, comment }));
    if (!saved) return;
    await run(() => (kind === 'norms' ? api.fillByNorms(detail.id) : api.fillByStock(detail.id)), tt('production.allocation.filled'));
  };
  const post = async () => {
    if (!detail) return;
    // перед проведением сохраняются правки формы
    if (editable && !(await run(() => api.update(detail.id, body())))) return;
    await run(() => api.post(detail.id), tt('production.order.actions.repost'));
  };

  if (!isNew && doc.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  const releases = detail?.releases ?? [];
  const result = detail?.result ?? [];
  const seeCost = result.some(r => r.cost !== null);
  const totalCost = result.reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const productName = (pid: string) => materials.find(m => m.id === pid)?.name ?? detail?.lines.find(l => l.productId === pid)?.name ?? '';

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <h1>{detail?.number ?? t('production.allocation.newTitle')}</h1>
          {detail && <Badge tone={detail.status === 'posted' ? 'green' : 'gray'} dot>{tProductionEnum('docStatus', detail.status, detail.status)}</Badge>}
        </div>
        <div className="acts">
          {editable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>
              {detail ? t('production.common.save') : t('production.common.create')}
            </Button>
          )}
          {detail?.status === 'draft' && canWrite && (
            <Button disabled={busy || !postable} onClick={() => void post()}>
              {t('production.piecework.post')}
            </Button>
          )}
          {detail?.status === 'posted' && canWrite && (
            <Button disabled={busy} onClick={() => void run(() => api.unpost(detail.id), tt('production.common.unpost'))}>
              {t('production.common.unpost')}
            </Button>
          )}
          {detail?.status === 'draft' && canWrite && (
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              {t('production.common.delete')}
            </Button>
          )}
        </div>
      </div>

      <section className="panel doc-head" aria-label={t('production.field.date')}>
        <Field label={t('production.allocation.fields.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <Field label={t('production.allocation.fields.workCenter')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={workCenterId}
              onValueChange={v => setWorkCenterId(v)}
              options={centers.map(w => ({ value: w.id, label: w.name }))}
              placeholder={t('production.common.notChosen')}
              aria-label={t('production.allocation.fields.workCenter')}
            />
          )}
        </Field>
        <Field label={t('production.allocation.fields.warehouse')} hint={t('production.allocation.fields.warehouseHint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={warehouseId || defaultWarehouse}
              onValueChange={v => setWarehouseId(v)}
              options={(warehouses.data ?? []).filter(w => !w.archivedAt && w.kind !== 'transit').map(w => ({ value: w.id, label: w.name }))}
              placeholder={t('production.common.notChosen')}
              aria-label={t('production.allocation.fields.warehouse')}
            />
          )}
        </Field>
        <Field label={t('production.allocation.fields.periodFrom')}>
          {p => (
            <Input
              {...p}
              type="date"
              disabled={!editable}
              value={periodFrom}
              onChange={e => {
                setPeriodFrom(e.target.value);
                if (periodTo < e.target.value) setPeriodTo(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('production.allocation.fields.periodTo')}>{p => <Input {...p} type="date" disabled={!editable} value={periodTo} min={periodFrom} onChange={e => setPeriodTo(e.target.value)} />}</Field>
      </section>

      <DocTabs
        label={t('docs.tabsLabel')}
        tabs={[
          {
            id: 'materials',
            label: t('production.allocation.tabs.materials'),
            count: lines.length,
            content: (
              <section className="doc-lines panel" aria-label={t('production.allocation.tabs.materials')}>
                {editable && detail && (
                  <div className="row" style={{ gap: 8, padding: '8px 12px' }}>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void fill('norms')}>
                      {t('production.allocation.fillByNorms')}
                    </Button>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void fill('stock')}>
                      {t('production.allocation.fillByStock')}
                    </Button>
                  </div>
                )}
                <div className="table-wrap">
                  <table className="dtbl" aria-label={t('production.allocation.tabs.materials')}>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>#</th>
                        <th>{t('production.allocation.colProduct')}</th>
                        <th style={{ width: 160 }} className="r">{t('production.allocation.colQty')}</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={l.key} data-row={i}>
                          <td className="faint num">{i + 1}</td>
                          <td>
                            <Select
                              aria-label={t('production.allocation.colProduct')}
                              disabled={!editable}
                              value={l.productId}
                              onValueChange={v => setLines(prev => prev.map((x, j) => (j === i ? { ...x, productId: v } : x)))}
                              options={materials.map(m => ({ value: m.id, label: m.name }))}
                              placeholder={t('production.allocation.pickProduct')}
                            />
                          </td>
                          <td className="r">
                            <Input aria-label={t('production.allocation.colQty')} inputMode="decimal" disabled={!editable} value={l.qty} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                          </td>
                          <td>
                            {editable && (
                              <IconButton size="xs" label={t('production.common.remove')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
                                <Trash2 size={13} />
                              </IconButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {editable && (
                  <div className="doc-add">
                    <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, { key: crypto.randomUUID(), productId: '', qty: '0' }])}>
                      <Plus size={13} />
                      {t('production.allocation.addMaterial')}
                    </Button>
                  </div>
                )}
              </section>
            ),
          },
          {
            id: 'releases',
            label: t('production.allocation.tabs.releases'),
            count: releases.length,
            content: (
              <section className="doc-lines panel" aria-label={t('production.allocation.tabs.releases')}>
                {!releases.length ? (
                  <p className="faint" style={{ padding: 12 }}>{t('production.allocation.releasesEmpty')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="dtbl" aria-label={t('production.allocation.tabs.releases')}>
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>{t('production.allocation.colRelease')}</th>
                          <th style={{ width: 120 }}>{t('production.allocation.colDate')}</th>
                          <th>{t('production.allocation.colItem')}</th>
                          <th style={{ width: 120 }} className="r">{t('production.allocation.colItemQty')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {releases.map(r => (
                          <tr key={r.itemId}>
                            <td className="mono">
                              <Link to={`/documents/${r.releaseId}`} className="crm-link">
                                {r.number ?? t('production.workbench.draft')}
                              </Link>
                            </td>
                            <td className="muted">{r.date}</td>
                            <td className="trunc">{r.name}</td>
                            <td className="r num">{fmtNumber(Number(r.qty), { maximumFractionDigits: 3 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ),
          },
          {
            id: 'result',
            label: t('production.allocation.tabs.result'),
            count: result.length,
            content: (
              <section className="doc-lines panel" aria-label={t('production.allocation.tabs.result')}>
                {!result.length ? (
                  <p className="faint" style={{ padding: 12 }}>{t('production.allocation.resultEmpty')}</p>
                ) : (
                  <>
                    {detail?.status !== 'posted' && <p className="faint" style={{ padding: '8px 12px', fontSize: 12 }}>{t('production.allocation.resultDraft')}</p>}
                    <div className="table-wrap">
                      <table className="dtbl" aria-label={t('production.allocation.tabs.result')}>
                        <thead>
                          <tr>
                            <th style={{ width: 150 }}>{t('production.allocation.colRelease')}</th>
                            <th>{t('production.allocation.colItem')}</th>
                            <th>{t('production.allocation.colProduct')}</th>
                            <th style={{ width: 130 }} className="r">{t('production.allocation.colAllocQty')}</th>
                            {seeCost && <th style={{ width: 130 }} className="r">{t('production.allocation.colCost')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {result.map((r, i) => (
                            <tr key={i}>
                              <td className="mono">{r.releaseNumber ?? t('production.workbench.draft')}</td>
                              <td className="trunc">{r.itemName}</td>
                              <td className="trunc">{r.productName || productName(r.productId)}</td>
                              <td className="r num">{fmtNumber(Number(r.qty), { maximumFractionDigits: 3 })}</td>
                              {seeCost && <td className="r num">{r.cost === null ? '—' : fmtNumber(Number(r.cost), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {seeCost && detail?.status === 'posted' && (
                      <div className="doc-totals panel" style={{ border: 0 }}>
                        <div className="trow grand">
                          <span>{t('production.allocation.total')}</span>
                          <span className="num">{fmtNumber(totalCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            ),
          },
        ]}
      />

      <section className="doc-comment panel" aria-label={t('docs.comment')}>
        <Field label={t('docs.comment')}>
          {p => <Input {...p} disabled={!editable} value={comment} placeholder={t('production.allocation.commentHint')} onChange={e => setComment(e.target.value)} />}
        </Field>
      </section>

      {removing && detail && (
        <ConfirmDialog
          open
          danger
          title={t('production.common.delete')}
          confirmLabel={t('production.common.delete')}
          onOpenChange={open => !open && setRemoving(false)}
          onConfirm={async () => {
            setRemoving(false);
            await api.remove(detail.id);
            await navigate('/material-allocations', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}
