/* Прочие затраты (этап 6): журнал и форма документа. Строки — статья затрат, участок, сумма и комментарий:
   склада и номенклатуры у таких затрат нет, поэтому у документа своя таблица строк и свой экран. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleAlert, FilePlus2, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { useCostItems } from '../docs/data';
import { useSnapshot } from './data';
import { useOtherCosts, useOtherCostsApi, useOtherCostsDocument, type OtherCostsLineInput } from './closing-data';
import { t, tProductionEnum, useT } from '@/i18n';
import { DocInvestmentField } from '../finance/DocInvestmentField';

const today = () => new Date().toISOString().slice(0, 10);
const newLine = (): OtherCostsLineInput => ({ id: crypto.randomUUID(), costItemId: '', workCenterId: null, amount: '0', comment: '' });

export function OtherCostsPage() {
  const tt = useT();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const list = useOtherCosts({ q: q || undefined });
  const rows = list.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.otherCosts.title')}</h1>
          <p>{t('production.otherCosts.subtitle')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => void navigate('/other-costs/new')}>
              <FilePlus2 size={14} />
              {t('production.otherCosts.new')}
            </Button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, padding: '0 var(--gutter) 12px' }}>
        <Field label={tt('production.common.search')}>{p => <Input {...p} value={q} onChange={e => setQ(e.target.value)} />}</Field>
      </div>
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.otherCosts.title')} action={<Button size="sm" onClick={() => list.refetch()}>{t('production.common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<FilePlus2 size={20} />} title={t('production.otherCosts.noCosts')}>
          {t('production.otherCosts.noCostsHint')}
        </EmptyState>
      ) : (
        <div className="table-wrap" style={{ padding: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={t('production.otherCosts.table')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t('production.field.number')}</th>
                <th style={{ width: 120 }}>{t('production.field.date')}</th>
                <th style={{ width: 110 }}>{t('production.field.status')}</th>
                <th>{t('production.field.comment')}</th>
                <th style={{ width: 90 }} className="r">{t('production.field.lines', { count: 1 })}</th>
                <th style={{ width: 130 }} className="r">{t('production.field.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/other-costs/${r.id}`} className="crm-link">
                      {r.number ?? t('production.workbench.draft')}
                    </Link>
                  </td>
                  <td className="muted">{r.date}</td>
                  <td>
                    <Badge tone={r.status === 'posted' ? 'green' : r.status === 'cancelled' ? 'neutral' : 'gray'} dot>
                      {tProductionEnum('docStatus', r.status, r.status)}
                    </Badge>
                  </td>
                  <td className="trunc">{r.comment}</td>
                  <td className="r num muted">{r.lineCount}</td>
                  <td className="r num">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.amount !== null && list.data?.amount !== undefined && (
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
              {t('production.field.total')}: {list.data.amount}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- карточка документа ---------------- */

