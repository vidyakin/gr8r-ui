/* Распределение материалов по итогам смены (задача 1135): журнал и форма документа. Форма как в 1С: шапка сверху,
   табличные части во вкладках («Материалы» — факт смены, «Продукция» — позиции выпусков участка за период,
   «Распределение» — материал по позициям, правится вручную), комментарий внизу. Правила — docs/architecture/production-shift-allocation.md. */
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
import { fmtDate } from '../lib/dates';
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
                  <td className="muted">{fmtDate(r.date)}</td>
                  <td>
                    <Badge tone={r.status === 'posted' ? 'green' : r.status === 'cancelled' ? 'neutral' : 'gray'} dot>
                      {tProductionEnum('docStatus', r.status, r.status)}
                    </Badge>
                  </td>
                  <td className="trunc">{r.workCenterName ?? '—'}</td>
                  <td className="muted">{!r.periodFrom || !r.periodTo ? '—' : r.periodFrom === r.periodTo ? fmtDate(r.periodFrom) : `${fmtDate(r.periodFrom)} — ${fmtDate(r.periodTo)}`}</td>
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

interface FormRow {
  key: string;
  releaseItemId: string;
  productId: string;
  qty: string;
}

const toForm = (d: AllocationDetail): FormLine[] => d.lines.map(l => ({ key: l.id, id: l.id, productId: l.productId, qty: trim(l.qty) }));
const toRows = (d: AllocationDetail): FormRow[] => d.rows.map(r => ({ key: r.id, releaseItemId: r.releaseItemId, productId: r.productId, qty: trim(r.qty) }));

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
  /** Начало периода: по умолчанию равно дате документа (одна смена), пока его не изменили руками; окончание — всегда дата документа */
  const [periodFrom, setPeriodFrom] = React.useState(today());
  const [periodTouched, setPeriodTouched] = React.useState(false);
  const [workCenterId, setWorkCenterId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<FormLine[]>([]);
  const [itemIds, setItemIds] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<FormRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const loadedAt = React.useRef<string | null>(null);

  const detail = isNew ? null : doc.data;
  // карточка кладётся в форму при открытии и после каждого ответа сервера (проведение, заполнение, распределение)
  React.useEffect(() => {
    if (!detail) return;
    const stamp = `${detail.id}:${detail.status}:${JSON.stringify(detail.lines)}:${JSON.stringify(detail.items)}:${JSON.stringify(detail.rows)}`;
    if (loadedAt.current === stamp) return;
    loadedAt.current = stamp;
    const first = loadedFor.current !== detail.id;
    loadedFor.current = detail.id;
    setLines(toForm(detail));
    setItemIds(detail.items.map(i => i.itemId));
    setRows(toRows(detail));
    if (first) {
      setDate(detail.date);
      setPeriodFrom(detail.periodFrom);
      setPeriodTouched(detail.periodFrom !== detail.date);
      setWorkCenterId(detail.workCenterId ?? '');
      setWarehouseId(detail.warehouseId ?? '');
      setComment(detail.comment);
    }
  }, [detail]);

  const editable = canWrite && (!detail || detail.status === 'draft');
  const center = (snapshot.data?.workCenters ?? []).find(w => w.id === workCenterId);
  const defaultWarehouse = center?.warehouseId ?? '';
  /** Пока начало периода не менялось руками, оно идёт за датой документа */
  const changeDate = (v: string) => {
    if (!periodTouched && v) setPeriodFrom(v);
    setDate(v);
  };
  const valid = !!workCenterId && !!date && periodFrom <= date;
  const postable = valid && lines.length > 0 && lines.every(l => l.productId && Number(l.qty) > 0);

  const body = () => ({
    workCenterId,
    warehouseId: warehouseId || defaultWarehouse || null,
    date,
    periodFrom,
    comment,
    lines: lines.filter(l => l.productId).map(l => ({ id: l.id, productId: l.productId, qty: l.qty || '0' })),
  });
  /** Всё, что редактируется в форме: шапка, материалы, продукция и распределение */
  const fullBody = () => ({ ...body(), items: itemIds.map(releaseItemId => ({ releaseItemId })), rows: rows.filter(r => r.releaseItemId && r.productId).map(r => ({ releaseItemId: r.releaseItemId, productId: r.productId, qty: r.qty || '0' })) });

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
    const r = await run(() => (detail ? api.update(detail.id, fullBody()) : api.create(body())), tt('production.allocation.saved'));
    if (r && !detail) await navigate(`/material-allocations/${r.id}`, { replace: true });
  };
  /** Команды заполнения считаются на сервере по сохранённому: правки формы уходят туда до команды */
  const command = async (fn: (docId: string) => Promise<AllocationDetail>, ok: string) => {
    if (!detail) return;
    if (!(await run(() => api.update(detail.id, fullBody())))) return;
    await run(() => fn(detail.id), ok);
  };
  const post = async () => {
    if (!detail) return;
    // перед проведением сохраняются правки формы
    if (editable && !(await run(() => api.update(detail.id, fullBody())))) return;
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

  const items = (detail?.items ?? []).filter(i => itemIds.includes(i.itemId));
  const serverRow = (key: string) => detail?.rows.find(r => r.id === key);
  const productName = (pid: string) => materials.find(m => m.id === pid)?.name ?? detail?.lines.find(l => l.productId === pid)?.name ?? detail?.rows.find(r => r.productId === pid)?.productName ?? '';
  const seeCost = (detail?.rows ?? []).some(r => r.cost !== null);
  const totalCost = (detail?.rows ?? []).reduce((s, r) => s + Number(r.cost ?? 0), 0);
  /** Сверка: распределено по каждому материалу и факт смены */
  const check = [...new Set([...lines.map(l => l.productId), ...rows.map(r => r.productId)])]
    .filter(Boolean)
    .map(pid => ({
      productId: pid,
      fact: lines.filter(l => l.productId === pid).reduce((s, l) => s + Number(l.qty || 0), 0),
      distributed: rows.filter(r => r.productId === pid).reduce((s, r) => s + Number(r.qty || 0), 0),
    }));
  const mismatch = rows.length > 0 && check.some(c => Math.abs(c.fact - c.distributed) > 1e-6);

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <h1>{detail ? (detail.number ?? t('production.allocation.title')) : t('production.allocation.newTitle')}</h1>
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
        <Field label={t('production.allocation.fields.date')} hint={t('production.allocation.fields.dateHint')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => changeDate(e.target.value)} />}</Field>
        <Field label={t('production.allocation.fields.periodFrom')} hint={t('production.allocation.fields.periodFromHint')}>
          {p => (
            <Input
              {...p}
              type="date"
              disabled={!editable}
              value={periodFrom}
              max={date || undefined}
              onChange={e => {
                setPeriodTouched(true);
                setPeriodFrom(e.target.value);
              }}
            />
          )}
        </Field>
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
                    <Button size="sm" disabled={busy || !valid} onClick={() => void command(api.fillByNorms, tt('production.allocation.filled'))}>
                      {t('production.allocation.fillByNorms')}
                    </Button>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void command(api.fillByStock, tt('production.allocation.filled'))}>
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
            id: 'items',
            label: t('production.allocation.tabs.items'),
            count: items.length,
            content: (
              <section className="doc-lines panel" aria-label={t('production.allocation.tabs.items')}>
                {editable && detail && (
                  <div className="row" style={{ gap: 8, padding: '8px 12px' }}>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void command(api.fillItems, tt('production.allocation.itemsFilled'))}>
                      {t('production.allocation.fillItems')}
                    </Button>
                  </div>
                )}
                {!items.length ? (
                  <p className="faint" style={{ padding: 12 }}>{t('production.allocation.itemsEmpty')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="dtbl" aria-label={t('production.allocation.tabs.items')}>
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>{t('production.allocation.colRelease')}</th>
                          <th style={{ width: 120 }}>{t('production.allocation.colDate')}</th>
                          <th>{t('production.allocation.colItem')}</th>
                          <th style={{ width: 120 }} className="r">{t('production.allocation.colItemQty')}</th>
                          <th style={{ width: 36 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(r => (
                          <tr key={r.itemId}>
                            <td className="mono">
                              <Link to={`/documents/${r.releaseId}`} className="crm-link">
                                {r.number ?? t('production.workbench.draft')}
                              </Link>
                            </td>
                            <td className="muted">{fmtDate(r.date)}</td>
                            <td className="trunc">{r.name}</td>
                            <td className="r num">{fmtNumber(Number(r.qty), { maximumFractionDigits: 3 })}</td>
                            <td>
                              {editable && (
                                <IconButton
                                  size="xs"
                                  label={t('production.common.remove')}
                                  onClick={() => {
                                    setItemIds(prev => prev.filter(x => x !== r.itemId));
                                    setRows(prev => prev.filter(x => x.releaseItemId !== r.itemId));
                                  }}
                                >
                                  <Trash2 size={13} />
                                </IconButton>
                              )}
                            </td>
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
            count: rows.length,
            content: (
              <section className="doc-lines panel" aria-label={t('production.allocation.tabs.result')}>
                {editable && detail && (
                  <div className="row" style={{ gap: 8, padding: '8px 12px' }}>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void command(a => api.distribute(a, 'norms'), tt('production.allocation.distributed'))}>
                      {t('production.allocation.distributeNorms')}
                    </Button>
                    <Button size="sm" disabled={busy || !valid} onClick={() => void command(a => api.distribute(a, 'qty'), tt('production.allocation.distributed'))}>
                      {t('production.allocation.distributeQty')}
                    </Button>
                  </div>
                )}
                {!rows.length ? (
                  <p className="faint" style={{ padding: 12 }}>{t('production.allocation.resultEmpty')}</p>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table className="dtbl" aria-label={t('production.allocation.tabs.result')}>
                        <thead>
                          <tr>
                            <th>{t('production.allocation.colItem')}</th>
                            <th>{t('production.allocation.colProduct')}</th>
                            <th style={{ width: 150 }} className="r">{t('production.allocation.colAllocQty')}</th>
                            {seeCost && <th style={{ width: 130 }} className="r">{t('production.allocation.colCost')}</th>}
                            <th style={{ width: 36 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.key}>
                              <td>
                                <Select
                                  aria-label={t('production.allocation.colItem')}
                                  disabled={!editable}
                                  value={r.releaseItemId}
                                  onValueChange={v => setRows(prev => prev.map((x, j) => (j === i ? { ...x, releaseItemId: v } : x)))}
                                  options={items.map(x => ({ value: x.itemId, label: `${x.number ?? t('production.workbench.draft')} · ${x.name} × ${fmtNumber(Number(x.qty), { maximumFractionDigits: 3 })}` }))}
                                  placeholder={t('production.allocation.pickItem')}
                                />
                              </td>
                              <td>
                                <Select
                                  aria-label={t('production.allocation.colProduct')}
                                  disabled={!editable}
                                  value={r.productId}
                                  onValueChange={v => setRows(prev => prev.map((x, j) => (j === i ? { ...x, productId: v } : x)))}
                                  options={[...new Set(lines.map(l => l.productId).filter(Boolean))].map(pid => ({ value: pid, label: productName(pid) }))}
                                  placeholder={t('production.allocation.pickProduct')}
                                />
                              </td>
                              <td className="r">
                                <Input aria-label={t('production.allocation.colAllocQty')} inputMode="decimal" disabled={!editable} value={r.qty} onChange={e => setRows(prev => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                              </td>
                              {seeCost && <td className="r num">{serverRow(r.key)?.cost == null ? '—' : fmtNumber(Number(serverRow(r.key)!.cost), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>}
                              <td>
                                {editable && (
                                  <IconButton size="xs" label={t('production.common.remove')} onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}>
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
                        <Button size="sm" variant="ghost" onClick={() => setRows(prev => [...prev, { key: crypto.randomUUID(), releaseItemId: items[0]?.itemId ?? '', productId: lines[0]?.productId ?? '', qty: '0' }])}>
                          <Plus size={13} />
                          {t('production.allocation.addRow')}
                        </Button>
                      </div>
                    )}
                    {editable && (
                      <ul className="faint" style={{ padding: '4px 12px 8px', fontSize: 12 }} aria-label={t('production.allocation.checkTitle')}>
                        {check.map(c => (
                          <li key={c.productId} style={{ color: Math.abs(c.fact - c.distributed) > 1e-6 ? 'var(--danger, #c0392b)' : undefined }}>
                            {productName(c.productId)}: {fmtNumber(c.distributed, { maximumFractionDigits: 6 })} / {fmtNumber(c.fact, { maximumFractionDigits: 6 })}
                          </li>
                        ))}
                      </ul>
                    )}
                    {mismatch && editable && <p className="faint" style={{ padding: '0 12px 8px', fontSize: 12 }}>{t('production.allocation.mismatchHint')}</p>}
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
