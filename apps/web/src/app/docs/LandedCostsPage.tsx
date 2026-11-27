/* Дополнительные расходы в себестоимость (задача 1385): журнал документов и форма распределения.
   Сумма расходов распределяется по приходным строкам поступлений и выпусков; проведение добавляет доли к цене
   прихода, поэтому дорожает и остаток, и уже списанное. Предпросмотр распределения считается той же чистой
   функцией, что и на сервере (@erp/shared allocateLandedCost). */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { DocForm, DocHeader } from '@/components/erp/doc-form';
import { DateInput } from '@/components/erp/date-picker';
import { allocateLandedCost, type LandedCostMethod } from '@erp/shared';
import { fmtAmount, t } from '@/i18n';
import { useCanWrite } from '../meta/custom-fields';
import { STATUS_LABEL, useCostItems } from '../docs/data';
import { CounterpartyPicker } from '../docs/pickers';
import { LandedCostAllocationTable } from './landed-cost-allocation';
import { METHOD_LABEL, bodyLines, useLandedCost, useLandedCostApi, useLandedCostBaseLines, useLandedCostBases, useLandedCosts, type LandedCostDraft, type LandedCostJournalRow, type LandedCostLineDraft } from './landed-costs-data';

const today = () => new Date().toISOString().slice(0, 10);
/** Начало периода выбора оснований: месяц назад — свежие поступления, которые ещё правят */
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const METHODS: LandedCostMethod[] = ['by_amount', 'by_qty', 'by_weight', 'manual'];

const statusTone = (status: string) => (status === 'posted' ? 'green' : status === 'cancelled' ? 'neutral' : 'gray') as 'green' | 'neutral' | 'gray';

