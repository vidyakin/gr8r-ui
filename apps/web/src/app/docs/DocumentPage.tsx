/* Форма документа: шапка (организация, контрагент, склад, дата, номер, способ указания НДС), табличная часть с подбором из каталога,
   итоги и НДС внизу, кнопки Post / Unpost / Create based on / Print. Черновик сохраняется сам (через паузу после правки); суммы строк и итоги
   считает та же функция, что и сервер при проведении (computeDocument). Проведённый документ только читается — его сначала снимают с проведения. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Calculator, ChevronDown, CircleAlert, ClipboardList, Copy, Ellipsis, FileSignature, FileText, PackageCheck, PackageX, Plus, Printer, RotateCcw, Send, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { amountInWordsRu, basedOnTargets, computeDocument, DEFECT_MODES, DOCUMENT_META, isInvestmentFactType, MATERIAL_OWNER_LABELS, PRINT_FORM_LABELS, TOLLING_ROLE_LABELS, TOLLING_ROLES, TRANSFER_OPERATIONS, VAT_LABELS, VAT_RATES, type DefectMode, type DocumentType, type TollingRole, type VatRate } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Select, Skeleton, toast } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { money, unitSymbol, useIsAdmin, useUnits, type Product } from '../catalog/data';
import { uuidv7 } from '../lib/uuid';
import { fmtDate } from '../lib/dates';
import { useWorkspace } from '../data/store';
import { PayControls } from '../money/PayControls';
import { useSnapshot } from '../production/data';
import { MaterialModeField, WasteHeaderFields, WasteTab } from '../production/WasteTab';
import { STATUS_LABEL, STATUS_TONE, docTitle, docsKey, typeLabel, useCostItems, useDocsApi, useDocument, useOrganizations, useProcessingOrders, useWarehouses, type DocDetail, type DocLink } from './data';
import { CalculationDialog, ParamsDialog } from './calculation';
import { CounterpartyPicker, ProductPicker } from './pickers';
import { useBillingBreakdown, useContracts } from './billing-data';
import { WorkOrderPanel } from './work-orders';
import { SerialsButton } from './serials-ui';
import { DeliveryTab } from './DeliveryTab';
import { DocTabs, type DocTab } from './doc-tabs';
import { DocInvestmentField } from '../finance/DocInvestmentField';
import { hasKey, t, useT, type TKey } from '@/i18n';
import { handleNumericArrow } from '@/lib/numeric-step';
import { useWsId } from '../meta/data';

/** Виды перемещения между складами */
/** Вид операции документа на текущем языке; неизвестный код — как есть */
const operationLabel = (op: string) => (hasKey(`docs.operations.${op}`) ? t(`docs.operations.${op}` as TKey) : op);

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
  /** Инвестпроект: документ идёт в факт проекта */
  investmentProjectId: string | null;
  date: string;
  dueDate: string;
  priceIncludesVat: boolean;
  comment: string;
  lines: FormLine[];
}

const trimNum = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/** Адрес журнала группы: продажи, закупки или складские документы */
const groupPath = (g: string) => (g === 'sales' ? '/sales' : g === 'purchases' ? '/purchases' : g === 'production' ? '/production/orders' : '/stock-docs');
type TFunc = (key: import('@/i18n').TKey, params?: Record<string, string | number>) => string;
const groupLabel = (t: TFunc, g: string) => (g === 'sales' ? t('docs.document.groupSales') : g === 'purchases' ? t('docs.document.groupPurchases') : g === 'production' ? t('docs.document.groupProduction') : t('docs.document.groupStock'));

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
    investmentProjectId: d.investmentProjectId ?? null,
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
    investmentProjectId: f.investmentProjectId,
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
  const t = useT();
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
        <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.document.notFound')} action={<Link to="/sales" className="btn btn-secondary">{t('docs.document.back')}</Link>}>
          {t('docs.document.notFoundHint')}
        </EmptyState>
      </div>
    );
  return <DocumentView key={q.data.id} doc={q.data} />;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'invalid' | 'error';

