/* Форма документа: шапка (организация, контрагент, склад, дата, номер, способ указания НДС), табличная часть с подбором из каталога,
   итоги и НДС внизу, кнопки Post / Unpost / Create based on / Print. Черновик сохраняется сам (через паузу после правки); суммы строк и итоги
   считает та же функция, что и сервер при проведении (computeDocument). Проведённый документ только читается — его сначала снимают с проведения. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Calculator, ChevronDown, CircleAlert, ClipboardList, Copy, Ellipsis, FileSignature, FileText, PackageCheck, Plus, Printer, RotateCcw, Send, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { amountInWordsRu, basedOnTargets, computeDocument, DOCUMENT_META, MATERIAL_OWNER_LABELS, PRINT_FORM_LABELS, TOLLING_ROLE_LABELS, TOLLING_ROLES, TRANSFER_OPERATIONS, VAT_LABELS, VAT_RATES, type DocumentType, type TollingRole, type VatRate } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { money, unitSymbol, useIsAdmin, useUnits, type Product } from '../catalog/data';
import { uuidv7 } from '../lib/uuid';
import { fmtDate } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { useSnapshot } from '../production/data';
import { STATUS_LABEL, STATUS_TONE, docTitle, docsKey, typeLabel, useCostItems, useDocsApi, useDocument, useOrganizations, useProcessingOrders, useWarehouses, type DocDetail, type DocLink } from './data';
import { CalculationDialog, ParamsDialog } from './calculation';
import { CounterpartyPicker, ProductPicker } from './pickers';
import { useBillingBreakdown, useContracts } from './billing-data';
import { WorkOrderPanel } from './work-orders';
import { useWsId } from '../meta/data';

/** Виды перемещения между складами */
const OPERATION_LABEL: Record<string, string> = { transfer: 'Direct transfer', in_transit: 'In transit', to_operation: 'To operation', from_operation: 'From operation', assembly: 'Assembly', disassembly: 'Disassembly', processing: 'Processing' };

interface FormLine {
  key: string;
  productId: string | null;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  discountPct: string;
  vatRate: VatRate;
  /** Учётное количество по остаткам (инвентаризация) */
  bookQty: string;
  /** Принятое количество (перемещение «в пути») */
  receivedQty: string;
  /** Статья косвенных затрат строки-услуги поступления */
  costItemId: string | null;
  /** Участок строки-услуги поступления */
  workCenterId: string | null;
  /** Значения параметров спецификации изделия (замеры, цвет): по ним считается состав выпуска */
  params: Record<string, unknown>;
  /** Вкладка строки отчёта о переработке: продукция, использованное сырьё или отходы */
  tollingRole: TollingRole | null;
}

interface Form {
  organizationId: string;
  counterpartyId: string | null;
  counterpartyName: string;
  /** Договор документа */
  contractId: string | null;
  warehouseId: string | null;
  targetWarehouseId: string | null;
  costItemId: string | null;
  /** Участок списания: себестоимость уходит в косвенные затраты участка */
  workCenterId: string | null;
  /** Вид перемещения: сразу, «в пути», в эксплуатацию или обратно */
  operation: string;
  inUseMemberId: string | null;
  inUseWorkCenterId: string | null;
  /** Заказ на переработку (приём, отчёт о переработке, возврат) */
  tollingOrderId: string | null;
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
    contractId: d.contractId ?? null,
    warehouseId: d.warehouseId,
    targetWarehouseId: d.targetWarehouseId,
    costItemId: d.costItemId,
    workCenterId: d.workCenterId,
    operation: d.operation ?? 'transfer',
    inUseMemberId: d.inUseMember?.id ?? null,
    inUseWorkCenterId: d.inUseWorkCenter?.id ?? null,
    tollingOrderId: d.tollingOrderId ?? null,
    date: d.date,
    dueDate: d.dueDate ?? '',
    priceIncludesVat: d.priceIncludesVat,
    comment: d.comment,
    lines: d.lines.map(l => ({ key: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: trimNum(l.qty), price: l.price, discountPct: trimNum(l.discountPct), vatRate: l.vatRate, bookQty: trimNum(l.bookQty), receivedQty: trimNum(l.receivedQty), costItemId: l.costItemId, workCenterId: l.workCenterId, params: (l as { params?: Record<string, unknown> }).params ?? {}, tollingRole: l.tollingRole ?? null })),
  };
}

