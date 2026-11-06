/* Смета объекта (задача 1269): вкладка карточки объекта — основная смета и допработы, редактор позиций по разделам,
   итоги, план-факт, согласование, импорт строк из таблицы и заказы из позиций. Себестоимость и маржу показывает сервер
   только owner/admin (в ответе null), поэтому колонки и итоги себестоимости скрываются по detail.canSeeCost. */
import * as React from 'react';
import { Copy, Factory, FileSpreadsheet, Plus, Save, Trash2, Truck, Undo2 } from 'lucide-react';
import { computeEstimateTotals, dec, ESTIMATE_ITEM_KINDS, fmt, type EstimateItemKind } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, fmtNumber, useT, type TKey } from '@/i18n';
import { useCompanies, useUnits } from '../catalog/data';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useSession } from '../data/session';
import { ProductPicker } from '../docs/pickers';
import { useObjectOptions } from './data';
import { useEstimate, useEstimateApi, useObjectEstimates, type EstimateDetail, type EstimateImportRow, type EstimateSummary } from './estimates-data';

/** Подписи видов позиций и статусов: ключи словаря заданы явно, чтобы шаблонные строки не теряли тип */
const KIND_LABEL: Record<EstimateItemKind, TKey> = {
  work: 'estimates.itemKind.work',
  material: 'estimates.itemKind.material',
  panel: 'estimates.itemKind.panel',
  subcontract: 'estimates.itemKind.subcontract',
  other: 'estimates.itemKind.otherKind',
};
const STATUS_LABEL: Record<'draft' | 'approved' | 'rejected', TKey> = {
  draft: 'estimates.status.draft',
  approved: 'estimates.status.approved',
  rejected: 'estimates.changeStatus.rejected',
};
const CHANGE_STATUS_LABEL: Record<'draft' | 'approved' | 'rejected', TKey> = {
  draft: 'estimates.changeStatus.draft',
  approved: 'estimates.changeStatus.approved',
  rejected: 'estimates.changeStatus.rejected',
};

const uid = () => crypto.randomUUID();
const num = (s: string) => s.trim().replace(',', '.');
const fmtHours = (v: string | number) => fmtNumber(v, { maximumFractionDigits: 3 });
const trim = (v: string | null | undefined) => (v == null ? '' : v.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));