export function OtherCostsDocumentPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const canWrite = useCanWrite();
  const api = useOtherCostsApi();
  const doc = useOtherCostsDocument(isNew ? undefined : id);
  const { items, centers } = useRefs();
  const navigate = useNavigate();
  const [lines, setLines] = React.useState<OtherCostsLineInput[]>([newLine()]);
  const [date, setDate] = React.useState(today());
  const [comment, setComment] = React.useState('');
  const [investmentProjectId, setInvestmentProjectId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  // строки и шапка загружаемого документа кладём в форму один раз
  React.useEffect(() => {
    if (!doc.data || loadedFor.current === doc.data.id) return;
    loadedFor.current = doc.data.id;
    setLines(doc.data.lines.map(l => ({ id: l.id, costItemId: l.costItemId, workCenterId: l.workCenterId, amount: l.amount ?? '0', comment: l.comment })));
    setDate(doc.data.date);
    setComment(doc.data.comment);
    setInvestmentProjectId(doc.data.investmentProjectId ?? null);
  }, [doc.data]);

  const detail = isNew ? null : doc.data;
  const editable = canWrite && (!detail || detail.status === 'draft');
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const valid = lines.length > 0 && lines.every(l => l.costItemId && Number(l.amount) > 0);

  const save = async () => {
    setBusy(true);
    try {
      const body = { date, investmentProjectId, comment, lines };
      const saved = detail ? await api.update(detail.id, body) : await api.save(body);
      toast(detail ? tt('production.otherCosts.saved') : tt('production.otherCosts.saved'), { duration: 1500 });
      await navigate(`/other-costs/${saved.id}`, { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      if (!valid) await api.update(detail.id, { date, investmentProjectId, comment, lines });
      await api.post(detail.id);
      toast(t('production.order.actions.repost'), { duration: 2000 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && doc.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{detail?.number ?? t('production.otherCosts.newTitle')}</h1>
          <p>{detail ? (detail.status === 'posted' ? t('docs.commentHint.document') : '') : t('production.otherCosts.subtitle')}</p>
        </div>
        <div className="acts">
          {editable && (
            <Button variant="primary" disabled={busy || !valid} onClick={() => void (detail ? void save() : void save())}>
              {detail ? t('production.common.save') : t('production.common.create')}
            </Button>
          )}
          {detail && (
            <>
              {detail.status === 'draft' && (
                <Button disabled={busy || !valid} onClick={() => void post()}>
                  {t('production.piecework.post')}
                </Button>
              )}
              {detail.status === 'posted' && (
                <Button disabled={busy} onClick={() => void api.unpost(detail.id).then(() => toast(t('production.common.unpost'), { duration: 1500 }))}>
                  {t('production.common.unpost')}
                </Button>
              )}
              {detail.status === 'draft' && (
                <Button variant="ghost" onClick={() => setRemoving(true)}>
                  {t('production.common.delete')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <section className="panel doc-head" aria-label={t('production.field.date')}>
        <Field label={t('production.otherCosts.fields.date')}>{p => <Input {...p} type="date" disabled={!editable} value={date} onChange={e => setDate(e.target.value)} />}</Field>
        <DocInvestmentField value={investmentProjectId} current={detail?.investmentProject} disabled={!editable} onChange={setInvestmentProjectId} />
      </section>

      <section className="doc-lines panel" aria-label={t('production.otherCosts.table')}>
        <div className="table-wrap">
          <table className="dtbl" aria-label={t('production.otherCosts.table')}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ width: 220 }}>{t('production.otherCosts.fields.costItem')}</th>
                <th style={{ width: 200 }}>{t('production.otherCosts.fields.workCenter')}</th>
                <th style={{ width: 130 }} className="r">{t('production.otherCosts.fields.amount')}</th>
                <th>{t('production.otherCosts.fields.comment')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} data-row={i}>
                  <td className="faint num">{i + 1}</td>
                  <td>
                    <Select
                      aria-label={t('production.otherCosts.fields.costItem')}
                      disabled={!editable}
                      value={l.costItemId}
                      onValueChange={v => setLines(prev => prev.map((x, j) => (j === i ? { ...x, costItemId: v } : x)))}
                      options={items.map(c => ({ value: c.id, label: c.name }))}
                    />
                  </td>
                  <td>
                    <Select
                      aria-label={t('production.otherCosts.fields.workCenter')}
                      disabled={!editable}
                      value={l.workCenterId ?? ''}
                      onValueChange={v => setLines(prev => prev.map((x, j) => (j === i ? { ...x, workCenterId: v || null } : x)))}
                      options={[{ value: '', label: t('production.common.empty') }, ...centers.map(w => ({ value: w.id, label: w.name }))]}
                    />
                  </td>
                  <td className="r">
                    <Input aria-label={t('production.otherCosts.fields.amount')} inputMode="decimal" disabled={!editable} value={l.amount} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  </td>
                  <td>
                    <Input aria-label={t('production.otherCosts.fields.comment')} disabled={!editable} value={l.comment} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} />
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
            <Button size="sm" variant="ghost" onClick={() => setLines(prev => [...prev, newLine()])}>
              <Plus size={13} />
              {t('production.common.add')}
            </Button>
          </div>
        )}
        <div className="doc-totals panel" style={{ border: 0 }}>
          <div className="trow grand">
            <span>{t('production.field.total')}</span>
            <span className="num">{total.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <section className="doc-comment panel" aria-label={t('docs.comment')}>
        <Field label={t('docs.comment')}>
          {p => <Input {...p} disabled={!editable} value={comment} placeholder={t('docs.commentHint.otherCosts')} onChange={e => setComment(e.target.value)} />}
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
            await navigate('/other-costs', { replace: true });
          }}
          description=""
        />
      )}
    </div>
  );
}

/** Статьи затрат и участки для формы */
function useRefs() {
  const items = useCostItems('expense');
  const snapshot = useSnapshot();
  return { items: items.data ?? [], centers: (snapshot.data?.workCenters ?? []).filter(w => !w.archivedAt) };
}