const isNum = (s: string) => s.trim() !== '' && /^\d+([.,]\d+)?$/.test(s.trim());
const num = (s: string) => s.trim().replace(',', '.');
/** Нулевое количество допустимо только у строки инвентаризации: там qty — фактическое */
const lineErrors = (l: FormLine, allowZero = false): { qty?: boolean; price?: boolean; discountPct?: boolean } => ({
  qty: !(isNum(l.qty) && (allowZero ? Number(num(l.qty)) >= 0 : Number(num(l.qty)) > 0)) || undefined,
  price: !isNum(l.price) || undefined,
  discountPct: !(l.discountPct.trim() === '' || (isNum(l.discountPct) && Number(num(l.discountPct)) <= 100)) || undefined,
});
const lineOk = (l: FormLine, allowZero = false) => !Object.values(lineErrors(l, allowZero)).some(Boolean);

function toPayload(f: Form) {
  return {
    organizationId: f.organizationId,
    counterpartyId: f.counterpartyId,
    contractId: f.contractId,
    warehouseId: f.warehouseId,
    targetWarehouseId: f.targetWarehouseId,
    costItemId: f.costItemId,
    workCenterId: f.workCenterId,
    operation: f.operation,
    inUseMemberId: f.inUseMemberId,
    inUseWorkCenterId: f.inUseWorkCenterId,
    tollingOrderId: f.tollingOrderId,
    date: f.date,
    dueDate: f.dueDate || null,
    priceIncludesVat: f.priceIncludesVat,
    comment: f.comment,
    lines: f.lines
      .filter(l => l.productId)
      .map(l => ({ id: l.key, productId: l.productId!, name: l.name, unitCode: l.unitCode, qty: num(l.qty), price: num(l.price), discountPct: num(l.discountPct || '0'), vatRate: l.vatRate, bookQty: num(l.bookQty || '0'), receivedQty: num(l.receivedQty || '0'), costItemId: l.costItemId, workCenterId: l.workCenterId, params: l.params ?? {}, tollingRole: l.tollingRole })),
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
  const contracts = useContracts({ companyId: doc.counterpartyId ?? undefined });
  const breakdown = useBillingBreakdown(doc.type === 'invoice' ? doc.id : undefined);
  const units = useUnits();
  const members = useWorkspace().data.members;
  const workCenters = useSnapshot().data?.workCenters ?? [];
  const processingOrders = useProcessingOrders();
  const meta = DOCUMENT_META[doc.type];
  /** Договоры контрагента: в документе выбирается один */
  const contractOptions = (contracts.data?.items ?? []).map(c => ({ value: c.id, label: c.number ? `${c.number}${c.isService ? ' · service' : ''}` : c.companyName }));
  const editable = canWrite && doc.status === 'draft';
  /** Внутренний документ: без контрагента, свой склад и статья затрат */
  const internal = meta.party === null;
  const usesWarehouse = !!meta.stock || !!meta.stockRole || meta.production || doc.type === 'customer_order';
  const isOrder = !!meta.isOrder;
  /** Инвентаризация: количество строки — фактическое, рядом учётное */
  const isCount = doc.type === 'inventory_count';
  /** Заказ-наряд: его проводит состояние «выполнен», а не кнопка Post */
  const isWorkOrder = doc.type === 'work_order';
  /** Перемещение: вид операции задаёт, что делает документ */
  const isTransfer = doc.type === 'stock_transfer';
  /** Выпуск с видом операции «разборка»: исходный товар списывается, выходные продукты приходуются */
  const disassembly = meta.production && doc.operation === 'disassembly';
  /** Переработка: приём, отчёт о переработке или возврат остатков давальцу */
  const isTolling = !!meta.tolling;
  /** Заказ на переработку: вид операции заказывает переработку давальческого сырья */
  const processingKind = ((doc.type === 'customer_order' || doc.type === 'supplier_order') && doc.operation === 'processing') || doc.type === 'tolling_report';
  /** У отчёта о переработке строки разделены по вкладкам: продукция, материалы, отходы */
  const defaultTollingRole: TollingRole = 'product';
  const inTransit = isTransfer && doc.operation === 'in_transit';
  const toOperation = isTransfer && doc.operation === 'to_operation';
  const fromOperation = isTransfer && doc.operation === 'from_operation';
  const priceField = meta.party === 'supplier' ? 'purchasePrice' : 'price';
  /** Поступление: у строк-услуг можно указать статью косвенных затрат и участок */
  const isReceipt = doc.type === 'receipt';
  const whOptions = (warehouses.data ?? []).filter(w => (!w.archivedAt || w.id === form.warehouseId) && w.kind !== 'transit');

  const [form, setForm] = React.useState<Form>(() => toForm(doc));
  /** Принятое количество по строкам (перемещение «в пути»): редактируется при приёмке */
  const [received, setReceived] = React.useState<Record<string, string>>(() => Object.fromEntries(doc.lines.map(l => [l.id, trimNum(l.receivedQty) || trimNum(l.qty)])));
  const [save, setSave] = React.useState<SaveState>('saved');
  const [confirm, setConfirm] = React.useState<'cancel' | 'delete' | null>(null);
  // параметры строки заказа и калькуляция заказа покупателя
  const [paramsLine, setParamsLine] = React.useState<string | null>(null);
  const [calcOpen, setCalcOpen] = React.useState(false);
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
    if (!f.organizationId || f.lines.some(l => l.productId && !lineOk(l, isCount))) {
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
    const line: FormLine = { key: uuidv7(), productId: null, name: '', unitCode: '796', qty: '1', price: '', discountPct: '', vatRate: '20', bookQty: '0', receivedQty: '0', costItemId: null, workCenterId: null, params: {}, tollingRole: defaultTollingRole };
    const index = at ?? latest.current.lines.length;
    focusReq.current = { row: index, col: 0 };
    edit(f => ({ ...f, lines: [...f.lines.slice(0, index), line, ...f.lines.slice(index)] }));
  };
  const pickProduct = (key: string, row: number, p: Product) => {
    // у внутренних документов цена — себестоимость: её подставляет сервер
    patchLine(key, { productId: p.id, name: p.name, unitCode: p.unitCode, vatRate: p.vatRate, price: internal ? '0' : trimNum(p[priceField]) || '0', qty: latest.current.lines.find(l => l.key === key)?.qty || '1', costItemId: p.kind === 'service' ? (latest.current.lines.find(l => l.key === key)?.costItemId ?? null) : null, workCenterId: p.kind === 'service' ? (latest.current.lines.find(l => l.key === key)?.workCenterId ?? null) : null });
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
    const valid = form.lines.filter(l => l.productId && lineOk(l, isCount));
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

  /** Заполнить строки инвентаризации по остаткам склада */
  const fillCount = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/fill-count-sheet`);
      if (r) toast('Lines filled by the stock balances');
    } finally {
      setBusy(false);
    }
  };
  /** Приёмка перемещения «в пути»: принимаемое количество по каждой строке */
  const receiveGoods = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/state`, { state: 'received', received: doc.lines.map(l => ({ id: l.id, qty: num(received[l.id] ?? l.qty) })) });
      if (r) toast('Goods accepted');
    } finally {
      setBusy(false);
    }
  };
  /** Отмена приёмки: товар остаётся «в пути» */
  const cancelReception = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/state`, { state: 'shipped' });
      if (r) toast('Acceptance cancelled: the goods stay in transit');
    } finally {
      setBusy(false);
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
            {doc.state && <Badge tone="violet">{meta.states?.find(s => s.key === doc.state)?.label ?? doc.state}</Badge>}
          </h1>
          <span className="faint" style={{ fontSize: 12 }} aria-live="polite" data-testid="save-state">
            {doc.status !== 'draft' ? (doc.postedAt ? `Posted ${fmtDate(new Date(doc.postedAt))}` : '') : save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : save === 'invalid' ? 'Fix the highlighted fields to save' : save === 'error' ? 'Not saved' : 'All changes saved'}
          </span>
        </div>
        <div className="doc-actions">
          {canWrite && isCount && doc.status === 'draft' && (
            <Button disabled={busy} onClick={() => void fillCount()}>
              <ClipboardList size={14} />
              Fill by stock
            </Button>
          )}
          {canWrite && inTransit && doc.status === 'posted' && doc.state === 'shipped' && (
            <Button variant="primary" disabled={busy} onClick={() => void receiveGoods()}>
              <PackageCheck size={14} />
              Receive
            </Button>
          )}
          {canWrite && inTransit && doc.status === 'posted' && doc.state === 'received' && (
            <Button disabled={busy} onClick={() => void cancelReception()}>
              <Undo2 size={14} />
              Cancel reception
            </Button>
          )}
          {canWrite && doc.status === 'draft' && !isWorkOrder && (
            <Button variant="primary" disabled={busy} onClick={() => void run('post')}>
              <Send size={14} />
              Post
            </Button>
          )}
          {canWrite && doc.status === 'posted' && !isWorkOrder && (
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
          {doc.type === 'tolling_report' && doc.status === 'posted' && (
            <Button
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const r = await api<DocDetail>('POST', `/processing/reports/${doc.id}/act`, {});
                  setBusy(false);
                  if (r) {
                    toast('Created the service act');
                    navigate(`/documents/${r.id}`);
                  }
                })();
              }}
            >
              <FileSignature size={14} />
              Create service act
            </Button>
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
          {doc.type === 'customer_order' && (
            <Button
              onClick={() => {
                void (async () => {
                  if (await flush()) setCalcOpen(true);
                })();
              }}
            >
              <Calculator size={14} />
              Calculation
            </Button>
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
                <CounterpartyPicker id={p.id} value={form.counterpartyName} invalid={save === 'invalid' && !form.counterpartyId} onPick={c => edit(f => ({ ...f, counterpartyId: c.id, counterpartyName: c.name, contractId: null }))} />
              ) : (
                <div className="doc-ro">{doc.counterparty ? <Link className="crm-link" to={`/crm/companies/${doc.counterparty.id}`}>{doc.counterparty.name}</Link> : '—'}</div>
              )
            }
          </Field>
        )}
        {!internal && (
          <Field label="Contract" hint="The default contract of the customer is set automatically">
            {p =>
              editable ? (
                <Select
                  id={p.id}
                  disabled={!form.counterpartyId}
                  value={form.contractId ?? ''}
                  onValueChange={v => edit(f => ({ ...f, contractId: v || null }))}
                  options={contractOptions}
                  placeholder="Select contract"
                  aria-label="Contract"
                />
              ) : (
                <div className="doc-ro">{doc.contract ? <span className="mono">{doc.contract.number}</span> : '—'}</div>
              )
            }
          </Field>
        )}
        {usesWarehouse && !(isTransfer && form.operation === 'from_operation') && (
          <Field label={internal ? (meta.production ? 'Materials warehouse' : isCount ? 'Warehouse' : 'From warehouse') : 'Warehouse'}>
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
        {isTransfer && (
          <Field label="Kind of transfer">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.operation}
                onValueChange={v => edit(f => ({ ...f, operation: v }))}
                options={TRANSFER_OPERATIONS.map(o => ({ value: o, label: OPERATION_LABEL[o] ?? o }))}
                aria-label="Kind of transfer"
              />
            )}
          </Field>
        )}
        {meta.production && (
          <Field label="Operation" hint={disassembly ? 'Disassembly: the goods are taken apart into the outputs' : 'Assembly: the product is made of the materials'}>
            {p => <div className="doc-ro" id={p.id}>{OPERATION_LABEL[doc.operation ?? 'assembly'] ?? doc.operation}</div>}
          </Field>
        )}
        {(doc.type === 'customer_order' || doc.type === 'supplier_order') && (
          <Field label="Kind of operation">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.operation === 'processing' ? 'processing' : 'default'}
                onValueChange={v => edit(f => ({ ...f, operation: v === 'processing' ? 'processing' : '' }))}
                options={[
                  { value: 'default', label: doc.type === 'customer_order' ? 'Sale' : 'Purchase' },
                  { value: 'processing', label: 'Processing' },
                ]}
                aria-label="Kind of operation"
              />
            )}
          </Field>
        )}
        {isTolling && (
          <Field label="Processing order" hint="The owner of the materials is taken from it">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.tollingOrderId ?? ''}
                onValueChange={v => edit(f => ({ ...f, tollingOrderId: v || null }))}
                options={(processingOrders.data?.items ?? []).filter(o => o.status !== 'cancelled').map(o => ({ value: o.id, label: o.number ? `${o.number} · ${o.counterpartyName ?? o.ownerName ?? ''}` : 'Draft' }))}
                placeholder="Select processing order"
                aria-label="Processing order"
              />
            )}
          </Field>
        )}
        {(meta.stockRole === 'transfer' || meta.production) && (!isTransfer || form.operation === 'transfer' || form.operation === 'in_transit') && (
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
        {(toOperation || fromOperation) && (
          <>
            <Field label="Holder" hint="Member or work center">
              {p => (
                <Select
                  id={p.id}
                  disabled={!editable}
                  value={form.inUseMemberId ?? form.inUseWorkCenterId ?? ''}
                  onValueChange={v => edit(f => (members.some(m => m.id === v) ? { ...f, inUseMemberId: v, inUseWorkCenterId: null } : { ...f, inUseMemberId: null, inUseWorkCenterId: v }))}
                  options={[
                    ...members.filter(m => m.status === 'active').map(m => ({ value: m.id, label: m.name })),
                    ...workCenters.filter(w => !w.archivedAt).map(w => ({ value: w.id, label: w.name })),
                  ]}
                  placeholder="Select holder"
                  aria-label="Holder"
                />
              )}
            </Field>
          </>
        )}
        {doc.type === 'write_off' && (
          <Field label="Work center" hint="The cost of the write-off becomes indirect costs of the work center">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.workCenterId ?? ''}
                onValueChange={v => edit(f => ({ ...f, workCenterId: v || null }))}
                options={workCenters.filter(w => !w.archivedAt).map(w => ({ value: w.id, label: w.name }))}
                placeholder="Not set"
                aria-label="Work center"
              />
            )}
          </Field>
        )}
        {(meta.costItemKind || toOperation) && (
          <Field label={(meta.costItemKind ?? 'expense') === 'expense' ? 'Cost item' : 'Income item'} hint="Written off to this item">
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.costItemId ?? ''}
                onValueChange={v => edit(f => ({ ...f, costItemId: v }))}
                options={(costItems.data ?? [])
                  .filter(c => !c.archivedAt && c.kind === (meta.costItemKind ?? 'expense'))
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
                {isCount && (
                  <th style={{ width: 96 }} className="r">
                    Book
                  </th>
                )}
                <th style={{ width: 96 }} className="r">
                  {isCount ? 'Actual' : inTransit ? 'Shipped' : 'Qty'}
                </th>
                {inTransit && (
                  <th style={{ width: 96 }} className="r">
                    Received
                  </th>
                )}
                {isCount && (
                  <th style={{ width: 96 }} className="r">
                    Diff
                  </th>
                )}
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
                {doc.type === 'tolling_report' && (
                  <th style={{ width: 150 }}>Section</th>
                )}
                {isReceipt && (
                  <>
                    <th style={{ width: 170 }}>Cost item</th>
                    <th style={{ width: 160 }}>Work center</th>
                  </>
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
                const err = l.productId ? lineErrors(l, isCount) : {};
                const srv = serverLine.get(l.key);
                const shipped = Number(srv?.shipped ?? 0);
                const diff = Number(num(l.qty || '0')) - Number(num(srv?.bookQty ?? '0'));
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
                    {isCount && <td className="r num muted">{trimNum(srv?.bookQty ?? '0') || '0'}</td>}
                    <td className="r">
                      <NumCell value={l.qty} disabled={!editable} invalid={!!err.qty} label="Quantity" cell={`${i}:1`} onKeyDown={cellKey(i, 1)} onChange={v => patchLine(l.key, { qty: v })} />
                    </td>
                    {inTransit && (
                      <td className="r">
                        <NumCell
                          value={received[l.key] ?? '0'}
                          disabled={doc.status !== 'posted' || doc.state !== 'shipped'}
                          invalid={false}
                          label="Accepted quantity"
                          cell={`${i}:2`}
                          onKeyDown={() => {}}
                          onChange={v => setReceived(r => ({ ...r, [l.key]: v }))}
                        />
                      </td>
                    )}
                    {isCount && (
                      <td className="r num" style={{ fontWeight: 500 }}>
                        {diff === 0 ? '—' : diff > 0 ? `+${trimNum(String(diff))}` : trimNum(String(diff))}
                      </td>
                    )}
                    {isOrder && doc.status !== 'draft' && (
                      <>
                        <td className="r num muted">{trimNum(srv?.shipped ?? '0') || '0'}</td>
                        <td className="r num">{trimNum(String(Math.max(0, Number(l.qty) - shipped).toFixed(3))) || '0'}</td>
                      </>
                    )}
                    {meta.production && (
                      <td>
                        <span className="muted">{srv?.stockRole === 'in' ? (disassembly ? 'Output' : 'Product') : disassembly ? 'To disassemble' : 'Material'}</span>
                      </td>
                    )}
                    {doc.type === 'tolling_report' && (
                      <td>
                        <Select
                          aria-label="Section"
                          disabled={!editable}
                          value={l.tollingRole ?? 'product'}
                          onValueChange={v => patchLine(l.key, { tollingRole: v as TollingRole })}
                          options={TOLLING_ROLES.map(r => ({ value: r, label: TOLLING_ROLE_LABELS[r] }))}
                        />
                      </td>
                    )}
                    {isReceipt && (
                      <>
                        <td>
                          {srv?.kind === 'service' ? (
                            <Select
                              aria-label="Cost item"
                              disabled={!editable}
                              value={l.costItemId ?? ''}
                              onValueChange={v => patchLine(l.key, { costItemId: v || null })}
                              options={(costItems.data ?? [])
                                .filter(c => !c.archivedAt && c.kind === 'expense')
                                .map(c => ({ value: c.id, label: c.name }))}
                              placeholder="—"
                            />
                          ) : (
                            <span className="faint" title="Only service lines become indirect costs">
                              —
                            </span>
                          )}
                        </td>
                        <td>
                          {srv?.kind === 'service' ? (
                            <Select
                              aria-label="Work center"
                              disabled={!editable}
                              value={l.workCenterId ?? ''}
                              onValueChange={v => patchLine(l.key, { workCenterId: v || null })}
                              options={workCenters.filter(w => !w.archivedAt).map(w => ({ value: w.id, label: w.name }))}
                              placeholder="—"
                            />
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                      </>
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
                      {editable && doc.type === 'customer_order' && l.productId && (
                        <IconButton size="xs" label="Parameters of the product" onClick={() => setParamsLine(l.key)}>
                          <SlidersHorizontal size={13} />
                        </IconButton>
                      )}
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

      {isWorkOrder && <WorkOrderPanel doc={doc} />}

      <div className="doc-bottom">
        {breakdown.data && (
          <section className="doc-links panel" aria-label="Billing breakdown">
            <h2>Billing breakdown</h2>
            <p className="faint" style={{ fontSize: 12 }}>
              Period {breakdown.data.subscriptionPeriod} · works by fact {breakdown.data.factPeriod}. The original lines of the billing are kept here; the invoice shows the grouped positions.
            </p>
            {breakdown.data.warnings.map((w, i) => (
              <div key={i} className="faint" style={{ fontSize: 12 }}>
                {w}
              </div>
            ))}
            {breakdown.data.lines.map((l, i) => (
              <div key={i} style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{l.name}</span>
                  <span className="num muted">
                    {l.qty} × {money(l.price)}
                  </span>
                </div>
                {l.rows.map((r, j) => (
                  <div key={j} className="faint" style={{ fontSize: 12, paddingLeft: 12 }}>
                    {r.source}: {r.name} — {r.qty} × {r.price} = {money(r.amount)}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}
        {doc.type === 'production' && !!doc.components?.length && (
          <section className="doc-links panel" aria-label="Composition">
            <h2>Composition</h2>
            {doc.processingOrderId && (
              <p className="faint" style={{ fontSize: 12 }}>
                Release for a processing order: customer materials are written off from the owner&apos;s balance, our own ones from the warehouse at average cost. The product goes to the owner&apos;s balance; our costs are the cost of the processing service.
              </p>
            )}
            <table className="dtbl" aria-label="Composition">
              <thead>
                <tr>
                  <th>Material or work</th>
                  <th style={{ width: 120 }}>Owner</th>
                  <th style={{ width: 100 }} className="r">
                    Qty
                  </th>
                  <th style={{ width: 120 }} className="r">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {doc.components.map(c => (
                  <tr key={c.id}>
                    <td className="trunc">{c.kind === 'work' ? c.operation || 'Work' : c.kind === 'expense' ? 'Expense' : c.kind === 'semi' ? 'Semi-finished product' : 'Material'}</td>
                    <td>
                      <Badge tone={c.ownerKind === 'customer' ? 'accent' : 'gray'}>{MATERIAL_OWNER_LABELS[c.ownerKind]}</Badge>
                    </td>
                    <td className="r num">{c.kind === 'work' ? c.hours : c.qty}</td>
                    <td className="r num">{c.actualCost === null ? '—' : money(c.actualCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
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
          {isCount ? (
            <dl>
              <div>
                <dt>Lines</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div>
                <dt>Shortage</dt>
                <dd className="num">{countDiff(form.lines, serverLine).shortage}</dd>
              </div>
              <div>
                <dt>Surplus</dt>
                <dd className="num">{countDiff(form.lines, serverLine).surplus}</dd>
              </div>
            </dl>
          ) : internal ? (
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
          ) : processingKind ? (
            <dl>
              <div>
                <dt>Lines</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div className="grand">
                <dt>Service cost</dt>
                <dd className="num" data-testid="total-sum">
                  {doc.serviceCost === null || doc.serviceCost === undefined ? '—' : money(doc.serviceCost)}
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
      {paramsLine &&
        (() => {
          const l = form.lines.find(x => x.key === paramsLine);
          if (!l?.productId) return null;
          return <ParamsDialog productId={l.productId} productName={l.name} values={l.params ?? {}} onChange={v => patchLine(l.key, { params: v })} onClose={() => setParamsLine(null)} />;
        })()}
      {calcOpen && <CalculationDialog documentId={doc.id} onClose={() => setCalcOpen(false)} onApplied={() => void api('GET', `/documents/${doc.id}`)} />}
    </div>
  );
}

/** Инвентаризация: сколько позиций с недостачей и сколько с излишком */
function countDiff(lines: FormLine[], server: Map<string, { bookQty: string }>): { shortage: number; surplus: number } {
  let shortage = 0;
  let surplus = 0;
  for (const l of lines) {
    if (!l.productId) continue;
    const diff = Number(num(l.qty || '0')) - Number(num(server.get(l.key)?.bookQty ?? '0'));
    if (diff < 0) shortage++;
    else if (diff > 0) surplus++;
  }
  return { shortage, surplus };
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