function useRun() {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

const statusTone = (s: EstimateSummary) => (s.kind === 'change' ? (s.changeStatus === 'approved' ? 'green' : s.changeStatus === 'rejected' ? 'red' : 'gray') : s.status === 'approved' ? 'green' : 'gray');

/** Вкладка «Смета» карточки объекта: выбор сметы, создание основной, копирование, допработы */
export function EstimateTab({ objectId, objectName, canWrite }: { objectId: string; objectName: string; canWrite: boolean }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const { active } = useSession();
  const isAdmin = active?.role === 'owner' || active?.role === 'admin';
  const list = useObjectEstimates(objectId);
  const items = list.data ?? [];
  const main = items.find(x => x.kind === 'main') ?? null;
  const changes = items.filter(x => x.kind === 'change');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'create' | 'copy' | 'change' | null>(null);
  const [name, setName] = React.useState('');
  const [changeName, setChangeName] = React.useState('');
  const [changeNote, setChangeNote] = React.useState('');
  const activeId = (picked && items.some(x => x.id === picked) ? picked : main?.id) ?? null;
  const detail = useEstimate(activeId ?? undefined);

  if (list.isPending) return <Skeleton w="100%" h={120} />;

  if (!main)
    return (
      <>
        <EmptyState icon={<FileSpreadsheet size={20} />} title={tt('estimates.empty')} action={
          canWrite ? (
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" disabled={busy} onClick={() => { setName(objectName); setDialog('create'); }}><Plus size={14} />{tt('estimates.create')}</Button>
              <Button onClick={() => setDialog('copy')}><Copy size={14} />{tt('estimates.actions.copy')}</Button>
            </div>
          ) : undefined
        }>
          {tt('estimates.emptyHint')}
        </EmptyState>
        {dialog === 'create' && (
          <Dialog open onOpenChange={v => !v && setDialog(null)}>
            <DialogContent
              title={tt('estimates.createTitle')}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setDialog(null)}>{tt('common.cancel')}</Button>
                  <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void run(async () => {
                    const created = await api.create(objectId, { name: name.trim() });
                    setDialog(null);
                    setPicked(created.id);
                  })}>{tt('estimates.create')}</Button>
                </>
              }
            >
              <Field label={tt('estimates.name')}>{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field>
            </DialogContent>
          </Dialog>
        )}
        {dialog === 'copy' && <CopyDialog objectId={objectId} onClose={() => setDialog(null)} onDone={id => { setDialog(null); setPicked(id); }} />}
      </>
    );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" variant={activeId === main.id ? 'primary' : 'secondary'} onClick={() => setPicked(main.id)}>
          {tt('estimates.main')} · <span className="mono">{main.number}</span>
          <Badge tone={statusTone(main)}>{tt(STATUS_LABEL[main.status])}</Badge>
        </Button>
        {changes.map(c => (
          <Button key={c.id} size="sm" variant={activeId === c.id ? 'primary' : 'secondary'} onClick={() => setPicked(c.id)}>
            {tt('estimates.change')} · <span className="mono">{c.number}</span>
            <Badge tone={statusTone(c)}>{tt(CHANGE_STATUS_LABEL[c.changeStatus ?? 'draft'])}</Badge>
          </Button>
        ))}
        {canWrite && main.status === 'approved' && (
          <Button size="sm" onClick={() => { setChangeName(''); setChangeNote(''); setDialog('change'); }}><Plus size={14} />{tt('estimates.actions.addChange')}</Button>
        )}
        {canWrite && (
          <Button size="sm" variant="ghost" onClick={() => setDialog('copy')} title={tt('estimates.actions.copy')}><Copy size={14} />{tt('estimates.actions.copy')}</Button>
        )}
      </div>

      {detail.isPending && <Skeleton w="100%" h={200} />}
      {detail.isError && <p className="faint">{errorMessage(detail.error)}</p>}
      {detail.data && <EstimateEditor detail={detail.data} canWrite={canWrite} isAdmin={isAdmin} />}

      {dialog === 'change' && (
        <Dialog open onOpenChange={v => !v && setDialog(null)}>
          <DialogContent
            title={tt('estimates.changeTitle')}
            description={tt('estimates.changeHint')}
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(null)}>{tt('common.cancel')}</Button>
                <Button variant="primary" disabled={busy || !changeName.trim()} onClick={() => void run(async () => {
                  const created = await api.addChange(main.id, { name: changeName.trim(), note: changeNote });
                  setDialog(null);
                  setPicked(created.id);
                })}>{tt('estimates.actions.addChange')}</Button>
              </>
            }
          >
            <div className="stack" style={{ gap: 12 }}>
              <Field label={tt('estimates.name')}>{p => <Input {...p} value={changeName} onChange={e => setChangeName(e.target.value)} />}</Field>
              <Field label={tt('estimates.changeNote')}>{p => <Input {...p} value={changeNote} onChange={e => setChangeNote(e.target.value)} />}</Field>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {dialog === 'copy' && <CopyDialog objectId={objectId} onClose={() => setDialog(null)} onDone={id => { setDialog(null); setPicked(id); }} />}
    </div>
  );
}

/* ---------------- редактор сметы ---------------- */

interface RowDraft {
  key: string;
  kind: EstimateItemKind;
  name: string;
  productId: string | null;
  productName: string;
  manufacturedItemId: string | null;
  unitCode: string;
  qty: string;
  price: string;
  costPrice: string;
  laborHours: string;
  sectionKey: string | null;
}

interface SectionDraft {
  key: string;
  name: string;
}

const toDraft = (d: EstimateDetail): { sections: SectionDraft[]; rows: RowDraft[] } => ({
  sections: d.sections.map(s => ({ key: s.id, name: s.name })),
  rows: d.items.map(i => ({
    key: i.id,
    kind: i.kind,
    name: i.name,
    productId: i.productId,
    productName: i.productName ?? '',
    manufacturedItemId: i.manufacturedItemId,
    unitCode: i.unitCode,
    qty: trim(i.qty),
    price: trim(i.price),
    costPrice: i.costPrice == null ? '' : trim(i.costPrice),
    laborHours: trim(i.laborHours),
    sectionKey: i.sectionId,
  })),
});