export function LandedCostsPage() {
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const list = useLandedCosts({ q: q || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('landedCosts.title')}</h1>
          <p>{t('landedCosts.lead')}</p>
        </div>
        <div className="acts">
          <Button onClick={() => void navigate('/landed-costs/report')}>{t('landedCosts.report')}</Button>
          {canWrite && (
            <Button variant="primary" onClick={() => void navigate('/landed-costs/new')}>
              <FilePlus2 size={14} />
              {t('landedCosts.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={t('landedCosts.search')}>{p => <Input {...p} value={q} placeholder={t('landedCosts.searchPlaceholder')} onChange={e => setQ(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('landedCosts.title')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={t('landedCosts.emptyTitle')}>
          {t('landedCosts.emptyHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={t('landedCosts.journal')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t('landedCosts.col.number')}</th>
                <th style={{ width: 110 }}>{t('landedCosts.col.date')}</th>
                <th style={{ width: 110 }}>{t('landedCosts.col.status')}</th>
                <th style={{ width: 160 }}>{t('landedCosts.col.method')}</th>
                <th style={{ width: 200 }}>{t('landedCosts.col.supplier')}</th>
                <th style={{ width: 180 }}>{t('landedCosts.col.costItem')}</th>
                <th style={{ width: 90 }} className="r">
                  {t('landedCosts.col.lines')}
                </th>
                <th style={{ width: 130 }} className="r">
                  {t('landedCosts.col.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: LandedCostJournalRow) => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/landed-costs/${r.id}`} className="crm-link">
                      {r.number ?? t('landedCosts.draft')}
                    </Link>
                  </td>
                  <td className="muted">{r.date}</td>
                  <td>
                    <Badge tone={statusTone(r.status)} dot>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </td>
                  <td className="muted">{METHOD_LABEL[r.method]}</td>
                  <td className="trunc">{r.supplierName ?? '—'}</td>
                  <td className="trunc muted">{r.costItemName ?? '—'}</td>
                  <td className="r num muted">{r.lineCount}</td>
                  <td className="r num">{r.total === null ? '—' : fmtAmount(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.amount ? (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {t('landedCosts.totalOfAll')}: {fmtAmount(list.data.amount)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------- карточка документа ---------------- */

const emptyDraft = (): LandedCostDraft => ({ date: today(), supplier: null, costItemId: null, supplierDocument: '', method: 'by_amount', amount: '', comment: '', lines: [] });

export function LandedCostDocumentPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const api = useLandedCostApi();
  const doc = useLandedCost(isNew ? undefined : id);
  const items = useCostItems('expense');
  const navigate = useNavigate();
  const [draft, setDraft] = React.useState<LandedCostDraft>(emptyDraft);
  const [baseId, setBaseId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);
  const bases = useLandedCostBases({ from: monthAgo() });
  const baseLines = useLandedCostBaseLines(baseId || null);

  // шапка и строки загружаемого документа кладутся в форму один раз
  React.useEffect(() => {
    if (!doc.data || loadedFor.current === doc.data.id) return;
    loadedFor.current = doc.data.id;
    setDraft({
      date: doc.data.date,
      supplier: doc.data.supplierId ? { id: doc.data.supplierId, name: doc.data.supplierName ?? '' } : null,
      costItemId: doc.data.costItemId,
      supplierDocument: doc.data.supplierDocument,
      method: doc.data.method,
      amount: doc.data.total ?? '',
      comment: doc.data.comment,
      lines: doc.data.lines.map(l => ({
        id: l.id,
        baseDocumentId: l.baseDocumentId,
        baseDocumentLineId: l.baseDocumentLineId,
        baseDocumentNumber: l.baseDocumentNumber ?? '',
        productId: l.productId,
        productName: l.productName,
        sku: l.sku,
        qty: l.qty,
        baseAmount: l.baseAmount ?? '0',
        weight: l.weight,
        amount: l.amount ?? '0',
      })),
    });
  }, [doc.data]);

  const detail = isNew ? null : doc.data;
  const editable = canWrite && (!detail || detail.status === 'draft');
  // предпросмотр: та же функция, что на сервере (копейки распределяются методом наибольших остатков)
  const allocation = React.useMemo(
    () =>
      allocateLandedCost({
        method: draft.method,
        amount: draft.amount,
        lines: draft.lines.map(l => ({ id: l.id, baseAmount: l.baseAmount, qty: l.qty, weight: l.weight, amount: draft.method === 'manual' ? l.amount : null })),
      }),
    [draft.method, draft.amount, draft.lines],
  );
  const shareByLine = new Map(allocation.rows.map(r => [r.lineId, r]));
  const total = allocation.total;
  const valid = draft.lines.length > 0 && (draft.method === 'manual' ? Number(total) > 0 : Number(draft.amount) > 0);

  const addBaseLines = () => {
    const data = baseLines.data;
    if (!data?.lines.length) return;
    setDraft(prev => {
      // строки одного основания добавляются один раз: повторный выбор не плодит дубли
      const have = new Set(prev.lines.map(l => l.baseDocumentLineId));
      const added: LandedCostLineDraft[] = data.lines
        .filter(l => !have.has(l.lineId))
        .map(l => ({
          id: crypto.randomUUID(),
          baseDocumentId: data.document.id,
          baseDocumentNumber: data.document.number ?? data.document.date,
          baseDocumentLineId: l.lineId,
          productId: l.productId,
          productName: l.productName,
          sku: l.sku,
          qty: l.qty,
          baseAmount: l.baseAmount ?? '0',
          weight: l.weight,
          amount: '0',
        }));
      return { ...prev, lines: [...prev.lines, ...added] };
    });
    toast(t('landedCosts.form.lineAdded'), { duration: 1500 });
  };

  const save = async (): Promise<string | null> => {
    setBusy(true);
    try {
      const body = {
        date: draft.date,
        supplierId: draft.supplier?.id ?? null,
        costItemId: draft.costItemId,
        supplierDocument: draft.supplierDocument,
        method: draft.method,
        amount: draft.method === 'manual' ? null : draft.amount,
        comment: draft.comment,
        lines: bodyLines(draft),
      };
      const saved = detail ? await api.update(detail.id, body) : await api.save(body);
      toast(t('landedCosts.form.saved'), { duration: 1500 });
      return saved.id;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveAndGo = async () => {
    const savedId = await save();
    if (savedId && !detail) await navigate(`/landed-costs/${savedId}`, { replace: true });
  };

  const post = async () => {
    const savedId = await save();
    if (!savedId) return;
    setBusy(true);
    try {
      await api.post(savedId);
      toast(t('landedCosts.form.posted'), { duration: 2000 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && doc.isPending) return <DocForm header={<div className="doc-bar"><Skeleton w={260} h={24} /></div>} />;

  const baseOptions = (bases.data?.items ?? []).map(b => ({
    value: b.id,
    label: `${b.number ? `${b.number} · ` : ''}${b.date}${b.counterpartyName ? ` · ${b.counterpartyName}` : ''}${b.landedAmount ? ` · ${fmtAmount(b.landedAmount)}` : ''}`,
  }));

  return (
    <DocForm
      header={
        <DocHeader
          title={detail?.number ?? t('landedCosts.form.newTitle')}
          subtitle={detail?.status === 'posted' ? t('landedCosts.form.closedHint') : t('landedCosts.form.lead')}
          actions={
            <>
              {editable && (
                <Button variant="primary" disabled={busy || !valid} onClick={() => void saveAndGo()}>
                  {detail ? t('landedCosts.form.save') : t('landedCosts.form.create')}
                </Button>
              )}
              {editable && (
                <Button disabled={busy || !valid} onClick={() => void post()}>
                  {t('landedCosts.form.post')}
                </Button>
              )}
              {detail?.status === 'posted' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void api
                      .unpost(detail.id)
                      .then(() => toast(t('landedCosts.form.unposted'), { duration: 1500 }))
                      .catch((e: Error) => toast.error(e.message))
                  }
                >
                  {t('landedCosts.form.unpost')}
                </Button>
              )}
              {detail?.status === 'draft' && (
                <Button variant="ghost" onClick={() => setRemoving(true)}>
                  {t('landedCosts.form.delete')}
                </Button>
              )}
            </>
          }
        />
      }
    >
      <section className="panel doc-head" aria-label={t('landedCosts.form.date')}>
        <Field label={t('landedCosts.form.date')}>{p => <DateInput {...p} disabled={!editable} value={draft.date} onChange={v => v && setDraft(d => ({ ...d, date: v }))} />}</Field>
        <Field label={t('landedCosts.form.supplier')}>
          {p => (
            <CounterpartyPicker
              id={p.id}
              disabled={!editable}
              value={draft.supplier?.name ?? ''}
              onPick={c => setDraft(d => ({ ...d, supplier: { id: c.id, name: c.name } }))}
            />
          )}
        </Field>
        <Field label={t('landedCosts.form.costItem')} hint={t('landedCosts.form.costItemHint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={draft.costItemId ?? ''}
              onValueChange={v => setDraft(d => ({ ...d, costItemId: v || null }))}
              options={[{ value: '', label: t('landedCosts.none') }, ...(items.data ?? []).map(c => ({ value: c.id, label: c.name }))]}
              aria-label={t('landedCosts.form.costItem')}
            />
          )}
        </Field>
        <Field label={t('landedCosts.form.method')} hint={t('landedCosts.form.methodHint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={draft.method}
              onValueChange={v => setDraft(d => ({ ...d, method: v as LandedCostMethod }))}
              options={METHODS.map(m => ({ value: m, label: METHOD_LABEL[m] }))}
              aria-label={t('landedCosts.form.method')}
            />
          )}
        </Field>
        <Field label={t('landedCosts.form.amount')} hint={draft.method === 'manual' ? t('landedCosts.form.manualTotal') : t('landedCosts.form.amountHint')}>
          {p => (
            <Input
              {...p}
              inputMode="decimal"
              disabled={!editable || draft.method === 'manual'}
              value={draft.method === 'manual' ? total : draft.amount}
              onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
            />
          )}
        </Field>
        <Field label={t('landedCosts.form.supplierDocument')} hint={t('landedCosts.form.supplierDocumentHint')}>
          {p => <Input {...p} disabled={!editable} value={draft.supplierDocument} onChange={e => setDraft(d => ({ ...d, supplierDocument: e.target.value }))} />}
        </Field>
      </section>

      <section className="panel" aria-label={t('landedCosts.form.bases')}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={t('landedCosts.form.basePicker')} hint={t('landedCosts.form.basesHint')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={baseId}
                onValueChange={setBaseId}
                options={[{ value: '', label: t('landedCosts.none') }, ...baseOptions]}
                aria-label={t('landedCosts.form.basePicker')}
              />
            )}
          </Field>
          <Button size="sm" disabled={!editable || !baseId || !baseLines.data?.lines.length} onClick={addBaseLines}>
            <Plus size={13} />
            {t('landedCosts.form.addBase')}
          </Button>
          {bases.isSuccess && !baseOptions.length && <span className="faint">{t('landedCosts.form.noBases')}</span>}
        </div>
      </section>

      <section className="doc-lines panel" aria-label={t('landedCosts.form.lines')}>
        {!draft.lines.length ? (
          <p className="faint" style={{ padding: '12px 16px', fontSize: 13 }}>
            {t('landedCosts.form.linesEmpty')}
          </p>
        ) : (
          <LandedCostAllocationTable
            lines={draft.lines}
            method={draft.method}
            editable={editable}
            shares={shareByLine}
            onAmount={(i, value) => setDraft(d => ({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, amount: value } : x)) }))}
            onRemove={i => setDraft(d => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}
          />
        )}
        <div className="doc-totals panel" style={{ border: 0 }}>
          <div className="trow grand">
            <span>{t('landedCosts.form.total')}</span>
            <span className="num">{fmtAmount(total)}</span>
          </div>
        </div>
      </section>

      <section className="doc-comment panel" aria-label={t('landedCosts.form.comment')}>
        <Field label={t('landedCosts.form.comment')}>
          {p => <Input {...p} disabled={!editable} value={draft.comment} onChange={e => setDraft(d => ({ ...d, comment: e.target.value }))} />}
        </Field>
      </section>

      {removing && detail && (
        <ConfirmDialog
          open
          danger
          title={t('landedCosts.form.deleteTitle')}
          confirmLabel={t('landedCosts.form.delete')}
          onOpenChange={open => !open && setRemoving(false)}
          onConfirm={async () => {
            setRemoving(false);
            try {
              await api.remove(detail.id);
              await navigate('/landed-costs', { replace: true });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
          description=""
        />
      )}
    </DocForm>
  );
}