function DocumentView({ doc }: { doc: DocDetail }) {
  const t = useT();
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
  const contractOptions = (contracts.data?.items ?? []).map(c => ({ value: c.id, label: c.number ? `${c.number}${c.isService ? ` · ${t('docs.serviceContract')}` : ''}` : c.companyName }));
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
  /** Выпуск продукции со вкладкой «Отходы»: из давальческого сырья отходы не приходуются */
  const hasWaste = doc.type === 'production' && !doc.processingOrderId;
  /** Брак ведётся у выпуска сборки: в строке продукции видны «Из них брак» и режим брака */
  const hasDefect = hasWaste && !disassembly;
  /** Режим «по итогам смены»: строки материалов — нормы, их списывает документ «Распределение материалов» */
  const shiftMode = hasDefect && doc.materialMode === 'shift';
  const items = doc.items ?? [];
  const wasteRows = (doc.components ?? []).filter(c => c.kind === 'waste');
  const compositionRows = (doc.components ?? []).filter(c => c.kind !== 'waste');
  /** Брак «на расходы» проведённого выпуска ждёт списания */
  const hasExpenseDefect = hasDefect && doc.status === 'posted' && items.some(i => Number(i.defectQty) > 0 && i.defectMode === 'expense');
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
      toast.error(t('docs.document.saveErrorFix'));
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
    // в числовых ячейках стрелки меняют число (NumCell), по строкам ходят только из ячейки товара
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && col === 0) {
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
      if (r)
        toast(
          action === 'post'
            ? t('docs.document.toastPosted', { number: r.number ? t('docs.document.toastPostedNumber', { number: r.number }) : '' })
            : action === 'unpost'
              ? t('docs.document.toastUnposted')
              : action === 'cancel'
                ? t('docs.document.toastCancelled')
                : t('docs.document.toastRestored'),
        );
    } finally {
      setBusy(false);
    }
  };
  const createBasedOn = async (type: DocumentType) => {
    if (!(await flush())) return;
    const r = await api<DocDetail>('POST', `/documents/${doc.id}/based-on`, { type });
    if (r) {
      toast(t('docs.document.toastCreatedFrom', { type: typeLabel(type).toLowerCase(), source: doc.number ?? t('docs.document.toastCreatedFromDraft') }));
      // прочие затраты — свой экран
      navigate(type === 'other_costs' ? `/other-costs/${r.id}` : `/documents/${r.id}`);
    }
  };
  const remove = async () => {
    const r = await api('DELETE', `/documents/${doc.id}`);
    if (r) {
      toast(t('docs.document.toastDraftDeleted'));
      navigate(groupPath(meta.group));
    }
  };

  /** Заполнить строки инвентаризации по остаткам склада */
  const fillCount = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/fill-count-sheet`);
      if (r) toast(t('docs.document.toastFillCount'));
    } finally {
      setBusy(false);
    }
  };
  /** Приёмка перемещения «в пути»: принимаемое количество по каждой строке */
  const receiveGoods = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/state`, { state: 'received', received: doc.lines.map(l => ({ id: l.id, qty: num(received[l.id] ?? l.qty) })) });
      if (r) toast(t('docs.document.toastReceiveGoods'));
    } finally {
      setBusy(false);
    }
  };
  /** Отмена приёмки: товар остаётся «в пути» */
  const cancelReception = async () => {
    setBusy(true);
    try {
      const r = await api<DocDetail>('POST', `/documents/${doc.id}/state`, { state: 'shipped' });
      if (r) toast(t('docs.document.toastCancelReception'));
    } finally {
      setBusy(false);
    }
  };

  /** Отходы и брак черновика сохраняются сразу, отдельно от строк: сервер возвращает карточку целиком */
  const saveAccounting = (body: Record<string, unknown>) => api<DocDetail>('PATCH', `/production-orders/${doc.id}/accounting`, body);
  /** Брак позиций: вводится в таблице, сохраняется при выходе из поля */
  const [defects, setDefects] = React.useState<Record<string, { qty: string; mode: DefectMode | '' }>>(() => Object.fromEntries((doc.items ?? []).map(i => [i.id, { qty: trimNum(i.defectQty) || '0', mode: i.defectMode ?? '' }])));
  React.useEffect(() => setDefects(Object.fromEntries((doc.items ?? []).map(i => [i.id, { qty: trimNum(i.defectQty) || '0', mode: i.defectMode ?? '' }]))), [doc.items]);
  const commitDefect = async (itemId: string, next: { qty: string; mode: DefectMode | '' }) => {
    setDefects(d => ({ ...d, [itemId]: next }));
    const qty = next.qty.trim() === '' ? '0' : num(next.qty);
    const r = await saveAccounting({ defects: [{ itemId, defectQty: qty, defectMode: Number(qty) > 0 ? next.mode || null : null }] });
    // ошибка (режим не выбран, брак больше выпуска): значения возвращаются к сохранённым
    if (!r) setDefects(d => ({ ...d, [itemId]: { qty: trimNum(items.find(i => i.id === itemId)?.defectQty ?? '0') || '0', mode: items.find(i => i.id === itemId)?.defectMode ?? '' } }));
  };
  /** «Списать брак»: черновик списания по браку «на расходы» */
  const writeOffDefects = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('POST', `/production/${doc.id}/write-off-defects`);
      if (r) {
        toast(t('production.waste.writeOffDone'));
        navigate(`/documents/${r.id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // гарантийный ремонт не продаётся: счёт на его основании недоступен
  const targets = basedOnTargets(doc.type).filter(x => !(doc.kindType === 'warranty' && x === 'invoice'));
  const lineCount = form.lines.filter(l => l.productId).length;
  const hasNumber = doc.numberSeq !== null;
  const noVatOnly = calc.totals.byRate.length > 0 && calc.totals.byRate.every(r => r.rate === 'none');

  // табличные части документа — во вкладках (как в 1С); шапка над ними, итоги и комментарий внизу
  const docTabs: (DocTab | false | null)[] = [
    {
      id: 'lines',
      label: t('docs.tabs.lines'),
      count: lineCount,
      content: (
        <section className="doc-lines panel" aria-label={t('docs.lines.addRow')}>
          {shiftMode && <p className="faint" style={{ padding: '8px 12px', fontSize: 12 }}>{t('production.shift.normNote')}</p>}
          <div className="table-wrap">
            <table className="dtbl" aria-label={t('docs.document.tableLines')}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>{t('docs.document.colNum')}</th>
                  <th>{t('docs.document.colProduct')}</th>
                  <th style={{ width: 56 }}>{t('docs.document.colUnit')}</th>
                  {isCount && (
                    <th style={{ width: 96 }} className="r">
                      {t('docs.document.colBook')}
                    </th>
                  )}
                  <th style={{ width: 96 }} className="r">
                    {isCount ? t('docs.document.colActual') : inTransit ? t('docs.document.colShipped') : t('docs.document.colQty')}
                  </th>
                  {inTransit && (
                    <th style={{ width: 96 }} className="r">
                      {t('docs.document.colReceived')}
                    </th>
                  )}
                  {isCount && (
                    <th style={{ width: 96 }} className="r">
                      {t('docs.document.colDiff')}
                    </th>
                  )}
                  {isOrder && doc.status !== 'draft' && (
                    <>
                      <th style={{ width: 84 }} className="r">
                        {doc.type === 'customer_order' ? t('docs.document.colShipped') : t('docs.document.colReceived')}
                      </th>
                      <th style={{ width: 84 }} className="r">
                        {t('docs.document.colRemaining')}
                      </th>
                    </>
                  )}
                  {meta.production && (
                    <th style={{ width: 96 }}>{t('docs.document.colRole')}</th>
                  )}
                  {hasDefect && (
                    <>
                      <th style={{ width: 96 }} className="r">
                        {t('production.waste.colDefect')}
                      </th>
                      <th style={{ width: 150 }}>{t('production.waste.colDefectMode')}</th>
                    </>
                  )}
                  {doc.type === 'tolling_report' && (
                    <th style={{ width: 150 }}>{t('docs.document.colSection')}</th>
                  )}
                  {isReceipt && (
                    <>
                      <th style={{ width: 170 }}>{t('docs.document.colCostItem')}</th>
                      <th style={{ width: 160 }}>{t('docs.document.colWorkCenter')}</th>
                    </>
                  )}
                  <th style={{ width: 112 }} className="r">
                    {internal ? t('docs.document.colCost') : t('docs.document.colPrice')}
                  </th>
                  {!internal && (
                    <>
                      <th style={{ width: 72 }} className="r">
                        {t('docs.document.colDiscPct')}
                      </th>
                      <th style={{ width: 84 }}>{t('docs.document.colVat')}</th>
                      <th style={{ width: 104 }} className="r">
                        {t('docs.document.colVatAmount')}
                      </th>
                    </>
                  )}
                  <th style={{ width: 120 }} className="r">
                    {internal ? t('docs.document.colAmount') : t('docs.document.colTotal')}
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
                        <NumCell value={l.qty} disabled={!editable || (shiftMode && srv?.stockRole === 'out')} invalid={!!err.qty} label={t('docs.document.cellQty')} cell={`${i}:1`} onKeyDown={cellKey(i, 1)} onChange={v => patchLine(l.key, { qty: v })} />
                      </td>
                      {inTransit && (
                        <td className="r">
                          <NumCell
                            value={received[l.key] ?? '0'}
                            disabled={doc.status !== 'posted' || doc.state !== 'shipped'}
                            invalid={false}
                            label={t('docs.document.cellAccepted')}
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
                          <span className="muted">{srv?.stockRole === 'in' ? (disassembly ? t('docs.document.roleOutput') : t('docs.document.roleProduct')) : disassembly ? t('docs.document.roleToDisassemble') : shiftMode ? t('production.shift.roleNorm') : t('docs.document.roleMaterial')}</span>
                        </td>
                      )}
                      {hasDefect && (
                        <>
                          <td className="r">
                            {(() => {
                              const it = srv?.stockRole === 'in' ? items.find(x => x.documentLineId === l.key) : undefined;
                              if (!it) return <span className="faint">—</span>;
                              const d = defects[it.id] ?? { qty: '0', mode: '' as const };
                              return editable ? (
                                <Input aria-label={t('production.waste.colDefect')} inputMode="decimal" value={d.qty} onChange={e => setDefects(m => ({ ...m, [it.id]: { ...d, qty: e.target.value } }))} onBlur={() => void commitDefect(it.id, d)} />
                              ) : (
                                <span className="num">{d.qty}</span>
                              );
                            })()}
                          </td>
                          <td>
                            {(() => {
                              const it = srv?.stockRole === 'in' ? items.find(x => x.documentLineId === l.key) : undefined;
                              if (!it) return <span className="faint">—</span>;
                              const d = defects[it.id] ?? { qty: '0', mode: '' as const };
                              if (Number(num(d.qty)) <= 0) return <span className="faint">{t('production.waste.defectNone')}</span>;
                              const label = (m: DefectMode) => (m === 'cost' ? t('production.waste.defectModeCost') : t('production.waste.defectModeExpense'));
                              return editable ? (
                                <Select
                                  size="sm"
                                  className="min-w-[140px]"
                                  aria-label={t('production.waste.colDefectMode')}
                                  value={d.mode || undefined}
                                  onValueChange={v => void commitDefect(it.id, { ...d, mode: v as DefectMode })}
                                  options={DEFECT_MODES.map(m => ({ value: m, label: label(m) }))}
                                  placeholder="—"
                                />
                              ) : (
                                <span className="muted">{d.mode ? label(d.mode) : '—'}</span>
                              );
                            })()}
                          </td>
                        </>
                      )}
                      {doc.type === 'tolling_report' && (
                        <td>
                          <Select
                            aria-label={t('docs.document.colSection')}
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
                                aria-label={t('docs.document.colCostItem')}
                                disabled={!editable}
                                value={l.costItemId ?? ''}
                                onValueChange={v => patchLine(l.key, { costItemId: v || null })}
                                options={(costItems.data ?? [])
                                  .filter(c => !c.archivedAt && c.kind === 'expense')
                                  .map(c => ({ value: c.id, label: c.name }))}
                                placeholder="—"
                              />
                            ) : (
                              <span className="faint" title={t('docs.document.serviceOnlyCostHint')}>
                                —
                              </span>
                            )}
                          </td>
                          <td>
                            {srv?.kind === 'service' ? (
                              <Select
                                aria-label={t('docs.document.colWorkCenter')}
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
                          label={internal ? t('docs.document.cellCost') : t('docs.document.cellPrice')}
                          cell={`${i}:2`}
                          onKeyDown={cellKey(i, 2)}
                          onChange={v => patchLine(l.key, { price: v })}
                        />
                      </td>
                      {!internal && (
                        <>
                          <td className="r">
                            <NumCell value={l.discountPct} disabled={!editable} invalid={!!err.discountPct} label={t('docs.document.cellDiscPct')} cell={`${i}:3`} onKeyDown={cellKey(i, 3)} onChange={v => patchLine(l.key, { discountPct: v })} />
                          </td>
                          <td>
                            <select className="input cell-input" aria-label={t('docs.document.cellVat')} disabled={!editable} value={l.vatRate} onChange={e => patchLine(l.key, { vatRate: e.target.value as VatRate })}>
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
                        {srv?.trackSerials && (
                          <SerialsButton doc={doc} lineId={l.key} productId={l.productId ?? ''} name={l.name} qty={l.qty} serials={doc.serials ?? []} editable={editable} warehouseId={doc.warehouse?.id ?? null} incoming={meta.stock === 'in' || meta.stockRole === 'in' || srv.stockRole === 'in'} />
                        )}
                        {editable && doc.type === 'customer_order' && l.productId && (
                          <IconButton size="xs" label={t('docs.document.parameters')} onClick={() => setParamsLine(l.key)}>
                            <SlidersHorizontal size={13} />
                          </IconButton>
                        )}
                        {editable && (
                          <IconButton size="xs" label={t('docs.lines.removeLineAria')} onClick={() => edit(f => ({ ...f, lines: f.lines.filter(x => x.key !== l.key) }))}>
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
                      {t('docs.document.emptyLines')}{editable ? t('docs.document.emptyLinesAdd') : ''}
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
                {t('docs.lines.addRow')}
              </Button>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('docs.keysHint')}
              </span>
            </div>
          )}
        </section>
      ),
    },
    !!breakdown.data && {
      id: 'billing',
      label: t('docs.tabs.billing'),
      content: breakdown.data && (
          <section className="doc-links panel" aria-label={t('docs.tabs.billing')}>
          <p className="faint" style={{ fontSize: 12 }}>
            {t('docs.document.billingPeriod', { period: breakdown.data.subscriptionPeriod, fact: breakdown.data.factPeriod })}. {/* Исходные строки биллинга здесь; в счёте — сводные позиции. */}
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
      ),
    },
    doc.type === 'production' && !!compositionRows.length && {
      id: 'composition',
      label: t('docs.tabs.composition'),
      count: compositionRows.length,
      content: (
          <section className="doc-links panel" aria-label={t('docs.document.composition')}>
            {doc.processingOrderId && (
              <p className="faint" style={{ fontSize: 12 }}>
                {t('docs.document.compositionLead')}
              </p>
            )}
            <table className="dtbl" aria-label={t('docs.document.composition')}>
              <thead>
                <tr>
                  <th>{t('docs.document.colProduct')}</th>
                  <th style={{ width: 120 }}>{t('docs.document.colRole')}</th>
                  <th style={{ width: 100 }} className="r">
                    {t('docs.document.colQty')}
                  </th>
                  <th style={{ width: 120 }} className="r">
                    {t('docs.document.colCost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {compositionRows.map(c => (
                  <tr key={c.id}>
                    <td className="trunc">{c.kind === 'work' ? c.operation || t('docs.document.workKind') : c.kind === 'expense' ? t('docs.document.expenseKind') : c.kind === 'semi' ? t('docs.document.semiKind') : t('docs.document.materialKind')}</td>
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
      ),
    },
    (doc.type === 'customer_order' || doc.type === 'realization' || doc.type === 'work_order') && {
      id: 'delivery',
      label: t('delivery.tab.title'),
      content: <DeliveryTab doc={doc} />,
    },
    hasWaste && (editable || wasteRows.length > 0) && {
      id: 'waste',
      label: t('production.waste.tab'),
      count: wasteRows.length,
      content: <WasteTab rows={wasteRows} editable={editable} seeCost={isAdmin} onSave={waste => saveAccounting({ waste })} />,
    },
  ];

  return (
    <div className="page doc-page">
      <div className="doc-bar">
        <div className="doc-title">
          <nav className="muted" style={{ fontSize: 12.5 }} aria-label={t('docs.document.headerAria')}>
            <Link to={groupPath(meta.group)} className="crm-link">
              {groupLabel(t, meta.group)}
            </Link>
            {' / '}
            <Link to={`${groupPath(meta.group)}?type=${doc.type}`} className="crm-link">
              {typeLabel(doc.type)}
            </Link>
          </nav>
          <h1>
            {typeLabel(doc.type)} {doc.number ?? <span className="faint">{t('docs.document.draftNumber')}</span>}
            <Badge tone={STATUS_TONE[doc.status]} dot>
              {STATUS_LABEL[doc.status]}
            </Badge>
            {doc.state && <Badge tone="violet">{(doc.states ?? meta.states)?.find(s => s.key === doc.state)?.label ?? doc.state}</Badge>}
          </h1>
          <span className="faint" style={{ fontSize: 12 }} aria-live="polite" data-testid="save-state">
            {doc.status !== 'draft' ? (doc.postedAt ? `${t('docs.status.posted')} ${fmtDate(new Date(doc.postedAt))}` : '') : save === 'saving' ? t('docs.document.save.saving') : save === 'dirty' ? t('docs.document.save.dirty') : save === 'invalid' ? t('docs.document.save.invalid') : save === 'error' ? t('docs.document.save.error') : t('docs.document.save.saved')}
          </span>
        </div>
        <div className="doc-actions">
          {canWrite && isCount && doc.status === 'draft' && (
            <Button disabled={busy} onClick={() => void fillCount()}>
              <ClipboardList size={14} />
              {t('docs.document.fillByStock')}
            </Button>
          )}
          {canWrite && inTransit && doc.status === 'posted' && doc.state === 'shipped' && (
            <Button variant="primary" disabled={busy} onClick={() => void receiveGoods()}>
              <PackageCheck size={14} />
              {t('docs.document.receive')}
            </Button>
          )}
          {canWrite && inTransit && doc.status === 'posted' && doc.state === 'received' && (
            <Button disabled={busy} onClick={() => void cancelReception()}>
              <Undo2 size={14} />
              {t('docs.document.cancelReception')}
            </Button>
          )}
          {canWrite && doc.status === 'draft' && !isWorkOrder && (
            <Button variant="primary" disabled={busy} onClick={() => void run('post')}>
              <Send size={14} />
              {t('docs.document.post')}
            </Button>
          )}
          {canWrite && doc.status === 'posted' && !isWorkOrder && (
            <Button disabled={busy} onClick={() => void run('unpost')}>
              <Undo2 size={14} />
              {t('docs.document.unpost')}
            </Button>
          )}
          {canWrite && hasExpenseDefect && (
            <Button disabled={busy} onClick={() => void writeOffDefects()}>
              <PackageX size={14} />
              {t('production.waste.writeOff')}
            </Button>
          )}
          {canWrite && doc.status === 'cancelled' && (
            <Button disabled={busy} onClick={() => void run('restore')}>
              <RotateCcw size={14} />
              {t('docs.document.restore')}
            </Button>
          )}
          {canWrite && !!targets.length && doc.status !== 'cancelled' && (
            <Menu>
              <MenuTrigger asChild>
                <Button>
                  <Copy size={14} />
                  {t('docs.document.createBasedOnDoc')}
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
          <PayControls docId={doc.id} type={doc.type} status={doc.status} />
          {doc.type === 'tolling_report' && doc.status === 'posted' && (
            <Button
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  const r = await api<DocDetail>('POST', `/processing/reports/${doc.id}/act`, {});
                  setBusy(false);
                  if (r) {
                    toast(t('docs.document.toastActCreated'));
                    navigate(`/documents/${r.id}`);
                  }
                })();
              }}
            >
              <FileSignature size={14} />
              {t('docs.document.createServiceAct')}
            </Button>
          )}
          {!!meta.forms.length && (
            <Menu>
              <MenuTrigger asChild>
                <Button>
                  <Printer size={14} />
                  {t('docs.document.print')}
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
              {t('docs.document.calcBtn')}
            </Button>
          )}
          {canWrite && doc.status !== 'posted' && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={t('docs.document.moreActions')}>
                  <Ellipsis size={16} />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                {doc.status === 'draft' && (
                  <MenuItem icon={<Ban size={15} />} onSelect={() => setConfirm('cancel')}>
                    {t('docs.document.cancelDocument')}
                  </MenuItem>
                )}
                {doc.status === 'draft' && !hasNumber && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirm('delete')}>
                      {t('docs.document.deleteDraft')}
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>

      <section className="doc-head panel" aria-label={t('docs.document.headerAria')}>
        <Field label={t('docs.document.organization')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable || hasNumber}
              value={form.organizationId}
              onValueChange={v => edit(f => ({ ...f, organizationId: v }))}
              options={(orgs.data ?? []).filter(o => !o.archivedAt || o.id === form.organizationId).map(o => ({ value: o.id, label: o.name }))}
              aria-label={t('docs.document.organization')}
            />
          )}
        </Field>
        {!internal && (
          <Field label={meta.party === 'customer' ? t('docs.document.customer') : t('docs.document.supplier')}>
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
          <Field label={t('docs.header.contract')} hint={t('docs.document.contractHint')}>
            {p =>
              editable ? (
                <Select
                  id={p.id}
                  disabled={!form.counterpartyId}
                  value={form.contractId ?? ''}
                  onValueChange={v => edit(f => ({ ...f, contractId: v || null }))}
                  options={contractOptions}
                  placeholder={t('docs.document.contractPlaceholder')}
                  aria-label={t('docs.header.contract')}
                />
              ) : (
                <div className="doc-ro">{doc.contract ? <span className="mono">{doc.contract.number}</span> : '—'}</div>
              )
            }
          </Field>
        )}
        {usesWarehouse && !(isTransfer && form.operation === 'from_operation') && (
          <Field label={internal ? (meta.production ? t('docs.document.materialsWarehouse') : isCount ? t('docs.header.warehouse') : t('docs.document.fromWarehouse')) : t('docs.header.warehouse')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.warehouseId ?? ''}
                onValueChange={v => edit(f => ({ ...f, warehouseId: v }))}
                options={whOptions.map(w => ({ value: w.id, label: w.name }))}
                placeholder={t('docs.document.selectWarehouse')}
                aria-label={t('docs.header.warehouse')}
              />
            )}
          </Field>
        )}
        {isTransfer && (
          <Field label={t('docs.document.kindOfTransfer')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.operation}
                onValueChange={v => edit(f => ({ ...f, operation: v }))}
                options={TRANSFER_OPERATIONS.map(o => ({ value: o, label: operationLabel(o) }))}
                aria-label={t('docs.document.kindOfTransfer')}
              />
            )}
          </Field>
        )}
        {meta.production && (
          <Field label={t('docs.header.operation')} hint={disassembly ? t('docs.document.operationHintDisassembly') : t('docs.document.operationHintAssembly')}>
            {p => <div className="doc-ro" id={p.id}>{operationLabel(doc.operation ?? 'assembly')}</div>}
          </Field>
        )}
        {(doc.type === 'customer_order' || doc.type === 'supplier_order') && (
          <Field label={t('docs.document.kindOfOperation')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.operation === 'processing' ? 'processing' : 'default'}
                onValueChange={v => edit(f => ({ ...f, operation: v === 'processing' ? 'processing' : '' }))}
                options={[
                  { value: 'default', label: doc.type === 'customer_order' ? t('docs.document.sale') : t('docs.document.purchase') },
                  { value: 'processing', label: t('docs.document.processing') },
                ]}
                aria-label={t('docs.document.kindOfOperation')}
              />
            )}
          </Field>
        )}
        {isTolling && (
          <Field label={t('docs.document.processingOrder')} hint={t('docs.document.processingOrderHint')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.tollingOrderId ?? ''}
                onValueChange={v => edit(f => ({ ...f, tollingOrderId: v || null }))}
                options={(processingOrders.data?.items ?? []).filter(o => o.status !== 'cancelled').map(o => ({ value: o.id, label: o.number ? `${o.number} · ${o.counterpartyName ?? o.ownerName ?? ''}` : t('docs.document.draftNumber') }))}
                placeholder={t('docs.document.processingOrderPlaceholder')}
                aria-label={t('docs.document.processingOrder')}
              />
            )}
          </Field>
        )}
        {(meta.stockRole === 'transfer' || meta.production) && (!isTransfer || form.operation === 'transfer' || form.operation === 'in_transit') && (
          <Field label={meta.production ? t('docs.document.finishedWarehouse') : t('docs.document.toWarehouse')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.targetWarehouseId ?? ''}
                onValueChange={v => edit(f => ({ ...f, targetWarehouseId: v }))}
                options={whOptions.filter(w => w.id !== form.warehouseId).map(w => ({ value: w.id, label: w.name }))}
                placeholder={t('docs.document.selectWarehouse')}
                aria-label={t('docs.document.toWarehouse')}
              />
            )}
          </Field>
        )}
        {hasDefect && <MaterialModeField value={doc.materialMode ?? 'on_release'} editable={editable} onChange={v => void saveAccounting({ materialMode: v })} />}
        {doc.type === 'production' && (
          <Field label={t('production.field.finalWorkCenter')} hint={t('production.order.hint.finalWorkCenter')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={doc.finalWorkCenter?.id ?? doc.workCenter?.id ?? ''}
                onValueChange={v => void saveAccounting({ finalWorkCenterId: v })}
                options={workCenters.filter(w => !w.archivedAt).map(w => ({ value: w.id, label: w.name }))}
                placeholder={t('docs.document.notSet')}
                aria-label={t('production.field.finalWorkCenter')}
              />
            )}
          </Field>
        )}
        {hasWaste && (
          <WasteHeaderFields
            valuation={doc.wasteValuation ?? 'accounting'}
            wasteWarehouseId={doc.wasteWarehouseId ?? null}
            defectWarehouseId={doc.defectWarehouseId ?? null}
            warehouses={(warehouses.data ?? []).filter(w => !w.archivedAt && w.kind !== 'transit')}
            editable={editable}
            showDefect={hasDefect}
            onChange={patch => void saveAccounting(patch)}
          />
        )}
        {(toOperation || fromOperation) && (
          <>
            <Field label={t('docs.document.holder')} hint={t('docs.document.holderHint')}>
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
                  placeholder={t('docs.document.holderPlaceholder')}
                  aria-label={t('docs.document.holder')}
                />
              )}
            </Field>
          </>
        )}
        {doc.type === 'write_off' && (
          <Field label={t('docs.header.workCenter')} hint={t('docs.document.workCenterHint')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.workCenterId ?? ''}
                onValueChange={v => edit(f => ({ ...f, workCenterId: v || null }))}
                options={workCenters.filter(w => !w.archivedAt).map(w => ({ value: w.id, label: w.name }))}
                placeholder={t('docs.document.notSet')}
                aria-label={t('docs.header.workCenter')}
              />
            )}
          </Field>
        )}
        {(meta.costItemKind || toOperation) && (
          <Field label={(meta.costItemKind ?? 'expense') === 'expense' ? t('docs.header.costItem') : t('docs.document.incomeItem')} hint={t('docs.document.costItemHint')}>
            {p => (
              <Select
                id={p.id}
                disabled={!editable}
                value={form.costItemId ?? ''}
                onValueChange={v => edit(f => ({ ...f, costItemId: v }))}
                options={(costItems.data ?? [])
                  .filter(c => !c.archivedAt && c.kind === (meta.costItemKind ?? 'expense'))
                  .map(c => ({ value: c.id, label: c.name }))}
                placeholder={t('docs.document.selectItem')}
                aria-label={t('docs.header.costItem')}
              />
            )}
          </Field>
        )}
        {isInvestmentFactType(doc.type) && <DocInvestmentField value={form.investmentProjectId} current={doc.investmentProject} disabled={!editable} onChange={v => edit(f => ({ ...f, investmentProjectId: v }))} />}
        <Field label={t('docs.header.date')}>{p => <Input {...p} type="date" disabled={!editable} value={form.date} onChange={e => edit(f => ({ ...f, date: e.target.value }))} />}</Field>
        {(doc.type === 'invoice' || doc.type === 'quote' || doc.type === 'customer_order') && (
          <Field label={doc.type === 'quote' ? t('docs.document.validUntil') : doc.type === 'invoice' ? t('docs.document.payBy') : t('docs.document.dueDate')}>
            {p => <Input {...p} type="date" disabled={!editable} value={form.dueDate} onChange={e => edit(f => ({ ...f, dueDate: e.target.value }))} />}
          </Field>
        )}
        <Field label={t('docs.header.number')} hint={hasNumber ? undefined : t('docs.document.numberHintAuto')}>
          {p => <Input {...p} readOnly value={doc.number ?? ''} placeholder="—" className="mono" />}
        </Field>
        {!internal && (
          <Field label={t('docs.document.prices')}>
            {() => (
              <Segmented
                aria-label={t('docs.document.prices')}
                value={form.priceIncludesVat ? 'incl' : 'excl'}
                onValueChange={v => editable && edit(f => ({ ...f, priceIncludesVat: v === 'incl' }))}
                items={[
                  { value: 'incl', label: t('docs.document.vatIncluded') },
                  { value: 'excl', label: t('docs.document.vatOnTop') },
                ]}
              />
            )}
          </Field>
        )}
      </section>

      {isWorkOrder ? <WorkOrderPanel doc={doc} lead={docTabs} /> : <DocTabs label={t('docs.tabsLabel')} tabs={docTabs} />}

      <div className="doc-bottom">
        <section className="doc-links panel" aria-label={t('docs.document.related')}>
          <h2>{t('docs.document.related')}</h2>
          {doc.basedOn ? (
            <p>
              <span className="muted">{t('docs.document.basedOnHeader')} </span>
              <DocRef d={doc.basedOn} />
            </p>
          ) : (
            <p className="faint">{t('docs.document.notBasedOn')}</p>
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
            <p className="faint">{t('docs.document.noChildren')}</p>
          )}
        </section>
        <section className="doc-totals panel" aria-label={t('docs.document.totals.total')}>
          {isCount ? (
            <dl>
              <div>
                <dt>{t('docs.document.totals.lines')}</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div>
                <dt>{t('docs.document.totals.shortage')}</dt>
                <dd className="num">{countDiff(form.lines, serverLine).shortage}</dd>
              </div>
              <div>
                <dt>{t('docs.document.totals.surplus')}</dt>
                <dd className="num">{countDiff(form.lines, serverLine).surplus}</dd>
              </div>
            </dl>
          ) : internal ? (
            <dl>
              <div>
                <dt>{t('docs.document.totals.lines')}</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div className="grand">
                <dt>{t('docs.document.totals.costAtAverage')}</dt>
                <dd className="num" data-testid="total-sum">
                  {doc.costTotal === null || doc.costTotal === undefined ? '—' : money(doc.costTotal)}
                </dd>
              </div>
            </dl>
          ) : processingKind ? (
            <dl>
              <div>
                <dt>{t('docs.document.totals.lines')}</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div className="grand">
                <dt>{t('docs.document.totals.serviceCost')}</dt>
                <dd className="num" data-testid="total-sum">
                  {doc.serviceCost === null || doc.serviceCost === undefined ? '—' : money(doc.serviceCost)}
                </dd>
              </div>
            </dl>
          ) : (
            <dl>
              <div>
                <dt>{t('docs.document.totals.lines')}</dt>
                <dd className="num">{lineCount}</dd>
              </div>
              <div>
                <dt>{t('docs.document.totals.amountWithoutVat')}</dt>
                <dd className="num" data-testid="total-net">
                  {money(calc.totals.net)}
                </dd>
              </div>
              {noVatOnly ? (
                <div>
                  <dt>{t('docs.document.totals.vat')}</dt>
                  <dd className="num">{t('docs.document.totals.noVat')}</dd>
                </div>
              ) : (
                calc.totals.byRate
                  .filter(r => r.rate !== 'none')
                  .map(r => (
                    <div key={r.rate}>
                      <dt>{t('docs.document.totals.vatRate', { rate: VAT_LABELS[r.rate as VatRate] })}</dt>
                      <dd className="num">{money(r.vat)}</dd>
                    </div>
                  ))
              )}
              <div className="grand">
                <dt>{t('docs.document.totals.total')}{form.priceIncludesVat ? t('docs.document.totals.totalIncluded').replace(t('docs.document.totals.total'), '') : ''}</dt>
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

      <section className="doc-comment panel" aria-label={t('docs.comment')}>
        <Field label={t('docs.comment')}>
          {p => <Input {...p} disabled={!editable} value={form.comment} placeholder={t('docs.commentHint.document')} onChange={e => edit(f => ({ ...f, comment: e.target.value }))} />}
        </Field>
      </section>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={o => !o && setConfirm(null)}
        title={t('docs.document.cancelTitle')}
        description={hasNumber ? t('docs.document.cancelKeepNumber', { title: docTitle(doc) }) : t('docs.document.cancelNoNumber')}
        confirmLabel={t('docs.document.cancelConfirm')}
        cancelLabel={t('docs.document.cancelKeep')}
        danger
        onConfirm={() => void run('cancel')}
      />
      <ConfirmDialog open={confirm === 'delete'} onOpenChange={o => !o && setConfirm(null)} title={t('docs.document.deleteTitleDoc')} description={t('docs.document.deleteHintDoc')} confirmLabel={t('docs.document.deleteConfirm')} cancelLabel={t('docs.document.cancelKeep')} danger onConfirm={() => void remove()} />
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
      onKeyDown={e => {
        onKeyDown(e);
        if (!e.defaultPrevented) handleNumericArrow(e);
      }}
    />
  );
}

export function DocRef({ d }: { d: DocLink }) {
  return (
    <span className="doc-ref">
      {/* у распределения материалов своя форма */}
      <Link className="crm-link" to={d.type === 'material_allocation' ? `/material-allocations/${d.id}` : `/documents/${d.id}`}>
        {typeLabel(d.type)} {d.number ?? '(draft)'}
      </Link>
      <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
      {d.total !== undefined && <span className="num muted">{money(d.total)}</span>}
    </span>
  );
}
