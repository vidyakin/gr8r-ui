/* Форма документа: шапка (организация, контрагент, склад, дата, номер, способ указания НДС), табличная часть с подбором из каталога,
   итоги и НДС внизу, кнопки Post / Unpost / Create based on / Print. Черновик сохраняется сам (через паузу после правки); суммы строк и итоги
   считает та же функция, что и сервер при проведении (computeDocument). Проведённый документ только читается — его сначала снимают с проведения. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CircleAlert, ChevronDown, Copy, Ellipsis, FileText, Plus, Printer, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react';
import { amountInWordsRu, basedOnTargets, computeDocument, DOCUMENT_META, PRINT_FORM_LABELS, VAT_LABELS, VAT_RATES, type DocumentType, type VatRate } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { money, unitSymbol, useIsAdmin, useUnits, type Product } from '../catalog/data';
import { uuidv7 } from '../lib/uuid';
import { fmtDate } from '../lib/dates';
import { STATUS_LABEL, STATUS_TONE, docTitle, docsKey, typeLabel, useCostItems, useDocsApi, useDocument, useOrganizations, useWarehouses, type DocDetail, type DocLink } from './data';
import { CounterpartyPicker, ProductPicker } from './pickers';
import { useWsId } from '../meta/data';

interface FormLine {
  key: string;
  productId: string | null;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  discountPct: string;
  vatRate: VatRate;
}

interface Form {
  organizationId: string;
  counterpartyId: string | null;
  counterpartyName: string;
  warehouseId: string | null;
  targetWarehouseId: string | null;
  costItemId: string | null;
  date: string;
  dueDate: string;
  priceIncludesVat: boolean;
  comment: string;
  lines: FormLine[];
}

const trimNum = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** Адрес журнала группы: продажи, закупки или складские документы */
const groupPath = (g: string) => (g === 'sales' ? '/sales' : g === 'purchases' ? '/purchases' : g === 'production' ? '/production/orders' : '/stock-docs');
const groupLabel = (g: string) => (g === 'sales' ? 'Sales' : g === 'purchases' ? 'Purchases' : g === 'production' ? 'Production orders' : 'Stock documents');

function toForm(d: DocDetail): Form {
  return {
    organizationId: d.organizationId,
    counterpartyId: d.counterpartyId,
    counterpartyName: d.counterparty?.name ?? '',
    warehouseId: d.warehouseId,
    targetWarehouseId: d.targetWarehouseId,
    costItemId: d.costItemId,
    date: d.date,
    dueDate: d.dueDate ?? '',
    priceIncludesVat: d.priceIncludesVat,
    comment: d.comment,
    lines: d.lines.map(l => ({ key: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: trimNum(l.qty), price: l.price, discountPct: trimNum(l.discountPct), vatRate: l.vatRate })),
  };
}

const isNum = (s: string) => s.trim() !== '' && /^\d+([.,]\d+)?$/.test(s.trim());
const num = (s: string) => s.trim().replace(',', '.');
const lineErrors = (l: FormLine): { qty?: boolean; price?: boolean; discountPct?: boolean } => ({
  qty: !(isNum(l.qty) && Number(num(l.qty)) > 0) || undefined,
  price: !isNum(l.price) || undefined,
  discountPct: !(l.discountPct.trim() === '' || (isNum(l.discountPct) && Number(num(l.discountPct)) <= 100)) || undefined,
});
const lineOk = (l: FormLine) => !Object.values(lineErrors(l)).some(Boolean);

function toPayload(f: Form) {
  return {
    organizationId: f.organizationId,
    counterpartyId: f.counterpartyId,
    warehouseId: f.warehouseId,
    targetWarehouseId: f.targetWarehouseId,
    costItemId: f.costItemId,
    date: f.date,
    dueDate: f.dueDate || null,
    priceIncludesVat: f.priceIncludesVat,
    comment: f.comment,
    lines: f.lines.filter(l => l.productId).map(l => ({ id: l.key, productId: l.productId!, name: l.name, unitCode: l.unitCode, qty: num(l.qty), price: num(l.price), discountPct: num(l.discountPct || '0'), vatRate: l.vatRate })),
  };
}