function EstimateEditor({ detail, canWrite, isAdmin }: { detail: EstimateDetail; canWrite: boolean; isAdmin: boolean }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const units = useUnits();
  const [draft, setDraft] = React.useState(() => toDraft(detail));
  const [dirty, setDirty] = React.useState(false);
  const [header, setHeader] = React.useState({ name: detail.name, number: detail.number });
  const [dialog, setDialog] = React.useState<'import' | 'supplier' | 'production' | 'remove' | null>(null);
  const signature = `${detail.id}:${detail.updatedAt}`;
  const loaded = React.useRef(signature);

  React.useEffect(() => {
    if (loaded.current === signature) return;
    loaded.current = signature;
    setDraft(toDraft(detail));
    setHeader({ name: detail.name, number: detail.number });
    setDirty(false);
  }, [signature, detail]);

  const editable = canWrite && detail.status === 'draft';
  const unitOptions = (units.data ?? []).map(u => ({ value: u.code, label: `${u.symbol} · ${u.name}` }));

  const change = (fn: (d: { sections: SectionDraft[]; rows: RowDraft[] }) => { sections: SectionDraft[]; rows: RowDraft[] }) => {
    setDraft(d => fn(d));
    setDirty(true);
  };
  const patchRow = (key: string, patch: Partial<RowDraft>) => change(d => ({ ...d, rows: d.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) }));
  const addRow = (sectionKey: string | null) =>
    change(d => ({
      ...d,
      rows: [...d.rows, { key: uid(), kind: 'work', name: '', productId: null, productName: '', manufacturedItemId: null, unitCode: '796', qty: '1', price: '0', costPrice: '', laborHours: '', sectionKey }],
    }));
  const removeRow = (key: string) => change(d => ({ ...d, rows: d.rows.filter(r => r.key !== key) }));
  const addSection = () => change(d => ({ ...d, sections: [...d.sections, { key: uid(), name: tt('estimates.section') }] }));
  const removeSection = (key: string) => change(d => ({ ...d, sections: d.sections.filter(s => s.key !== key), rows: d.rows.map(r => (r.sectionKey === key ? { ...r, sectionKey: null } : r)) }));

  // итоги редактора считаются теми же функциями, что и на сервере
  const totals = React.useMemo(
    () => computeEstimateTotals(draft.rows.map(r => ({ kind: r.kind, qty: num(r.qty) || '0', price: num(r.price) || '0', costPrice: detail.canSeeCost ? num(r.costPrice) || '0' : '0', laborHours: num(r.laborHours) || '0' }))),
    [draft.rows, detail.canSeeCost],
  );
  // факт и остаток — тоже десятичной арифметикой, без float
  const factTotals = React.useMemo(() => {
    let fact = 0n;
    for (const r of draft.rows) fact += dec(detail.planFact.find(x => x.id === r.key)?.fact.revenue ?? '0');
    return { fact: fmt(fact, 2), remaining: fmt(dec(totals.revenue) - fact, 2) };
  }, [draft.rows, detail.planFact, totals.revenue]);

  const save = async () => {
    const named = draft.rows.filter(r => r.name.trim());
    if (named.length !== draft.rows.length) return void toast.error(tt('estimates.columns.name'));
    if (draft.sections.some(s => !s.name.trim())) return void toast.error(tt('estimates.sectionName'));
    await run(async () => {
      if (header.name.trim() && header.name.trim() !== detail.name) await api.save(detail.id, { name: header.name.trim(), number: header.number.trim() });
      await api.saveItems(detail.id, {
        sections: draft.sections.map(s => ({ id: s.key, name: s.name.trim() })),
        items: draft.rows.map(r => ({
          id: r.key,
          sectionId: r.sectionKey,
          kind: r.kind,
          name: r.name.trim(),
          productId: r.kind === 'material' || r.kind === 'subcontract' ? r.productId : null,
          unitCode: r.unitCode,
          qty: num(r.qty) || '0',
          price: num(r.price) || '0',
          costPrice: num(r.costPrice) || '0',
          laborHours: num(r.laborHours) || '0',
          manufacturedItemId: r.kind === 'panel' ? r.manufacturedItemId : null,
        })),
      });
      setDirty(false);
      toast(tt('estimates.saved'), { duration: 1500 });
    });
  };

  const colCount = 12 + (detail.canSeeCost ? 2 : 0) + (editable ? 1 : 0);

  const renderRow = (r: RowDraft, n: number) => {
    const line = computeEstimateTotals([{ kind: r.kind, qty: num(r.qty) || '0', price: num(r.price) || '0', costPrice: detail.canSeeCost ? num(r.costPrice) || '0' : '0', laborHours: num(r.laborHours) || '0' }]);
    const fact = detail.planFact.find(x => x.id === r.key)?.fact.revenue ?? '0.00';
    const remaining = detail.planFact.find(x => x.id === r.key)?.remaining.revenue ?? line.revenue;
    return (
      <tr key={r.key}>
        <td className="faint num">{n}</td>
        <td>
          {editable ? (
            <Select aria-label={tt('estimates.columns.kind')} value={r.kind} onValueChange={v => patchRow(r.key, { kind: v as EstimateItemKind })} options={ESTIMATE_ITEM_KINDS.map(k => ({ value: k, label: tt(KIND_LABEL[k]) }))} />
          ) : (
            <span className="muted">{tt(KIND_LABEL[r.kind])}</span>
          )}
        </td>
        <td>
          {editable ? <input className="input cell-input" aria-label={tt('estimates.columns.name')} value={r.name} onChange={e => patchRow(r.key, { name: e.target.value })} /> : r.name}
        </td>
        <td>
          {editable && (r.kind === 'material' || r.kind === 'subcontract') ? (
            <ProductPicker
              value={r.productName}
              price="purchasePrice"
              onPick={p => patchRow(r.key, { productId: p.id, productName: p.name, unitCode: p.unitCode, name: r.name || p.name, price: r.price === '0' || !r.price ? p.price : r.price, costPrice: r.costPrice || p.purchasePrice })}
            />
          ) : editable && r.kind === 'panel' ? (
            <ManufacturedPicker value={r.manufacturedItemId} onChange={(id, name) => patchRow(r.key, { manufacturedItemId: id, name: r.name || name })} ariaLabel={tt('estimates.columns.item')} />
          ) : (
            <span className="faint">{r.productName || (r.manufacturedItemId ? '—' : '')}</span>
          )}
        </td>
        <td>
          {editable ? <Select aria-label={tt('estimates.columns.unit')} value={r.unitCode} onValueChange={v => patchRow(r.key, { unitCode: v })} options={unitOptions} /> : unitOptions.find(u => u.value === r.unitCode)?.label.split(' · ')[0] ?? r.unitCode}
        </td>
        <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.qty')} value={r.qty} onChange={e => patchRow(r.key, { qty: e.target.value })} /> : fmtNumber(num(r.qty))}</td>
        <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.price')} value={r.price} onChange={e => patchRow(r.key, { price: e.target.value })} /> : fmtAmount(r.price)}</td>
        <td className="r num">{fmtAmount(line.revenue)}</td>
        {detail.canSeeCost && (
          <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.costPrice')} value={r.costPrice} onChange={e => patchRow(r.key, { costPrice: e.target.value })} /> : fmtAmount(r.costPrice)}</td>
        )}
        {detail.canSeeCost && <td className="r num">{fmtAmount(line.cost)}</td>}
        <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.hoursPerUnit')} value={r.laborHours} onChange={e => patchRow(r.key, { laborHours: e.target.value })} /> : fmtHours(r.laborHours)}</td>
        <td className="r num">{fmtHours(line.hours)}</td>
        <td className="r num muted">{fmtAmount(fact)}</td>
        <td className="r num">{fmtAmount(remaining)}</td>
        {editable && (
          <td>
            <IconButton size="sm" label={tt('estimates.removeItem')} onClick={() => removeRow(r.key)}><Trash2 size={13} /></IconButton>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <section className="panel doc-head" aria-label={tt('estimates.title')}>
        <Field label={tt('estimates.name')}>{p => <Input {...p} disabled={detail.status === 'approved' || !canWrite} value={header.name} onChange={e => { setHeader(h => ({ ...h, name: e.target.value })); setDirty(true); }} />}</Field>
        <Field label={tt('estimates.number')}>{p => <Input {...p} disabled={detail.status === 'approved' || !canWrite} value={header.number} onChange={e => { setHeader(h => ({ ...h, number: e.target.value })); setDirty(true); }} />}</Field>
        <Field label={tt('estimates.status.draft')}>
          {() => (
            <div className="doc-ro">
              <Badge tone={statusTone(detail)}>{tt(detail.kind === 'change' ? CHANGE_STATUS_LABEL[detail.changeStatus ?? 'draft'] : STATUS_LABEL[detail.status])}</Badge>
              {detail.approvedByName && <span className="faint" style={{ marginLeft: 8 }}>{detail.approvedByName}</span>}
              {detail.parent && <span className="faint mono" style={{ marginLeft: 8 }}>{detail.parent.number}</span>}
            </div>
          )}
        </Field>
      </section>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {editable && (
          <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}><Save size={14} />{tt('estimates.actions.save')}</Button>
        )}
        {editable && (
          <Button disabled={busy || !detail.items.length} onClick={() => void run(() => api.approve(detail.id))}><FileSpreadsheet size={14} />{tt('estimates.actions.approve')}</Button>
        )}
        {detail.status === 'approved' && isAdmin && (
          <Button disabled={busy} onClick={() => void run(() => api.unapprove(detail.id))}><Undo2 size={14} />{tt('estimates.actions.unapprove')}</Button>
        )}
        {editable && (
          <Button disabled={busy} onClick={() => setDialog('import')}><FileSpreadsheet size={14} />{tt('estimates.actions.import')}</Button>
        )}
        {canWrite && (
          <Button disabled={busy} onClick={() => setDialog('supplier')}><Truck size={14} />{tt('estimates.actions.supplierOrder')}</Button>
        )}
        {canWrite && (
          <Button disabled={busy} onClick={() => setDialog('production')}><Factory size={14} />{tt('estimates.actions.productionOrder')}</Button>
        )}
        {editable && (
          <Button variant="danger-ghost" disabled={busy} onClick={() => setDialog('remove')}><Trash2 size={14} />{tt('estimates.actions.deleteDraft')}</Button>
        )}
        {dirty && <span className="faint" style={{ alignSelf: 'center' }}>{tt('estimates.unsaved')}</span>}
      </div>

      {detail.status === 'approved' && <p className="faint" style={{ fontSize: 12 }}>{tt('estimates.approved')} {tt('estimates.approvedPrices')}</p>}
      {!detail.canSeeCost && <p className="faint" style={{ fontSize: 12 }}>{tt('estimates.hiddenCosts')}</p>}

      <div className="table-wrap">
        <table className="dtbl" aria-label={tt('estimates.title')}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>{tt('estimates.columns.num')}</th>
              <th style={{ width: 120 }}>{tt('estimates.columns.kind')}</th>
              <th>{tt('estimates.columns.name')}</th>
              <th style={{ width: 170 }}>{tt('estimates.columns.item')}</th>
              <th style={{ width: 110 }}>{tt('estimates.columns.unit')}</th>
              <th style={{ width: 90 }} className="r">{tt('estimates.columns.qty')}</th>
              <th style={{ width: 110 }} className="r">{tt('estimates.columns.price')}</th>
              <th style={{ width: 120 }} className="r">{tt('estimates.columns.amount')}</th>
              {detail.canSeeCost && <th style={{ width: 110 }} className="r">{tt('estimates.columns.costPrice')}</th>}
              {detail.canSeeCost && <th style={{ width: 120 }} className="r">{tt('estimates.columns.cost')}</th>}
              <th style={{ width: 90 }} className="r">{tt('estimates.columns.hoursPerUnit')}</th>
              <th style={{ width: 90 }} className="r">{tt('estimates.columns.hours')}</th>
              <th style={{ width: 110 }} className="r">{tt('estimates.columns.fact')}</th>
              <th style={{ width: 110 }} className="r">{tt('estimates.columns.remaining')}</th>
              {editable && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {draft.sections.map(s => {
              const rows = draft.rows.filter(r => r.sectionKey === s.key);
              return (
                <React.Fragment key={s.key}>
                  <tr className="sec-row">
                    <td colSpan={colCount - (editable ? 1 : 0)}>
                      {editable ? <input className="input cell-input" aria-label={tt('estimates.sectionName')} value={s.name} onChange={e => change(d => ({ ...d, sections: d.sections.map(x => (x.key === s.key ? { ...x, name: e.target.value } : x)) }))} /> : <b>{s.name}</b>}
                    </td>
                    {editable && (
                      <td>
                        <IconButton size="sm" label={tt('estimates.removeSection')} onClick={() => removeSection(s.key)}><Trash2 size={13} /></IconButton>
                      </td>
                    )}
                  </tr>
                  {rows.map((r, i) => renderRow(r, i + 1))}
                  {editable && (
                    <tr>
                      <td colSpan={colCount}>
                        <Button size="sm" variant="ghost" onClick={() => addRow(s.key)}><Plus size={13} />{tt('estimates.addItem')}</Button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {draft.rows.filter(r => !r.sectionKey).map((r, i) => renderRow(r, i + 1))}
            {editable && (
              <tr>
                <td colSpan={colCount}>
                  <div className="row" style={{ gap: 8 }}>
                    <Button size="sm" variant="ghost" onClick={() => addRow(null)}><Plus size={13} />{tt('estimates.addItem')}</Button>
                    <Button size="sm" variant="ghost" onClick={addSection}><Plus size={13} />{tt('estimates.addSection')}</Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="r"><b>{tt('estimates.total')}</b></td>
              <td />
              <td />
              <td />
              <td className="r num"><b>{fmtAmount(totals.revenue)}</b></td>
              {detail.canSeeCost && <td />}
              {detail.canSeeCost && <td className="r num"><b>{fmtAmount(totals.cost)}</b></td>}
              <td />
              <td className="r num"><b>{fmtHours(totals.hours)}</b></td>
              <td className="r num muted">{fmtAmount(factTotals.fact)}</td>
              <td className="r num">{fmtAmount(factTotals.remaining)}</td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="panel" style={{ padding: 12, minWidth: 180 }}>
          <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.totals.revenue')}</div>
          <div className="num" style={{ fontSize: 18 }}>{fmtAmount(totals.revenue)}</div>
        </div>
        {detail.canSeeCost && (
          <div className="panel" style={{ padding: 12, minWidth: 180 }}>
            <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.totals.cost')}</div>
            <div className="num" style={{ fontSize: 18 }}>{fmtAmount(totals.cost)}</div>
          </div>
        )}
        <div className="panel" style={{ padding: 12, minWidth: 140 }}>
          <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.totals.hours')}</div>
          <div className="num" style={{ fontSize: 18 }}>{fmtHours(totals.hours)}</div>
        </div>
        {detail.canSeeCost && (
          <div className="panel" style={{ padding: 12, minWidth: 180 }}>
            <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.totals.margin')}</div>
            <div className="num" style={{ fontSize: 18 }}>
              {fmtAmount(totals.margin)}
              {totals.marginPct != null && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{fmtNumber(totals.marginPct)}%</span>}
            </div>
          </div>
        )}
        <div className="panel" style={{ padding: 12, minWidth: 220 }}>
          <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.planFact')}</div>
          <div className="row" style={{ gap: 12 }}>
            <span>{tt('estimates.totals.plan')}: <b className="num">{fmtAmount(totals.revenue)}</b></span>
            <span className="muted">{tt('estimates.totals.fact')}: <b className="num">{fmtAmount(factTotals.fact)}</b></span>
            <span>{tt('estimates.totals.remaining')}: <b className="num">{fmtAmount(factTotals.remaining)}</b></span>
          </div>
          <div className="faint" style={{ fontSize: 11 }}>{tt('estimates.planFactHint')}</div>
        </div>
      </div>

      {dialog === 'import' && <ImportDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {dialog === 'supplier' && <SupplierOrderDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {dialog === 'production' && <ProductionOrderDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <ConfirmDialog
          open
          danger
          title={tt('estimates.deleteTitle')}
          description={tt('estimates.deleteHint')}
          confirmLabel={tt('estimates.delete')}
          cancelLabel={tt('common.cancel')}
          onOpenChange={open => !open && setDialog(null)}
          onConfirm={() => void run(async () => {
            await api.remove(detail.id);
            setDialog(null);
          })}
        />
      )}
    </div>
  );
}

/* ---------------- изделие производства ---------------- */

function ManufacturedPicker({ value, onChange, ariaLabel }: { value: string | null; onChange: (id: string | null, name: string) => void; ariaLabel: string }) {
  const ws = useWsId();
  const [items, setItems] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await call<{ items: { id: string; name: string; archivedAt: string | null }[] }>(ws, 'GET', '/manufactured-items?limit=200');
      if (alive) setItems(r.items.filter(i => !i.archivedAt).map(i => ({ id: i.id, name: i.name })));
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ws]);
  return (
    <Select
      aria-label={ariaLabel}
      value={value ?? ''}
      onValueChange={v => {
        const found = items.find(i => i.id === v);
        onChange(v || null, found?.name ?? '');
      }}
      options={[{ value: '', label: '—' }, ...items.map(i => ({ value: i.id, label: i.name }))]}
    />
  );
}

/* ---------------- импорт из таблицы ---------------- */

const IMPORT_FIELDS = ['section', 'kind', 'name', 'unit', 'qty', 'price', 'costPrice', 'laborHours'] as const;
type ImportField = (typeof IMPORT_FIELDS)[number];

const IMPORT_HINTS: Record<ImportField, string[]> = {
  section: ['раздел', 'section', 'группа', 'group'],
  kind: ['вид', 'kind', 'тип', 'type'],
  name: ['наименование', 'name', 'позиция', 'работа', 'description'],
  unit: ['ед', 'ед.', 'единица', 'unit', 'океи'],
  qty: ['кол', 'кол-во', 'количество', 'qty', 'quantity'],
  price: ['цена', 'price', 'стоимость заказчику', 'сумма'],
  costPrice: ['себестоимость', 'cost', 'плановая стоимость', 'cost price'],
  laborHours: ['часы', 'норма часов', 'нормочас', 'hours', 'labor'],
};

const IMPORT_FIELD_LABEL: Record<ImportField, TKey> = {
  section: 'estimates.section',
  kind: 'estimates.columns.kind',
  name: 'estimates.columns.name',
  unit: 'estimates.columns.unit',
  qty: 'estimates.columns.qty',
  price: 'estimates.columns.price',
  costPrice: 'estimates.columns.costPrice',
  laborHours: 'estimates.columns.hoursPerUnit',
};

/** Сопоставление колонок по заголовку: точное или по вхождению подсказки */
function guessColumn(header: string[], field: ImportField): number | '' {
  const hints = IMPORT_HINTS[field];
  const lower = header.map(h => h.trim().toLowerCase());
  const exact = lower.findIndex(h => hints.includes(h));
  if (exact >= 0) return exact;
  const part = lower.findIndex(h => h && hints.some(x => h.includes(x) || x.includes(h)));
  return part >= 0 ? part : '';
}

function ImportDialog({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const [preview, setPreview] = React.useState<{ header: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = React.useState<Record<ImportField, number | ''>>({ section: '', kind: '', name: '', unit: '', qty: '', price: '', costPrice: '', laborHours: '' });
  const pick = (f: File | null) =>
    void run(async () => {
      if (!f) return;
      const p = await api.importPreview(f);
      setPreview(p);
      setMap(Object.fromEntries(IMPORT_FIELDS.map(field => [field, guessColumn(p.header, field)])) as Record<ImportField, number | ''>);
    });
  const cell = (row: string[], field: ImportField) => {
    const c = map[field];
    return c === '' ? '' : (row[c] ?? '');
  };
  const rows: EstimateImportRow[] = React.useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .map(row => {
        const kindText = cell(row, 'kind').trim().toLowerCase();
        const kind = (ESTIMATE_ITEM_KINDS as readonly string[]).find(k => k === kindText || tt(KIND_LABEL[k as EstimateItemKind]).toLowerCase() === kindText) as EstimateItemKind | undefined;
        return {
          section: cell(row, 'section').trim() || undefined,
          kind,
          name: cell(row, 'name').trim(),
          unit: cell(row, 'unit').trim() || undefined,
          qty: num(cell(row, 'qty')) || '0',
          price: num(cell(row, 'price')) || '0',
          costPrice: num(cell(row, 'costPrice')) || undefined,
          laborHours: num(cell(row, 'laborHours')) || undefined,
        };
      })
      .filter(r => r.name);
  }, [preview, map, tt]);
  const ready = map.name !== '' && map.qty !== '' && map.price !== '';
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={tt('estimates.importTitle')}
        description={tt('estimates.importHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy || !ready || !rows.length} onClick={() => void run(async () => {
              await api.importRows(estimateId, rows);
              toast(tt('estimates.importDone', { count: rows.length }), { duration: 2000 });
              onClose();
            })}>{tt('estimates.importApply')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('estimates.importFile')}>
            {p => <input id={p.id} type="file" accept=".xlsx,.csv,text/csv" aria-label={tt('estimates.importFile')} onChange={e => pick(e.target.files?.[0] ?? null)} />}
          </Field>
          {preview && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {IMPORT_FIELDS.map(field => (
                  <Field key={field} label={`${tt(IMPORT_FIELD_LABEL[field])} (${tt(`estimates.importColumn`).toLowerCase()} ${field})`}>
                    {p => (
                      <Select
                        id={p.id}
                        value={map[field] === '' ? '' : String(map[field])}
                        onValueChange={v => setMap(m => ({ ...m, [field]: v === '' ? '' : Number(v) }))}
                        options={[{ value: '', label: tt('estimates.importNone') }, ...preview.header.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h || '—'}` }))]}
                      />
                    )}
                  </Field>
                ))}
              </div>
              {!ready && <p className="faint">{tt('estimates.importRequired')}</p>}
              <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
                <table className="dtbl" aria-label={tt('estimates.importPreview')}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>{tt('estimates.columns.name')}</th>
                      <th style={{ width: 90 }} className="r">{tt('estimates.columns.qty')}</th>
                      <th style={{ width: 110 }} className="r">{tt('estimates.columns.price')}</th>
                      {map.costPrice !== '' && <th style={{ width: 110 }} className="r">{tt('estimates.columns.costPrice')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={i}>
                        <td className="faint num">{i + 1}</td>
                        <td>{r.section ? <span className="muted">{r.section} · </span> : null}{r.name}</td>
                        <td className="r num">{fmtNumber(r.qty)}</td>
                        <td className="r num">{fmtAmount(r.price)}</td>
                        {map.costPrice !== '' && <td className="r num">{r.costPrice ? fmtAmount(r.costPrice) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint">{tt('estimates.importRows', { count: rows.length })}</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- заказы из сметы ---------------- */

function SupplierOrderDialog({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const companies = useCompanies();
  const [supplierId, setSupplierId] = React.useState('');
  const [comment, setComment] = React.useState('');
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('estimates.supplierTitle')}
        description={tt('estimates.supplierHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy || !supplierId} onClick={() => void run(async () => {
              await api.supplierOrder(estimateId, { supplierId, ...(comment.trim() ? { comment: comment.trim() } : {}) });
              toast(tt('estimates.orderCreated'), { duration: 2000 });
              onClose();
            })}>{tt('estimates.createOrder')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('estimates.supplier')}>
            {p => <Select id={p.id} value={supplierId} onValueChange={setSupplierId} placeholder={tt('objects.field.none')} options={(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))} />}
          </Field>
          <Field label={tt('estimates.comment')}>{p => <Input {...p} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductionOrderDialog({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const [comment, setComment] = React.useState('');
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('estimates.productionTitle')}
        description={tt('estimates.productionHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
              await api.productionOrder(estimateId, comment.trim() ? { comment: comment.trim() } : {});
              toast(tt('estimates.orderCreated'), { duration: 2000 });
              onClose();
            })}>{tt('estimates.createOrder')}</Button>
          </>
        }
      >
        <Field label={tt('estimates.comment')}>{p => <Input {...p} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- копирование сметы ---------------- */

function CopyDialog({ objectId, onClose, onDone }: { objectId: string; onClose: () => void; onDone: (id: string) => void }) {
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const objects = useObjectOptions();
  const [sourceObject, setSourceObject] = React.useState('');
  const [sourceEstimate, setSourceEstimate] = React.useState('');
  const list = useObjectEstimates(sourceObject || undefined);
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('estimates.copyTitle')}
        description={tt('estimates.copyHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy || !sourceEstimate} onClick={() => void run(async () => {
              const created = await api.copyFrom(objectId, { estimateId: sourceEstimate });
              onDone(created.id);
            })}>{tt('estimates.copyAction')}</Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label={tt('estimates.copyObject')}>
            {p => (
              <Select
                id={p.id}
                value={sourceObject}
                onValueChange={v => {
                  setSourceObject(v);
                  setSourceEstimate('');
                }}
                options={(objects.data ?? []).filter(o => o.id !== objectId).map(o => ({ value: o.id, label: `${o.number} · ${o.name}` }))}
              />
            )}
          </Field>
          <Field label={tt('estimates.copyEstimate')}>
            {p => (
              <Select
                id={p.id}
                value={sourceEstimate}
                disabled={!sourceObject}
                onValueChange={setSourceEstimate}
                options={(list.data ?? []).map(e => ({ value: e.id, label: `${e.number} · ${e.name} (${e.itemCount})` }))}
              />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