export function DocumentPage() {
  const { id } = useParams();
  const q = useDocument(id);
  if (q.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={260} h={24} />
        </div>
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title="Document not found" action={<Link to="/sales" className="btn btn-secondary">Back to Sales</Link>}>
          This document does not exist or belongs to another workspace.
        </EmptyState>
      </div>
    );
  return <DocumentView key={q.data.id} doc={q.data} />;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'invalid' | 'error';

function DocumentView({ doc }: { doc: DocDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = useWsId();
  const rawApi = useDocsApi();
  /** Ответ сервера (карточка документа) сразу попадает в кэш: форма видит новый статус и номер без ожидания повторного запроса */
  const api = React.useCallback(
    async <T,>(method: string, path: string, json?: unknown, opts?: { quiet?: boolean }) => {
      const r = await rawApi<T>(method, path, json, opts);
      if (r && method !== 'DELETE' && (r as { id?: string }).id === doc.id && Array.isArray((r as { lines?: unknown }).lines)) qc.setQueryData(docsKey(ws, 'doc', doc.id), r);
      return r;
    },
    [rawApi, qc, ws, doc.id],
  );
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const orgs = useOrganizations();
  const warehouses = useWarehouses();
  const costItems = useCostItems();
  const units = useUnits();
  const meta = DOCUMENT_META[doc.type];
  const editable = canWrite && doc.status === 'draft';
  /** Внутренний документ: без контрагента, свой склад и статья затрат */
  const internal = meta.party === null;
  const usesWarehouse = !!meta.stock || !!meta.stockRole || meta.production || doc.type === 'customer_order';
  const isOrder = !!meta.isOrder;
  const priceField = meta.party === 'supplier' ? 'purchasePrice' : 'price';
  const whOptions = (warehouses.data ?? []).filter(w => (!w.archivedAt || w.id === form.warehouseId) && w.kind !== 'transit');

  const [form, setForm] = React.useState<Form>(() => toForm(doc));
  const [save, setSave] = React.useState<SaveState>('saved');
  const [confirm, setConfirm] = React.useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const latest = React.useRef(form);
  latest.current = form;
  const dirty = React.useRef(false);
  const version = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusReq = React.useRef<{ row: number; col: number } | null>(null);

  // проведение, отмена проведения и отмена документа заменяют форму данными сервера; правки черновика остаются у пользователя
  React.useEffect(() => {
    setForm(toForm(doc));
    dirty.current = false;
    setSave('saved');
  }, [doc.status, doc.numberSeq]);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const flush = React.useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (!dirty.current) return true;
    const f = latest.current;
    if (!f.organizationId || f.lines.some(l => l.productId && !lineOk(l))) {
      setSave('invalid');
      return false;
    }
    const v = version.current;
    setSave('saving');
    const r = await api<DocDetail>('PATCH', `/documents/${doc.id}`, toPayload(f), { quiet: true });
    if (!r) {
      setSave('error');
      toast.error('Could not save the document. Check the highlighted fields and try again');
      return false;
    }
    if (version.current === v) {
      dirty.current = false;
      setSave('saved');
    }
    return true;
  }, [api, doc.id]);

  const edit = (fn: (f: Form) => Form) => {
    setForm(f => fn(f));
    dirty.current = true;
    version.current++;
    setSave('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  };
  const patchLine = (key: string, patch: Partial<FormLine>) => edit(f => ({ ...f, lines: f.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = (at?: number) => {
    const line: FormLine = { key: uuidv7(), productId: null, name: '', unitCode: '796', qty: '1', price: '', discountPct: '', vatRate: '20' };
    const index = at ?? latest.current.lines.length;
    focusReq.current = { row: index, col: 0 };
    edit(f => ({ ...f, lines: [...f.lines.slice(0, index), line, ...f.lines.slice(index)] }));
  };
  const pickProduct = (key: string, row: number, p: Product) => {
    // у внутренних документов цена — себестоимость: её подставляет сервер
    patchLine(key, { productId: p.id, name: p.name, unitCode: p.unitCode, vatRate: p.vatRate, price: internal ? '0' : trimNum(p[priceField]) || '0', qty: latest.current.lines.find(l => l.key === key)?.qty || '1' });
    focusReq.current = { row, col: 1 };
  };

  // фокус на ячейку после добавления строки или выбора товара
  React.useEffect(() => {
    const r = focusReq.current;
    if (!r) return;
    focusReq.current = null;
    document.querySelector<HTMLInputElement>(`[data-cell="${r.row}:${r.col}"]`)?.focus();
  });

  const cellKey = (row: number, col: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    const to = (r: number, c: number) => document.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`);
    const rows = latest.current.lines.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const target = to(row + (e.key === 'ArrowDown' ? 1 : -1), col);
      if (target) (e.preventDefault(), target.focus());
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (col === 0) to(row, 1)?.focus();
      else if (row + 1 < rows) to(row + 1, col)?.focus();
      else addLine();
    } else if (e.key === 'Insert') {
      e.preventDefault();
      addLine(row + 1);
    }
  };

  const calc = React.useMemo(() => {
    const valid = form.lines.filter(l => l.productId && lineOk(l));
    try {
      const r = computeDocument(valid.map(l => ({ qty: num(l.qty), price: num(l.price), discountPct: num(l.discountPct || '0'), vatRate: l.vatRate })), form.priceIncludesVat);
      return { byKey: new Map(valid.map((l, i) => [l.key, r.lines[i]!])), totals: r.totals };
    } catch {
      return { byKey: new Map(), totals: { net: '0.00', vat: '0.00', total: '0.00', byRate: [] as { rate: string; net: string; vat: string; total: string }[] } };
    }
  }, [form.lines, form.priceIncludesVat]);
  const serverLine = new Map(doc.lines.map(l => [l.id, l]));

  const run = async (action: 'post' | 'unpost' | 'restore' | 'cancel') => {
    setBusy(true);
    try {
      if (action === 'post' && !(await flush())) return;
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/${action}`);
      if (r) toast(action === 'post' ? `Posted${r.number ? ` ${r.number}` : ''}` : action === 'unpost' ? 'Unposted: the document is a draft again' : action === 'cancel' ? 'Document cancelled' : 'Document restored');
    } finally {
      setBusy(false);
    }
  };
  const createBasedOn = async (type: DocumentType) => {
    if (!(await flush())) return;
    const r = await api<DocDetail>('POST', `/documents/${doc.id}/based-on`, { type });
    if (r) {
      toast(`Created ${typeLabel(type).toLowerCase()} from ${doc.number ?? 'draft'}`);
      navigate(`/documents/${r.id}`);
    }
  };
  const remove = async () => {
    const r = await api('DELETE', `/documents/${doc.id}`);
    if (r) {
      toast('Draft deleted');
      navigate(groupPath(meta.group));
    }
  };

  const targets = basedOnTargets(doc.type);
  const lineCount = form.lines.filter(l => l.productId).length;
  const hasNumber = doc.numberSeq !== null;
  const noVatOnly = calc.totals.byRate.length > 0 && calc.totals.byRate.every(r => r.rate === 'none');

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }} aria-label="Document type">
            <Link to={groupPath(meta.group)} className="crm-link">
              {groupLabel(meta.group)}
            </Link>
            {' / '}
            <Link to={`${groupPath(meta.group)}?type=${doc.type}`} className="crm-link">
              {typeLabel(doc.type)}
            </Link>
          </nav>
          <h1>
            {typeLabel(doc.type)} {doc.number ?? <span className="faint">draft</span>}
            <Badge tone={STATUS_TONE[doc.status]} dot>
              {STATUS_LABEL[doc.status]}
            </Badge>
          </h1>
          <span className="faint" style={{ fontSize: 12 }} aria-live="polite" data-testid="save-state">
            {doc.status !== 'draft' ? (doc.postedAt ? `Posted ${fmtDate(new Date(doc.postedAt))}` : '') : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : save === 'invalid' ? 'Fix the highlighted fields to save' : save === 'error' ? 'Not saved' : 'All changes saved'}
          </span>
        </div>
        <div className="doc-actions">
          {canWrite && doc.status === 'draft' && (
            <Button variant="primary" disabled={busy} onClick={() => void run('post')}>
              <Send size={14} />
              Post
            </Button>
          )}
          {canWrite && doc.status === 'posted' && (
            <Button disabled={busy} onClick={() => void run('unpost')}>
              <Undo2 size={14} />
              Unpost
            </Button>
          )}
          {canWrite && doc.status === 'cancelled' && (
            <Button disabled={busy} onClick={() => void run('restore')}>
              <RotateCcw size={14} />
              Restore
            </Button>
          )}
          {canWrite && !!targets.length && doc.status !== 'cancelled' && (
            <Menu>
              <MenuTrigger asChild>
                <Button>
                  <Copy size={14} />
                  Create based on
                  <ChevronDown size={12} />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                {targets.map(t => (
                  <MenuItem key={t} icon={<FileText size={15} />} onSelect={() => void createBasedOn(t)}>
                    {typeLabel(t)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          {!!meta.forms.length && (
            <Menu>
              <MenuTrigger asChild>
                <Button>
                  <Printer size={14} />
                  Print
                  <ChevronDown size={12} />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                {meta.forms.map(f => (
                  <MenuItem
                    key={f}
                    icon={<Printer size={15} />}
                    onSelect={async () => {
                      if (await flush()) navigate(`/documents/${doc.id}/print/${f}`);
                    }}
                  >
                    {PRINT_FORM_LABELS[f]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          {canWrite && doc.status !== 'posted' && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="More actions">
                  <Ellipsis size={16} />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                {doc.status === 'draft' && (
                  <MenuItem icon={<Ban size={15} />} onSelect={() => setConfirm('cancel')}>
                    Cancel document
                  </MenuItem>
                )}
                {doc.status === 'draft' && !hasNumber && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirm('delete')}>
                      Delete draft
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>

      <section className="doc-head panel" aria-label="Document header">
        <Field label="Organization">
          {p => (
            <Select
              id={p.id}
              disabled={!editable || hasNumber}
              value={form.organizationId}
              onValueChange={v => edit(f => ({ ...f, organizationId: v }))}
              options={(orgs.data ?? []).filter(o => !o.archivedAt || o.id === form.organizationId).map(o => ({ value: o.id, label: o.name }))}
              aria-label="Organization"
            />
          )}
        </Field>
        {!internal && (
          <Field label={meta.party === 'customer' ? 'Customer' : 'Supplier'}>
            {p =>
              editable ? (
                <CounterpartyPicker id={p.id} value={form.counterpartyName} invalid={save === 'invalid' && !form.counterpartyId} onPick={c => edit(f => ({ ...f, counterpartyId: c.id, counterpartyName: c.name }))} />
              ) : (
                <div className="doc-ro">{doc.counterparty ? <Link className="crm-link" to={`/crm/companies/${doc.counterparty.id}`}>{doc.counterparty.name}</Link> : '—'}</div>
              )
            }
          </Field>
        )}
        {usesWarehouse && (
          <Field label={internal ? (meta.production ? 'Materials warehouse' : 'From warehouse') : 'Warehouse'}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.warehouseId ?? ''}
                onValueChange={v => edit(f => ({ ...f, warehouseId: v }))}
                options={whOptions.map(w => ({ value: w.id, label: w.name }))}
                placeholder="Select warehouse"
                aria-label="Warehouse"
              />
            )}
          </Field>
        )}
        {(meta.stockRole === 'transfer' || meta.production) && (
          <Field label={meta.production ? 'Finished goods warehouse' : 'To warehouse'}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.targetWarehouseId ?? ''}
                onValueChange={v => edit(f => ({ ...f, targetWarehouseId: v }))}
                options={whOptions.filter(w => w.id !== form.warehouseId).map(w => ({ value: w.id, label: w.name }))}
                placeholder="Select warehouse"
                aria-label="Target warehouse"
              />
            )}
          </Field>
        )}
        {meta.costItemKind && (
          <Field label={meta.costItemKind === 'expense' ? 'Cost item' : 'Income item'} hint="Written off to this item">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.costItemId ?? ''}
                onValueChange={v => edit(f => ({ ...f, costItemId: v }))}
                options={(costItems.data ?? [])
                  .filter(c => !c.archivedAt && c.kind === meta.costItemKind)
                  .map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select item"
                aria-label="Cost item"
              />
            )}
          </Field>
        )}
        <Field label="Date">{p => <Input {...p} type="date" disabled={!editable} value={form.date} onChange={e => edit(f => ({ ...f, date: e.target.value }))} />}</Field>
        {(doc.type === 'invoice' || doc.type === 'quote' || doc.type === 'customer_order') && (
          <Field label={doc.type === 'quote' ? 'Valid until' : doc.type === 'invoice' ? 'Pay by' : 'Due date'}>
            {p => <Input {...p} type="date" disabled={!editable} value={form.dueDate} onChange={e => edit(f => ({ ...f, dueDate: e.target.value }))} />}
          </Field>
        )}
        <Field label="Number" hint={hasNumber ? undefined : 'Assigned when the document is posted'}>
          {p => <Input {...p} readOnly value={doc.number ?? ''} placeholder="—" className="mono" />}
        </Field>
        {!internal && (
          <Field label="Prices">
            {() => (
              <Segmented
                aria-label="Price type"
                value={form.priceIncludesVat ? 'incl' : 'excl'}
                onValueChange={v => editable && edit(f => ({ ...f, priceIncludesVat: v === 'incl' }))}
                items={[
                  { value: 'incl', label: 'VAT included' },
                  { value: 'excl', label: 'VAT on top' },
                ]}
              />
            )}
          </Field>
        )}
        <Field label="Comment" className="doc-wide">
          {p => <Input {...p} disabled={!editable} value={form.comment} placeholder="Internal note or payment terms" onChange={e => edit(f => ({ ...f, comment: e.target.value }))} />}
        </Field>
      </section>

      <section className="doc-lines panel" aria-label="Lines">
        <div className="table-wrap">
          <table className="dtbl" aria-label="Document lines">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>Product or service</th>
                <th style={{ width: 56 }}>Unit</th>
                <th style={{ width: 96 }} className="r">
                  Qty
                </th>
                {isOrder && doc.status !== 'draft' && (
                  <>
                    <th style={{ width: 84 }} className="r">
                      {doc.type === 'customer_order' ? 'Shipped' : 'Received'}
                    </th>
                    <th style={{ width: 84 }} className="r">
                      Remaining
                    </th>
                  </>
                )}
                {meta.production && (
                  <th style={{ width: 96 }}>Role</th>
                )}
                <th style={{ width: 112 }} className="r">
                  {internal ? 'Cost' : 'Price'}
                </th>
                {!internal && (
                  <>
                    <th style={{ width: 72 }} className="r">
                      Disc. %
                    </th>
                    <th style={{ width: 84 }}>VAT</th>
                    <th style={{ width: 104 }} className="r">
                      VAT amount
                    </th>
                  </>
                )}
                <th style={{ width: 120 }} className="r">
                  {internal ? 'Amount' : 'Total'}
                </th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => {
                const a = calc.byKey.get(l.key);
                const err = l.productId ? lineErrors(l) : {};
                const srv = serverLine.get(l.key);
                const shipped = Number(srv?.shipped ?? 0);
                return (
                  <tr key={l.key} data-row={i}>
                    <td className="faint num">{i + 1}</td>
                    <td>
                      {editable ? (
                        <ProductPicker value={l.name} dataCell={`${i}:0`} price={priceField} onKeyDown={cellKey(i, 0)} onPick={p => pickProduct(l.key, i, p)} invalid={save === 'invalid' && !l.productId} />
                      ) : (
                        <span className="trunc" title={l.name}>
                          {l.name} {srv?.sku && <span className="mono faint" style={{ fontSize: 11 }}>{srv.sku}</span>}
                        </span>
                      )}
                    </td>
                    <td className="muted">{unitSymbol(units.data, l.unitCode)}</td>
                    <td className="r">
                      <NumCell value={l.qty} disabled={!editable} invalid={!!err.qty} label="Quantity" cell={`${i}:1`} onKeyDown={cellKey(i, 1)} onChange={v => patchLine(l.key, { qty: v })} />
                    </td>
                    {isOrder && doc.status !== 'draft' && (
                      <>
                        <td className="r num muted">{trimNum(srv?.shipped ?? '0') || '0'}</td>
                        <td className="r num">{trimNum(String(Math.max(0, Number(l.qty) - shipped).toFixed(3))) || '0'}</td>
                      </>
                    )}
                    {meta.production && (
                      <td>
                        <span className="muted">{srv?.stockRole === 'in' ? 'Product' : 'Material'}</span>
                      </td>
                    )}
                    <td className="r">
                      <NumCell
                        value={l.price}
                        disabled={!editable || (doc.type === 'stock_posting' && !isAdmin)}
                        invalid={!!err.price}
                        label={internal ? 'Cost' : 'Price'}
                        cell={`${i}:2`}
                        onKeyDown={cellKey(i, 2)}
                        onChange={v => patchLine(l.key, { price: v })}
                      />
                    </td>
                    {!internal && (
                      <>
                        <td className="r">
                          <NumCell value={l.discountPct} disabled={!editable} invalid={!!err.discountPct} label="Discount percent" cell={`${i}:3`} onKeyDown={cellKey(i, 3)} onChange={v => patchLine(l.key, { discountPct: v })} />
                        </td>
                        <td>
                          <select className="input cell-input" aria-label="VAT rate" disabled={!editable} value={l.vatRate} onChange={e => patchLine(l.key, { vatRate: e.target.value as VatRate })}>
                            {VAT_RATES.map(r => (
                              <option key={r} value={r}>
                                {VAT_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="r num muted">{a ? money(a.vatAmount) : '—'}</td>
                      </>
                    )}
                    <td className="r num" style={{ fontWeight: 500 }}>
                      {a ? money(a.total) : '—'}
                    </td>
                    <td>
                      {editable && (
                        <IconButton size="xs" label="Remove line" onClick={() => edit(f => ({ ...f, lines: f.lines.filter(x => x.key !== l.key) }))}>
                          <Trash2 size={13} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!form.lines.length && (
                <tr>
                  <td colSpan={12} className="faint" style={{ textAlign: 'center', padding: 22 }}>
                    No lines yet.{editable ? ' Add the first product or service.' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="doc-add">
            <Button size="sm" variant="ghost" onClick={() => addLine()}>
              <Plus size={13} />
              Add line
            </Button>
            <span className="faint" style={{ fontSize: 12 }}>
              ↑ ↓ move between rows · Enter next row · Insert new line
            </span>
          </div>
        )}
      </section>

      <div className="doc-bottom">
        <section className="doc-links panel" aria-label="Related documents">
          <h2>Related documents</h2>
          {doc.basedOn ? (
            <p>
              <span className="muted">Based on </span>
              <DocRef d={doc.basedOn} />
            </p>
          ) : (
            <p className="faint">Not created from another document</p>
          )}
          {doc.children.length ? (
            <ul>
              {doc.children.map(c => (
                <li key={c.id}>
                  <DocRef d={c} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint">Nothing created from this document yet</p>
          )}
        </section>
        <section className="doc-totals panel" aria-label="Totals">
          {internal ? (
            <dl>
              <div>
                <dt>Lines</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div className="grand">
                <dt>Cost at average price</dt>
                <dd className="num" data-testid="total-sum">
                  {doc.costTotal === null || doc.costTotal === undefined ? '—' : money(doc.costTotal)}
                </dd>
              </div>
            </dl>
          ) : (
            <dl>
              <div>
                <dt>Lines</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div>
                <dt>Amount without VAT</dt>
                <dd className="num" data-testid="total-net">
                  {money(calc.totals.net)}
                </dd>
              </div>
              {noVatOnly ? (
                <div>
                  <dt>VAT</dt>
                  <dd className="num">No VAT</dd>
                </div>
              ) : (
                calc.totals.byRate
                  .filter(r => r.rate !== 'none')
                  .map(r => (
                    <div key={r.rate}>
                      <dt>VAT {VAT_LABELS[r.rate as VatRate]}</dt>
                      <dd className="num">{money(r.vat)}</dd>
                    </div>
                  ))
              )}
              <div className="grand">
                <dt>Total{form.priceIncludesVat ? ' (VAT included)' : ''}</dt>
                <dd className="num" data-testid="total-sum">
                  {money(calc.totals.total)} ₽
                </dd>
              </div>
            </dl>
          )}
          {!internal && (
            <p className="doc-words" lang="ru">
              {amountInWordsRu(calc.totals.total)}
            </p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={o => !o && setConfirm(null)}
        title="Cancel this document?"
        description={hasNumber ? `${docTitle(doc)} keeps its number. You can restore it later.` : 'You can restore it later.'}
        confirmLabel="Cancel document"
        cancelLabel="Keep"
        danger
        onConfirm={() => void run('cancel')}
      />
      <ConfirmDialog open={confirm === 'delete'} onOpenChange={o => !o && setConfirm(null)} title="Delete this draft?" description="The draft has never been posted and has no number, so it is removed completely." confirmLabel="Delete" cancelLabel="Keep" danger onConfirm={() => void remove()} />
    </div>
  );
}

function NumCell({ value, onChange, disabled, invalid, label, cell, onKeyDown }: { value: string; onChange: (v: string) => void; disabled: boolean; invalid: boolean; label: string; cell: string; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <input
      className={`input cell-input r${invalid ? ' is-error' : ''}`}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-cell={cell}
      disabled={disabled}
      value={value}
      onFocus={e => e.currentTarget.select()}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export function DocRef({ d }: { d: DocLink }) {
  return (
    <span className="doc-ref">
      <Link className="crm-link" to={`/documents/${d.id}`}>
        {typeLabel(d.type)} {d.number ?? '(draft)'}
      </Link>
      <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
      {d.total !== undefined && <span className="num muted">{money(d.total)}</span>}
    </span>
  );
}
