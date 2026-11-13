/* Смета объекта (задача 1269): вкладка карточки объекта — основная смета и допработы, редактор позиций по разделам,
   итоги, план-факт, согласование, импорт строк из таблицы и заказы из позиций. Себестоимость и маржу показывает сервер
   только owner/admin (в ответе null), поэтому колонки и итоги себестоимости скрываются по detail.canSeeCost.
   Импорт из docx: таблицу извлекает сервер, ИИ размечает строки задачей воркера — диалог показывает ревью разметки,
   без ИИ остаётся сопоставление колонок по извлечённой таблице. */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Copy, Ellipsis, Factory, Search, FileSpreadsheet, Handshake, Lock, LockOpen, Package, Plus, Save, Trash2, Truck, Undo2, UploadCloud, Wrench, X } from 'lucide-react';
import { computeEstimateTotals, dec, ESTIMATE_ITEM_KINDS, fmt, OBJECT_COST_CATEGORIES, priceFromMarkup, type EstimateItemKind, type EstimatePdfRegion, type ObjectCostCategory } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuTrigger, Select, Skeleton, Tab, Tabs, TabsContent, TabsList, Tooltip, toast } from '@/components/ui';
import { NumberField } from '@/components/gr8r/number-field';
import { fmtAmount, fmtDateTime, fmtNumber, useT, type TKey } from '@/i18n';
import { buildCategoryTree, useCategories, useCompanies, useProducts, useUnits } from '../catalog/data';
import { ProductFormDialog } from '../catalog/product-ui';
import { errorMessage } from '../data/api';
import { SECTIONS } from '../routes';
import { SpecParamFields } from '../docs/calculation';
import { call, useWsId } from '../meta/data';
import { useSession } from '../data/session';
import { productionKey } from '../production/data';
import { NewItemDialog } from '../production/NewItemDialog';
import type { Item as ManufacturedItem } from '../production/data';
import { CatalogPickDialog, ItemCard, ProductCard } from '../docs/position-field';
import { useObjectBudget, useObjectOptions } from './data';
import { useEstimate, useEstimateApi, useObjectEstimates, type EstimateDetail, type EstimateImportRow, type EstimateSummary } from './estimates-data';

const EstimatePdfPreview = React.lazy(() => import('./EstimatePdfPreview'));

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
/** Категории факта затрат объекта (задача 1270): ключ other назван otherCosts — 'other' ломает тип словаря */
const BUDGET_CATEGORY_LABEL: Record<ObjectCostCategory, TKey> = {
  material: 'objects.budget.category.material',
  labor: 'objects.budget.category.labor',
  subcontract: 'objects.budget.category.subcontract',
  other: 'objects.budget.category.otherCosts',
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

function useRun(onError?: (message: string | null) => void) {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError?.(null);
    try {
      await fn();
    } catch (e) {
      const message = errorMessage(e);
      if (onError) onError(message);
      else toast.error(message);
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
  // название сметы живёт в первом ряду — рядом с чипами смет, где уже есть номер и статус;
  // сохраняется само при уходе из поля
  const [title, setTitle] = React.useState('');
  // место справа от названия: туда редактор выводит единую наценку (портал), состояние наценки живёт в редакторе
  const [markupHost, setMarkupHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => { setTitle(detail.data?.name ?? ''); }, [detail.data?.id, detail.data?.name]);
  const saveTitle = async () => {
    const d = detail.data;
    const value = title.trim();
    if (!d || !value || value === d.name || d.status === 'approved' || !canWrite) {
      setTitle(d?.name ?? '');
      return;
    }
    try {
      await api.save(d.id, { name: value });
    } catch (e) {
      setTitle(d.name);
      toast.error(errorMessage(e));
    }
  };

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
        <Input
          className="est-title"
          aria-label={tt('estimates.name')}
          disabled={!canWrite || detail.data?.status === 'approved'}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
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
        {detail.data?.approvedByName && <span className="faint">{detail.data.approvedByName}</span>}
        {detail.data?.parent && <span className="faint mono">{detail.data.parent.number}</span>}
        <div ref={setMarkupHost} style={{ marginLeft: 'auto' }} />
      </div>

      {detail.isPending && <Skeleton w="100%" h={200} />}
      {detail.isError && <p className="faint">{errorMessage(detail.error)}</p>}
      {detail.data && <EstimateEditor detail={detail.data} canWrite={canWrite} isAdmin={isAdmin} markupHost={markupHost} />}

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
  manufacturedItemId: string | null;
  /** Название позиции каталога или изделия: в смете строку можно назвать по-своему */
  catalogName: string | null;
  unitCode: string;
  qty: string;
  price: string;
  costPrice: string;
  /** Поставщик (материал, субподряд) и замок строки — только owner/admin */
  supplierId: string | null;
  locked: boolean;
  laborHours: string;
  /** Выполненный объём (задача 1272) */
  doneQty: string;
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
    manufacturedItemId: i.manufacturedItemId,
    catalogName: i.productName ?? i.manufacturedItemName,
    unitCode: i.unitCode,
    qty: trim(i.qty),
    price: trim(i.price),
    costPrice: i.costPrice == null ? '' : trim(i.costPrice),
    supplierId: i.supplierId,
    locked: !!i.locked,
    laborHours: trim(i.laborHours),
    doneQty: trim(i.doneQty),
    sectionKey: i.sectionId,
  })),
});

const ESTIMATE_KIND_ICON = { work: Wrench, material: Package, panel: Factory, subcontract: Handshake, other: Ellipsis };

const usesCatalog = (kind: EstimateItemKind) => kind === 'material' || kind === 'subcontract';
const NO_SUPPLIER = '__none';

/** Цена строки от себестоимости и единой наценки; null — не пересчитывать (замок, нет наценки или себестоимости) */
const autoPrice = (row: { costPrice: string; locked: boolean }, markup: string): string | null =>
  // строку без себестоимости (пусто или 0) не пересчитываем — иначе наценка обнулит введённую руками цену
  row.locked || !markup.trim() || !num(row.costPrice) || dec(num(row.costPrice)) <= 0n ? null : priceFromMarkup(num(row.costPrice), num(markup));

/** Строка с новой себестоимостью: цена пересчитывается по наценке, если строка не заблокирована */
const withCost = (r: RowDraft, costPrice: string, markup: string): RowDraft => {
  const next = { ...r, costPrice };
  const price = autoPrice(next, markup);
  return price == null ? next : { ...next, price: trim(price) };
};
const catalogNameKey = (name: string) => name.trim().toLowerCase();

function uniqueCatalogNames(items: readonly { id: string; name: string }[]) {
  const matches = new Map<string, string | null>();
  for (const item of items) {
    const key = catalogNameKey(item.name);
    matches.set(key, matches.has(key) ? null : item.id);
  }
  return matches;
}

function EstimateCellMenu({ value, label, children, options, onChange }: {
  value: string;
  label: string;
  children: React.ReactNode;
  options: { value: string; label: string; icon?: React.ReactNode }[];
  onChange?: (value: string) => void;
}) {
  if (!onChange) return <Tooltip content={label}><span tabIndex={0} aria-label={label} className="inline-flex">{children}</span></Tooltip>;
  return (
    <Menu>
      <Tooltip content={label}>
        <MenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={label}>{children}</Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent>
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map(option => (
            <MenuRadioItem key={option.value} value={option.value} icon={option.icon}>{option.label}</MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function EstimateEditor({ detail, canWrite, isAdmin, markupHost }: { detail: EstimateDetail; canWrite: boolean; isAdmin: boolean; markupHost: HTMLElement | null }) {
  // факт затрат объекта (задача 1270) считается по категориям, а не по позициям сметы
  const budget = useObjectBudget(detail.objectId);
  const tt = useT();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const units = useUnits();
  const [draft, setDraft] = React.useState(() => toDraft(detail));
  // единая наценка, %: пусто — не задана (цены не пересчитываются)
  const [markup, setMarkup] = React.useState(() => trim(detail.markupPct));
  const companies = useCompanies();
  const [dirty, setDirty] = React.useState(false);
  // раздел правится по клику по названию: сначала текст, потом поле ввода
  const [editingSection, setEditingSection] = React.useState<string | null>(null);
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null);
  // меню строки: подбор из каталога и заказ на производство по одной строке
  const [pickingFor, setPickingFor] = React.useState<string | null>(null);
  // карточка позиции каталога по клику на подсказку «В каталоге: …»
  const [cardFor, setCardFor] = React.useState<{ kind: 'product' | 'item'; id: string } | null>(null);
  const [orderingFor, setOrderingFor] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<'import' | 'supplier' | 'production' | 'remove' | null>(null);
  const signature = `${detail.id}:${detail.updatedAt}`;
  const loaded = React.useRef(signature);

  React.useEffect(() => {
    if (loaded.current === signature) return;
    loaded.current = signature;
    setDraft(toDraft(detail));
    setMarkup(trim(detail.markupPct));
    setDirty(false);
  }, [signature, detail]);

  const editable = canWrite && detail.status === 'draft';
  const ws = useWsId();
  const products = useProducts({ active: true }, { enabled: editable && draft.rows.some(row => usesCatalog(row.kind) && !row.productId && row.name.trim()), all: true });
  const manufactured = useQuery({
    queryKey: productionKey(ws, 'estimate-items'),
    enabled: editable && draft.rows.some(row => row.kind === 'panel' && !row.manufacturedItemId && row.name.trim()),
    queryFn: async () => {
      const items: { id: string; name: string }[] = [];
      for (let offset = 0; ; ) {
        const page = await call<{ items: { id: string; name: string }[]; total: number }>(ws, 'GET', `/manufactured-items?limit=200&offset=${offset}`);
        items.push(...page.items);
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) return items;
      }
    },
  });
  const catalogMatches = React.useMemo(() => uniqueCatalogNames(products.data ?? []), [products.data]);
  const manufacturedMatches = React.useMemo(() => uniqueCatalogNames(manufactured.data ?? []), [manufactured.data]);
  const productFor = (row: RowDraft) => row.productId ?? catalogMatches.get(catalogNameKey(row.name)) ?? null;
  const manufacturedFor = (row: RowDraft) => row.manufacturedItemId ?? manufacturedMatches.get(catalogNameKey(row.name)) ?? null;
  const newLinks = editable && draft.rows.some(row =>
    (usesCatalog(row.kind) && !row.productId && !!productFor(row)) ||
    (row.kind === 'panel' && !row.manufacturedItemId && !!manufacturedFor(row)),
  );
  const creatingRow = editable ? draft.rows.find(row => row.key === creatingFor) : undefined;
  const pickingRow = editable ? draft.rows.find(row => row.key === pickingFor) : undefined;
  const categories = useCategories(!!creatingRow && usesCatalog(creatingRow.kind));
  const unitOptions = (units.data ?? []).map(u => ({ value: u.code, label: `${u.code} · ${u.name}` }));
  const kindOptions = ESTIMATE_ITEM_KINDS.map(value => {
    const Icon = ESTIMATE_KIND_ICON[value];
    return { value, label: tt(KIND_LABEL[value]), icon: <Icon size={14} aria-hidden /> };
  });

  const change = (fn: (d: { sections: SectionDraft[]; rows: RowDraft[] }) => { sections: SectionDraft[]; rows: RowDraft[] }) => {
    setDraft(d => fn(d));
    setDirty(true);
  };
  const patchRow = (key: string, patch: Partial<RowDraft>) => change(d => ({ ...d, rows: d.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) }));
  const addRow = (sectionKey: string | null) =>
    change(d => ({
      ...d,
      rows: [...d.rows, { key: uid(), kind: 'work', name: '', productId: null, manufacturedItemId: null, catalogName: null, unitCode: '796', qty: '1', price: '0', costPrice: '', supplierId: null, locked: false, laborHours: '', doneQty: '0', sectionKey }],
    }));
  // себестоимость строки правят руками (замок не ставится), цена пересчитывается по наценке
  const patchCost = (key: string, costPrice: string) => change(d => ({ ...d, rows: d.rows.map(r => (r.key === key ? withCost(r, costPrice, markup) : r)) }));
  // единая наценка: цена всех незаблокированных строк с себестоимостью
  const changeMarkup = (value: string) => {
    setMarkup(value);
    change(d => ({ ...d, rows: d.rows.map(r => { const price = autoPrice(r, value); return price == null ? r : { ...r, price: trim(price) }; }) }));
  };
  // себестоимость из цен поставщика (вид цен поставщика на сегодня); нет цены — подсказка, себестоимость не трогаем
  const fillFromSupplier = async (key: string, supplierId: string, productId: string | null) => {
    if (!productId) return;
    try {
      const { items } = await api.supplierPrices(supplierId, [productId]);
      const hit = items.find(x => x.productId === productId);
      if (!hit) return void toast(tt('estimates.noSupplierPrice'));
      // к моменту ответа строку могли заблокировать или сменить поставщика
      change(d => ({ ...d, rows: d.rows.map(r => (r.key !== key || r.locked || r.supplierId !== supplierId ? r : withCost(r, trim(hit.price), markup))) }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const setSupplier = (r: RowDraft, supplierId: string | null) => {
    patchRow(r.key, { supplierId });
    if (supplierId && !r.locked) void fillFromSupplier(r.key, supplierId, productFor(r));
  };
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
      await api.saveItems(detail.id, {
        sections: draft.sections.map(s => ({ id: s.key, name: s.name.trim() })),
        items: draft.rows.map(r => ({
          id: r.key,
          sectionId: r.sectionKey,
          kind: r.kind,
          name: r.name.trim(),
          productId: usesCatalog(r.kind) ? productFor(r) : null,
          unitCode: r.unitCode,
          qty: num(r.qty) || '0',
          price: num(r.price) || '0',
          costPrice: num(r.costPrice) || '0',
          ...(detail.canSeeCost ? { supplierId: usesCatalog(r.kind) ? r.supplierId : null, locked: r.locked } : {}),
          laborHours: num(r.laborHours) || '0',
          doneQty: num(r.doneQty) || '0',
          manufacturedItemId: r.kind === 'panel' ? manufacturedFor(r) : null,
        })),
        ...(detail.canSeeCost ? { markupPct: markup.trim() ? num(markup) : null } : {}),
      });
      setDirty(false);
      toast(tt('estimates.saved'), { duration: 1500 });
    });
  };

  const colCount = 7 + (detail.canSeeCost ? 3 : 0) + (editable ? 1 : 0);

  const renderRow = (r: RowDraft, n: number) => {
    const line = computeEstimateTotals([{ kind: r.kind, qty: num(r.qty) || '0', price: num(r.price) || '0', costPrice: detail.canSeeCost ? num(r.costPrice) || '0' : '0', laborHours: num(r.laborHours) || '0' }]);
    const KindIcon = ESTIMATE_KIND_ICON[r.kind];
    const unit = units.data?.find(candidate => candidate.code === r.unitCode);
    const linked = usesCatalog(r.kind) ? r.productId : r.kind === 'panel' ? r.manufacturedItemId : null;
    const matched = usesCatalog(r.kind) ? productFor(r) : r.kind === 'panel' ? manufacturedFor(r) : null;
    const missing = !matched && (usesCatalog(r.kind) || r.kind === 'panel');
    const searching = usesCatalog(r.kind) ? products.isLoading : manufactured.isLoading;
    // заказ на производство по строке: только сохранённый «щит» со связанным изделием и количеством
    const pickable = editable && (usesCatalog(r.kind) || r.kind === 'panel');
    const orderable = canWrite && r.kind === 'panel';
    const saved = detail.items.find(i => i.id === r.key);
    // заказы берутся из ответа сервера: черновик строк не перечитывается после создания заказа
    const orders = saved?.productionOrders ?? [];
    const showCatalog = !!linked && !!r.catalogName && r.catalogName.trim().toLowerCase() !== r.name.trim().toLowerCase();
    const orderBlock: TKey | null = dirty || newLinks ? 'estimates.saveFirst'
      : !saved?.manufacturedItemId ? 'estimates.noProductionItem'
      : dec(saved.qty) <= 0n ? 'estimates.noQty' : null;
    const canOrder = !busy && !orderBlock;
    return (
      <tr key={r.key}>
        <td className="faint num">
          <div className="flex items-center gap-1">
            {detail.canSeeCost && (
              <IconButton size="sm" className="shrink-0" label={tt(r.locked ? 'estimates.unlockRow' : 'estimates.lockRow')} disabled={!editable} onClick={() => patchRow(r.key, { locked: !r.locked })}>
                {r.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              </IconButton>
            )}
            <span>{n}</span>
          </div>
        </td>
        <td>
          <EstimateCellMenu
            value={r.kind}
            label={tt(KIND_LABEL[r.kind])}
            options={kindOptions}
            onChange={editable ? value => {
              const kind = value as EstimateItemKind;
              patchRow(r.key, {
                kind,
                productId: usesCatalog(kind) ? r.productId : null,
                manufacturedItemId: kind === 'panel' ? r.manufacturedItemId : null,
                catalogName: (usesCatalog(kind) && r.productId) || (kind === 'panel' && r.manufacturedItemId) ? r.catalogName : null,
              });
            } : undefined}
          >
            <KindIcon size={16} aria-hidden />
          </EstimateCellMenu>
        </td>
        <td>
          <div className="flex items-center gap-1">
            {/* связанная (или найденная) в каталоге строка — текст: в смете её не правят, а подбирают; клик открывает карточку позиции */}
            {(linked || matched) ? (
              <button
                type="button"
                className="min-w-0 flex-1 text-left hover:underline"
                title={tt('docs.pickers.openCard', { name: r.name })}
                onClick={() => setCardFor(usesCatalog(r.kind) ? { kind: 'product', id: (linked || matched)! } : { kind: 'item', id: (linked || matched)! })}
              >{r.name}</button>
            ) : !editable ? <span className="min-w-0 flex-1">{r.name}</span> : (
              <Input
                className="cell-input min-w-0 flex-1"
                aria-label={tt('estimates.columns.name')}
                invalid={missing && !searching && !!r.name.trim()}
                value={r.name}
                onChange={e => patchRow(r.key, { name: e.target.value })}
              />
            )}
            {editable && missing && (
              <IconButton
                size="sm"
                className="shrink-0"
                label={tt(r.kind === 'panel' ? 'production.list.newProduct' : 'catalog.newProduct')}
                disabled={!r.name.trim() || searching}
                onClick={() => setCreatingFor(r.key)}
              ><Plus size={14} /></IconButton>
            )}
            {(pickable || orderable) && (
              <Menu>
                <MenuTrigger asChild>
                  <IconButton size="sm" className="shrink-0" label={tt('estimates.rowActions')}><Ellipsis size={14} /></IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  {pickable && <MenuItem icon={<Search size={14} />} onSelect={() => setPickingFor(r.key)}>{tt('estimates.pick')}</MenuItem>}
                  {orderable && (
                    <MenuItem icon={<Factory size={14} />} disabled={!canOrder} onSelect={() => setOrderingFor(r.key)}>
                      {tt('estimates.actions.productionOrder')}
                      {orderBlock && <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>{tt(orderBlock)}</span>}
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            )}
          </div>
          {(showCatalog || orders.length > 0) && (
            // строка подсказки: название из каталога слева, заказы на производство у правого края цветом ссылки
            <div className="flex items-start gap-2" style={{ fontSize: 11 }}>
              <span className="faint min-w-0 flex-1" style={{ whiteSpace: 'normal' }}>{showCatalog ? (
                  <button type="button" className="hover:underline text-left" title={tt('docs.pickers.openCard', { name: r.catalogName! })} onClick={() => setCardFor(r.productId ? { kind: 'product', id: r.productId } : r.manufacturedItemId ? { kind: 'item', id: r.manufacturedItemId } : null)}>
                    {tt('estimates.catalogName', { name: r.catalogName! })}
                  </button>
                ) : null}</span>
              {orders.map(o => (
                <Link key={o.id} className="link shrink-0" style={{ whiteSpace: 'nowrap' }} to={`${SECTIONS.productionOrders.path}/${o.id}`}>
                  {tt('estimates.orderLink', { number: o.number ?? '—' })}
                </Link>
              ))}
            </div>
          )}
        </td>
        {detail.canSeeCost && (
          <td>
            {usesCatalog(r.kind) ? (
              editable ? (
                <Select
                  size="sm"
                  aria-label={tt('estimates.columns.supplier')}
                  value={r.supplierId ?? NO_SUPPLIER}
                  onValueChange={v => setSupplier(r, v === NO_SUPPLIER ? null : v)}
                  options={[{ value: NO_SUPPLIER, label: tt('estimates.supplierNone') }, ...(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))]}
                />
              ) : <span>{companies.data?.find(c => c.id === r.supplierId)?.name ?? ''}</span>
            ) : null}
          </td>
        )}
        <td>
          <EstimateCellMenu value={r.unitCode} label={unit?.name ?? r.unitCode} options={unitOptions} onChange={editable ? value => patchRow(r.key, { unitCode: value }) : undefined}>
            <span>{unit?.symbol || unit?.name || r.unitCode}</span>
          </EstimateCellMenu>
        </td>
        <td>{editable ? <NumberField decimal min={0} aria-label={tt('estimates.columns.qty')} value={r.qty} onChange={v => patchRow(r.key, { qty: String(v) })} className="cell-num" style={{ width: 100 }} /> : fmtNumber(num(r.qty))}</td>
        <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.price')} value={r.price} onChange={e => patchRow(r.key, { price: e.target.value })} /> : fmtAmount(r.price)}</td>
        <td className="r num">{fmtAmount(line.revenue)}</td>
        {detail.canSeeCost && (
          <td>{editable ? <input className="input cell-input r" inputMode="decimal" aria-label={tt('estimates.columns.costPrice')} value={r.costPrice} onChange={e => patchCost(r.key, e.target.value)} /> : fmtAmount(r.costPrice)}</td>
        )}
        {detail.canSeeCost && <td className="r num">{fmtAmount(line.cost)}</td>}
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
      {detail.canSeeCost && markupHost && createPortal(
        <div className="row" style={{ gap: 6, alignItems: 'center' }} title={tt('estimates.markupHint')}>
          <span className="faint" style={{ fontSize: 12 }}>{tt('estimates.markup')}</span>
          {markup === '' ? (
            editable && <Button size="sm" variant="ghost" onClick={() => { setMarkup('0'); setDirty(true); }}>{tt('estimates.markupSet')}</Button>
          ) : (
            <>
              <NumberField decimal min={-100} aria-label={tt('estimates.markup')} value={markup} disabled={!editable} onChange={v => changeMarkup(String(v))} style={{ width: 110 }} />
              {editable && <IconButton size="sm" label={tt('estimates.markupClear')} onClick={() => { setMarkup(''); setDirty(true); }}><X size={13} /></IconButton>}
            </>
          )}
        </div>,
        markupHost,
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {editable && (
          <Button variant="primary" disabled={busy || (!dirty && !newLinks)} onClick={() => void save()}><Save size={14} />{tt('estimates.actions.save')}</Button>
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
        {(dirty || newLinks) && <span className="faint" style={{ alignSelf: 'center' }}>{tt('estimates.unsaved')}</span>}
      </div>

      {detail.status === 'approved' && <p className="faint" style={{ fontSize: 12 }}>{tt('estimates.approved')} {tt('estimates.approvedPrices')}</p>}
      {!detail.canSeeCost && <p className="faint" style={{ fontSize: 12 }}>{tt('estimates.hiddenCosts')}</p>}

      <div className="table-wrap">
        <table className="dtbl" aria-label={tt('estimates.title')}>
          <thead>
            <tr>
              <th style={{ width: detail.canSeeCost ? 72 : 40 }}>{tt('estimates.columns.num')}</th>
              <th style={{ width: 52 }}>{tt('estimates.columns.kind')}</th>
              <th style={{ minWidth: 280 }}>{tt('estimates.columns.name')}</th>
              {detail.canSeeCost && <th style={{ minWidth: 220 }}>{tt('estimates.columns.supplier')}</th>}
              <th style={{ width: 80 }}>{tt('estimates.columns.unit')}</th>
              <th style={{ width: 120 }} className="r">{tt('estimates.columns.qty')}</th>
              <th style={{ width: 110 }} className="r">{tt('estimates.columns.price')}</th>
              <th style={{ width: 120 }} className="r">{tt('estimates.columns.amount')}</th>
              {detail.canSeeCost && <th style={{ width: 110 }} className="r">{tt('estimates.columns.costPrice')}</th>}
              {detail.canSeeCost && <th style={{ width: 120 }} className="r">{tt('estimates.columns.cost')}</th>}
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
                      {editingSection === s.key ? (
                        <input
                          className="input cell-input"
                          autoFocus
                          aria-label={tt('estimates.sectionName')}
                          value={s.name}
                          onChange={e => change(d => ({ ...d, sections: d.sections.map(x => (x.key === s.key ? { ...x, name: e.target.value } : x)) }))}
                          onBlur={() => setEditingSection(null)}
                          onKeyDown={e => { if (e.key === 'Enter') setEditingSection(null); }}
                        />
                      ) : editable ? (
                        <b
                          role="button"
                          tabIndex={0}
                          className="sec-name sec-name-edit"
                          onClick={() => setEditingSection(s.key)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setEditingSection(s.key); }}
                        >{s.name}</b>
                      ) : (
                        <b className="sec-name">{s.name}</b>
                      )}
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
              <td colSpan={3} className="r"><b>{tt('estimates.total')}</b></td>
              {detail.canSeeCost && <td />}
              <td />
              <td />
              <td />
              <td className="r num"><b>{fmtAmount(totals.revenue)}</b></td>
              {detail.canSeeCost && <td />}
              {detail.canSeeCost && <td className="r num"><b>{fmtAmount(totals.cost)}</b></td>}
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
        {detail.canSeeCost && budget.data?.hasEstimate && (
          <div className="panel" style={{ padding: 12, minWidth: 260 }}>
            <div className="faint" style={{ fontSize: 12 }}>{tt('estimates.factByCategory')}</div>
            <table className="dtbl" aria-label={tt('estimates.factByCategory')}>
              <thead>
                <tr>
                  <th>{tt('objects.budget.column.category')}</th>
                  <th className="r">{tt('objects.budget.column.fact')}</th>
                  <th className="r">{tt('objects.budget.column.rest')}</th>
                </tr>
              </thead>
              <tbody>
                {OBJECT_COST_CATEGORIES.map(cat => {
                  const c = budget.data!.categories[cat];
                  return (
                    <tr key={cat}>
                      <td>{tt(BUDGET_CATEGORY_LABEL[cat])}</td>
                      <td className="r num">{c.fact == null ? '—' : fmtAmount(c.fact)}</td>
                      <td className={c.over ? 'r num neg' : 'r num'}>{c.rest == null ? '—' : fmtAmount(c.rest)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="faint" style={{ fontSize: 11 }}>{tt('estimates.factByCategoryHint')}</div>
          </div>
        )}
      </div>

      {creatingRow && usesCatalog(creatingRow.kind) && (
        <ProductFormDialog
          tree={buildCategoryTree(categories.data ?? [])}
          initialCategory={null}
          initialName={creatingRow.name.trim()}
          initialUnitCode={creatingRow.unitCode}
          onClose={() => setCreatingFor(null)}
          onCreated={product => {
            patchRow(creatingRow.key, { name: product.name, productId: product.id, catalogName: product.name, unitCode: product.unitCode });
            setCreatingFor(null);
          }}
        />
      )}
      {creatingRow?.kind === 'panel' && (
        <NewItemDialog
          initialName={creatingRow.name.trim()}
          initialUnitCode={creatingRow.unitCode}
          onClose={() => setCreatingFor(null)}
          onCreated={item => {
            patchRow(creatingRow.key, { name: item.name, manufacturedItemId: item.id, catalogName: item.name, unitCode: item.unitCode });
            setCreatingFor(null);
          }}
        />
      )}
      {dialog === 'import' && <ImportDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {dialog === 'supplier' && <SupplierOrderDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {dialog === 'production' && <ProductionOrderDialog estimateId={detail.id} onClose={() => setDialog(null)} />}
      {orderingFor && (() => {
        const row = draft.rows.find(r => r.key === orderingFor);
        return row ? <RowProductionOrderDialog estimateId={detail.id} row={row} onClose={() => setOrderingFor(null)} /> : null;
      })()}
      {pickingRow && (
        (() => {
          // своё наименование в смете сохраняется, пустое — берётся из каталога
          const apply = (hit: { kind: 'product' | 'item'; id: string; name: string; unitCode: string }) =>
            patchRow(pickingRow.key, {
              name: pickingRow.name.trim() ? pickingRow.name : hit.name,
              catalogName: hit.name,
              unitCode: hit.unitCode,
              ...(hit.kind === 'product' ? { productId: hit.id } : { manufacturedItemId: hit.id }),
            });
          // подбор товара в строку с поставщиком: себестоимость из его цен (замок — не трогаем)
          const afterPick = (hit: { kind: 'product' | 'item'; id: string }) => {
            if (hit.kind === 'product' && pickingRow.supplierId && !pickingRow.locked) void fillFromSupplier(pickingRow.key, pickingRow.supplierId, hit.id);
          };
          const close = () => setPickingFor(null);
          return usesCatalog(pickingRow.kind) ? (
            <CatalogPickDialog mode="product" price="purchasePrice" initialQuery={pickingRow.name.trim()} onClose={close} onPick={p => { apply({ kind: 'product', id: p.id, name: p.name, unitCode: p.unitCode }); afterPick({ kind: 'product', id: p.id }); }} />
          ) : (
            <CatalogPickDialog mode="item" initialQuery={pickingRow.name.trim()} onClose={close} onPick={i => apply({ kind: 'item', id: i.id, name: i.name, unitCode: i.unitCode })} />
          );
        })()
      )}
      {cardFor?.kind === 'product' && <ProductCard id={cardFor.id} onClose={() => setCardFor(null)} />}
      {cardFor?.kind === 'item' && <ItemCard id={cardFor.id} onClose={() => setCardFor(null)} />}
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

/** Строка ревью ИИ-разметки: редактируемая копия в диалоге (include — галочка импорта, skipReason — почему ИИ пропустил;
    page — страница PDF, откуда строка) */
interface AiRowView {
  rowNo: number;
  page: number;
  include: boolean;
  section: string;
  kind: EstimateItemKind | '';
  name: string;
  unit: string;
  qty: string;
  price: string;
  costPrice: string;
  laborHours: string;
  skipReason: string;
}

const DOC_POLL_MS = 1500;
/** ~3 минуты на разметку ИИ (большая смета генерируется 1–2 минуты); дольше — fallback на сопоставление колонок */
const DOC_POLL_LIMIT = 120;

function ImportDialog({ estimateId, onClose }: { estimateId: string; onClose: () => void }) {
  const tt = useT();
  const api = useEstimateApi();
  const [importError, setImportError] = React.useState<string | null>(null);
  const { busy, run } = useRun(setImportError);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const [preview, setPreview] = React.useState<{ header: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = React.useState<Record<ImportField, number | ''>>({ section: '', kind: '', name: '', unit: '', qty: '', price: '', costPrice: '', laborHours: '' });
  // разметка ИИ документа: строки ревью или null — сопоставление колонок (XLSX/CSV и fallback docx/pdf)
  const [aiRows, setAiRows] = React.useState<AiRowView[] | null>(null);
  const [aiNote, setAiNote] = React.useState('');
  const [docWaiting, setDocWaiting] = React.useState(false);
  type DocStatus = Awaited<ReturnType<typeof api.importDocStatus>>;
  const [docProgress, setDocProgress] = React.useState<Pick<DocStatus, 'status' | 'job' | 'aiError' | 'error'> | null>(null);
  const [retryId, setRetryId] = React.useState<string | null>(null);
  // PDF разобран, ждёт выбора страниц и подсказки (фаза B), затем extractDocument запустит разметку
  const [pdfPick, setPdfPick] = React.useState<{ id: string; pageCount: number; hasText: boolean } | null>(null);
  const [pdfFile, setPdfFile] = React.useState<File | null>(null);
  const [pageFrom, setPageFrom] = React.useState('1');
  const [pageTo, setPageTo] = React.useState('1');
  const [hint, setHint] = React.useState('');
  // часть страниц без текстового слоя (смешанные документы): их содержимое в разбор не попало
  const [ocrWarn, setOcrWarn] = React.useState(false);
  // разметка ещё идёт, но окно опроса исчерпано (медленный ИИ): кнопка «Дождаться разметки» продолжает опрос
  const [waitingId, setWaitingId] = React.useState<string | null>(null);
  // «документ как его видит разбор»: исходный markdown постранично (fallback без ИИ)
  const [docId, setDocId] = React.useState<string | null>(null);
  const [docIsPdf, setDocIsPdf] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('data');
  const workspaceId = useWsId();
  const sourceQuery = useQuery({
    queryKey: ['ws', workspaceId, 'estimate-import-source', docId],
    queryFn: () => api.importDocSource(docId!),
    enabled: activeTab === 'markdown' && docIsPdf && !!docId,
    staleTime: Infinity,
    retry: false,
  });
  const applyDoc = (doc: Awaited<ReturnType<typeof api.importDocStatus>>) => {
    const visual = doc.meta?.visual === true;
    const failed = doc.status !== 'pending' && !doc.aiResult?.rows.length;
    setRetryId(failed && !visual ? doc.id : null);
    if (failed && visual && pdfFile && typeof doc.meta?.pageCount === 'number') {
      setPdfPick({ id: doc.id, pageCount: doc.meta.pageCount, hasText: false });
    }
    setPreview(visual ? null : { header: doc.table.header, rows: doc.table.rows });
    setMap(Object.fromEntries(IMPORT_FIELDS.map(field => [field, guessColumn(doc.table.header, field)])) as Record<ImportField, number | ''>);
    setOcrWarn(!visual && Array.isArray(doc.meta?.pagesNeedingOcr) && doc.meta.pagesNeedingOcr.length > 0);
    setDocId(doc.id);
    setDocIsPdf(typeof doc.meta?.pageCount === 'number');
    // опрос исчерпан, а разметка ещё идёт — дадим кнопку «Дождаться разметки» вместо тупика
    setWaitingId(doc.status === 'pending' ? doc.id : null);
    if (doc.status === 'done' && doc.aiResult?.rows.length) {
      setAiNote('');
      setActiveTab('data');
      setAiRows(
        doc.aiResult.rows.map(r => ({
          rowNo: r.rowNo,
          page: r.page ?? 0,
          include: !r.skip,
          section: r.section ?? '',
          kind: r.kind ?? '',
          name: r.name,
          unit: r.unit ?? '',
          qty: r.qty,
          price: r.price,
          costPrice: r.costPrice ?? '',
          laborHours: r.laborHours ?? '',
          skipReason: r.skipReason ?? '',
        })),
      );
    } else {
      // ИИ не настроен, не ответил или не нашёл позиций — сопоставление колонок по извлечённой таблице
      setAiRows(null);
      setAiNote(doc.status === 'pending' || doc.aiError || doc.error || doc.status === 'failed' ? '' : tt(visual
        ? 'estimates.importPdfRecognitionFailed'
        : doc.status === 'done' ? 'estimates.importAiNoResult' : 'estimates.importAiFailed'));
    }
  };
  const pollDoc = async (id: string) => {
    setWaitingId(id);
    let doc = await api.importDocStatus(id);
    setDocProgress(doc);
    setWaitingId(doc.status === 'pending' ? doc.id : null);
    for (let i = 0; i < DOC_POLL_LIMIT && doc.status === 'pending'; i++) {
      await new Promise(r => setTimeout(r, DOC_POLL_MS));
      doc = await api.importDocStatus(id);
      setDocProgress(doc);
    }
    applyDoc(doc);
  };
  const pick = (f: File | null) =>
    void run(async () => {
      if (!f) return;
      if (!/\.(xlsx|csv|docx|pdf)$/i.test(f.name)) {
        setImportError(tt('errors.import_file_invalid'));
        return;
      }
      setFileName(f.name);
      setAiRows(null);
      setDocProgress(null);
      setRetryId(null);
      setPreview(null);
      setAiNote('');
      setPdfPick(null);
      setPdfFile(null);
      setOcrWarn(false);
      setWaitingId(null);
      setActiveTab('data');
      setDocIsPdf(false);
      if (!/\.(docx|pdf)$/i.test(f.name)) {
        const p = await api.importPreview(f);
        setPreview(p);
        setMap(Object.fromEntries(IMPORT_FIELDS.map(field => [field, guessColumn(p.header, field)])) as Record<ImportField, number | ''>);
        return;
      }
      setDocWaiting(true);
      try {
        const created = await api.importDocument(f, estimateId);
        if (created.status === 'ready') {
          // PDF: сервер разобрал документ постранично — сначала выбор страниц и подсказка, потом разметка
          setPageFrom('1');
          setPageTo(String(created.pageCount ?? 1));
          setHint('');
          setActiveTab('pdf');
          setPdfFile(f);
          setPdfPick({ id: created.id, pageCount: created.pageCount ?? 1, hasText: created.hasText !== false });
          setDocId(created.id);
          setDocIsPdf(true);
          return;
        }
        // docx: таблица извлечена на сервере сразу, ИИ размечает строки задачей воркера — опрашиваем статус
        await pollDoc(created.id);
      } finally {
        setDocWaiting(false);
      }
    });
  const runExtract = (renderRegions?: () => Promise<EstimatePdfRegion[]>) =>
    void run(async () => {
      if (!pdfPick) return;
      const regions = await renderRegions?.();
      setDocWaiting(true);
      try {
        // диапазон страниц в массив номеров; «все страницы» — pages не передаём
        const from = Math.min(pdfPick.pageCount, Math.max(1, Math.floor(Number(pageFrom) || 1)));
        const to = Math.min(pdfPick.pageCount, Math.max(from, Math.floor(Number(pageTo) || pdfPick.pageCount)));
        const all = from === 1 && to === pdfPick.pageCount;
        const pages = all || regions ? undefined : Array.from({ length: to - from + 1 }, (_, i) => from + i);
        setDocProgress(null);
        const res = await api.extractDocument(pdfPick.id, { pages, regions, hint: hint.trim() || undefined });
        setPdfPick(null);
        await pollDoc(res.id);
      } finally {
        setDocWaiting(false);
      }
    });
  const cell = (row: string[], field: ImportField) => {
    const c = map[field];
    return c === '' ? '' : (row[c] ?? '');
  };
  // строки из сопоставления колонок (прежний путь: XLSX/CSV и docx без разметки ИИ)
  const mappedRows: EstimateImportRow[] = React.useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .map(row => {
        const kindText = cell(row, 'kind').trim().toLowerCase();
        const kind = (ESTIMATE_ITEM_KINDS as readonly string[]).find(k => k === kindText || (k === 'panel' && kindText === 'щит') || tt(KIND_LABEL[k as EstimateItemKind]).toLowerCase() === kindText) as EstimateItemKind | undefined;
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
  // выбранные строки ревью ИИ
  const aiSelected: EstimateImportRow[] = React.useMemo(
    () =>
      (aiRows ?? [])
        .filter(r => r.include && r.name.trim())
        .map(r => ({
          section: r.section.trim() || undefined,
          kind: r.kind || undefined,
          name: r.name.trim(),
          unit: r.unit.trim() || undefined,
          qty: num(r.qty) || '0',
          price: num(r.price) || '0',
          costPrice: num(r.costPrice) || undefined,
          laborHours: num(r.laborHours) || undefined,
        })),
    [aiRows],
  );
  const rows = aiRows ? aiSelected : mappedRows;
  const ready = aiRows ? rows.length > 0 : map.name !== '' && map.qty !== '' && map.price !== '';
  const setAi = (i: number, patch: Partial<AiRowView>) => setAiRows(rs => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // номера колонок для сопоставления: по заголовку или (PDF) по самой широкой строке
  const columnOptions = React.useMemo(() => {
    if (!preview) return [] as number[];
    const width = Math.max(preview.header.length, ...preview.rows.slice(0, 500).map(r => r.length));
    return Array.from({ length: Math.min(width, 40) }, (_, i) => i);
  }, [preview]);
  const recognitionError = docProgress?.aiError || docProgress?.error || docProgress?.job?.error;
  const recognitionFailed = docProgress && docProgress.status !== 'pending' &&
    (docProgress.aiError || docProgress.error || docProgress.status === 'failed');
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        style={{ maxWidth: 1280 }}
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
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.docx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label={tt('estimates.importFile')}
            hidden
            disabled={busy}
            onChange={e => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) pick(file);
            }}
          />
          {fileName ? (
            <div className="flex flex-wrap items-center gap-2">
              <strong style={{ overflowWrap: 'anywhere' }}>{fileName}</strong>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                {tt('estimates.importFileReplace')}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className={dragOver ? 'dropzone w-full over' : 'dropzone w-full'}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              onDragOver={e => {
                e.preventDefault();
                if (e.dataTransfer.types.includes('Files')) setDragOver(true);
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
              }}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                if (busy) return;
                const files = e.dataTransfer.files;
                if (files.length > 1) setImportError(tt('estimates.importFileSingle'));
                else if (files[0]) pick(files[0]);
              }}
            >
              <UploadCloud size={18} aria-hidden />
              <span>{tt('estimates.importFileDrop')}</span>
            </button>
          )}
          {importError && <Alert tone="danger">{importError}</Alert>}
          {docWaiting && !docProgress && <p role="status" className="faint">{tt('estimates.importAiWaiting')}</p>}
          {docProgress?.status === 'pending' && (
            <p role="status" className="faint">
              {docProgress.job?.status === 'queued' && docProgress.job.attempt > 0
                ? tt('estimates.importAiRetrying', {
                  attempt: Math.min(docProgress.job.attempt + 1, docProgress.job.maxAttempts),
                  max: docProgress.job.maxAttempts, time: fmtDateTime(docProgress.job.retryAt),
                })
                : docProgress.job?.status === 'running'
                  ? tt('estimates.importAiProcessing', { attempt: docProgress.job.attempt, max: docProgress.job.maxAttempts })
                  : tt('estimates.importAiQueued')}
            </p>
          )}
          {(recognitionFailed || recognitionError) && (
            <Alert tone="danger" title={recognitionFailed ? tt('estimates.importAiRequestFailed') : undefined}>
              {recognitionError && (
                <details>
                  <summary>{tt('estimates.importAiErrorDetails')}</summary>
                  <p style={{ overflowWrap: 'anywhere' }}>{recognitionError}</p>
                </details>
              )}
            </Alert>
          )}
          {retryId && (
            <Button disabled={busy} onClick={() => void run(async () => {
              setDocWaiting(true);
              setDocProgress(null);
              setRetryId(null);
              try {
                const res = await api.extractDocument(retryId, { hint: hint.trim() || undefined });
                await pollDoc(res.id);
              } catch (error) {
                setRetryId(retryId);
                throw error;
              } finally {
                setDocWaiting(false);
              }
            })}>{tt('estimates.importAiRetry')}</Button>
          )}
          {aiNote && <Alert tone="danger">{aiNote}</Alert>}
          {waitingId && !docWaiting && (
            <Button variant="primary" onClick={() => void run(async () => {
              setDocWaiting(true);
              try {
                await pollDoc(waitingId);
              } finally {
                setDocWaiting(false);
              }
            })}>{tt('estimates.importWaitMore')}</Button>
          )}
          <Tabs value={activeTab} onValueChange={setActiveTab} activationMode="manual">
            <TabsList aria-label={tt('estimates.importPreview')}>
              <Tab value="pdf" disabled={!pdfFile}>{tt('estimates.importTabPdf')}</Tab>
              <Tab value="markdown" disabled={!docIsPdf || !docId}>{tt('estimates.importTabMarkdown')}</Tab>
              <Tab value="data">{tt('estimates.importTabData')}</Tab>
            </TabsList>
            <TabsContent value="pdf" forceMount hidden={activeTab !== 'pdf'} style={{ marginTop: 12 }}>
              <div className="stack" style={{ gap: 12 }}>
                {pdfFile && docId && (
                  <React.Suspense fallback={<p role="status">{tt('estimates.importPdfLoading')}</p>}>
                    <EstimatePdfPreview key={docId} file={pdfFile} disabled={busy} onRecognize={pdfPick ? runExtract : undefined} />
                  </React.Suspense>
                )}
                {pdfPick && !docWaiting && (
                  <>
                    <Field label={tt('estimates.importHintLabel')}>
                      {p => <Input id={p.id} placeholder={tt('estimates.importHintPlaceholder')} value={hint} maxLength={1000} disabled={busy} onChange={e => setHint(e.target.value)} />}
                    </Field>
                    {pdfPick.hasText && (
                      <>
                        <p className="faint">{tt('estimates.importPdfPagesNote', { count: pdfPick.pageCount })}</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8 }}>
                          <Field label={tt('estimates.importPdfPagesFrom')}>
                            {p => <Input id={p.id} type="number" min={1} max={pdfPick.pageCount} value={pageFrom} disabled={busy} onChange={e => setPageFrom(e.target.value)} />}
                          </Field>
                          <Field label={tt('estimates.importPdfPagesTo')}>
                            {p => <Input id={p.id} type="number" min={1} max={pdfPick.pageCount} value={pageTo} disabled={busy} onChange={e => setPageTo(e.target.value)} />}
                          </Field>
                          <Button variant="secondary" disabled={busy} onClick={() => runExtract()}>{tt('estimates.importMarkUp')}</Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </TabsContent>
            <TabsContent value="markdown" style={{ marginTop: 12 }}>
              {sourceQuery.isPending && <p role="status" className="faint">{tt('estimates.importMarkdownLoading')}</p>}
              {sourceQuery.isError && (
                <Alert
                  tone="danger"
                  action={<Button size="sm" disabled={sourceQuery.isFetching} onClick={() => void sourceQuery.refetch()}>{tt('estimates.importMarkdownRetry')}</Button>}
                >
                  {errorMessage(sourceQuery.error)}
                </Alert>
              )}
              {sourceQuery.data && (
                <div className="table-wrap" style={{ minWidth: 0, maxHeight: '55vh', overflow: 'auto' }}>
                  {sourceQuery.data.pages.length === 0 && <p className="faint">{tt('estimates.importMarkdownEmpty')}</p>}
                  {sourceQuery.data.pages.map(page => (
                    <div key={page.page} style={{ marginBottom: 12 }}>
                      <p className="faint">{tt('estimates.importSourcePage', { n: page.page })}</p>
                      <pre style={{ whiteSpace: 'pre', overflowWrap: 'normal', margin: 0, fontSize: 12 }}>{page.markdown}</pre>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="data" style={{ marginTop: 12 }}>
              {!aiRows && !preview && <p className="faint">{tt(docIsPdf ? 'estimates.importDataWaiting' : 'estimates.importDataEmpty')}</p>}
              <div className="stack" style={{ gap: 12 }}>
                {aiRows ? (
                  <>
                    <p className="faint">{tt('estimates.importAiHint')}</p>
                    {ocrWarn && <p className="faint">{tt('estimates.importPdfOcrWarn')}</p>}
                    <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                      <table className="dtbl" aria-label={tt('estimates.importPreview')}>
                        <thead>
                          <tr>
                            <th style={{ width: 36 }} />
                            {aiRows.some(r => r.page) && <th style={{ width: 44 }}>{tt('estimates.importPageCol')}</th>}
                            <th>{tt('estimates.columns.name')}</th>
                            <th style={{ width: 180 }}>{tt('estimates.columns.kind')}</th>
                            <th style={{ width: 80 }}>{tt('estimates.columns.unit')}</th>
                            <th style={{ width: 90 }} className="r">{tt('estimates.columns.qty')}</th>
                            <th style={{ width: 120 }} className="r">{tt('estimates.columns.price')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiRows.slice(0, 200).map((r, i) => (
                            <tr key={r.rowNo} style={r.include ? undefined : { opacity: 0.45 }}>
                              <td><Checkbox checked={r.include} aria-label={tt('estimates.importApply')} onChange={e => setAi(i, { include: e.target.checked })} /></td>
                              {aiRows.some(x => x.page) && <td className="faint num">{r.page || ''}</td>}
                              <td>
                                <Input value={r.name} onChange={e => setAi(i, { name: e.target.value })} aria-label={tt('estimates.columns.name')} />
                                {!r.include && r.skipReason && <div className="faint">{r.skipReason}</div>}
                              </td>
                              <td>
                                <Select
                                  value={r.kind}
                                  onValueChange={v => setAi(i, { kind: (v || '') as EstimateItemKind | '' })}
                                  options={[{ value: '', label: '—' }, ...ESTIMATE_ITEM_KINDS.map(k => ({ value: k, label: tt(KIND_LABEL[k]) }))]}
                                />
                              </td>
                              <td><Input value={r.unit} onChange={e => setAi(i, { unit: e.target.value })} aria-label={tt('estimates.columns.unit')} /></td>
                              <td className="r"><Input className="num" value={r.qty} onChange={e => setAi(i, { qty: e.target.value })} aria-label={tt('estimates.columns.qty')} /></td>
                              <td className="r"><Input className="num" value={r.price} onChange={e => setAi(i, { price: e.target.value })} aria-label={tt('estimates.columns.price')} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="faint">{tt('estimates.importRows', { count: aiSelected.length })}</p>
                  </>
                ) : preview && (
                  <>
                    {ocrWarn && <p className="faint">{tt('estimates.importPdfOcrWarn')}</p>}
                    <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                      {IMPORT_FIELDS.map(field => (
                        <Field key={field} label={`${tt(IMPORT_FIELD_LABEL[field])} (${tt(`estimates.importColumn`).toLowerCase()} ${field})`}>
                          {p => (
                            <Select
                              id={p.id}
                              value={map[field] === '' ? '' : String(map[field])}
                              onValueChange={v => setMap(m => ({ ...m, [field]: v === '' ? '' : Number(v) }))}
                              // у PDF заголовок пуст: колонки строим по самой широкой строке таблицы
                              options={[{ value: '', label: tt('estimates.importNone') }, ...columnOptions.map(i => ({ value: String(i), label: `${i + 1}. ${preview.header[i] || '—'}` }))]}
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
                          </tr>
                        </thead>
                        <tbody>
                          {mappedRows.slice(0, 100).map((r, i) => (
                            <tr key={i}>
                              <td className="faint num">{i + 1}</td>
                              <td>{r.section ? <span className="muted">{r.section} · </span> : null}{r.name}</td>
                              <td className="r num">{fmtNumber(r.qty)}</td>
                              <td className="r num">{fmtAmount(r.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="faint">{tt('estimates.importRows', { count: mappedRows.length })}</p>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
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
              await api.productionOrder(estimateId, { ...(comment.trim() ? { comment: comment.trim() } : {}) });
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

/** Заказ на производство по одной строке «щит»: спецификация (все товара строки), её параметры, количество и комментарий */
function RowProductionOrderDialog({ estimateId, row, onClose }: { estimateId: string; row: RowDraft; onClose: () => void }) {
  const tt = useT();
  const ws = useWsId();
  const api = useEstimateApi();
  const { busy, run } = useRun();
  const baseId = row.manufacturedItemId!;
  const base = useQuery({ queryKey: productionKey(ws, 'estimate-order-item', baseId), queryFn: () => call<ManufacturedItem>(ws, 'GET', `/manufactured-items/${baseId}`) });
  const productId = base.data?.productId ?? null;
  const siblings = useQuery({
    queryKey: productionKey(ws, 'estimate-order-specs', productId),
    enabled: !!productId,
    queryFn: async () => (await call<{ items: ManufacturedItem[] }>(ws, 'GET', `/manufactured-items?productId=${productId}&limit=200`)).items,
  });
  // спецификации того же товара без недействительных и разборочных; само изделие строки — всегда в списке
  const specs = React.useMemo(() => {
    if (!base.data) return [];
    const list = (siblings.data ?? []).filter(i => !i.isInvalid && i.mode !== 'disassembly');
    return list.some(i => i.id === base.data!.id) ? list : [base.data, ...list];
  }, [base.data, siblings.data]);
  const [itemId, setItemId] = React.useState(baseId);
  const [qty, setQty] = React.useState(row.qty);
  const [comment, setComment] = React.useState('');
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const spec = specs.find(i => i.id === itemId) ?? null;
  const loading = base.isPending || (!!productId && siblings.isPending);
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== ''));
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={tt('estimates.productionRowTitle')}
        description={tt('estimates.productionRowHint')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{tt('common.cancel')}</Button>
            <Button variant="primary" disabled={busy || loading || !spec || !(Number(qty) > 0)} onClick={() => void run(async () => {
              await api.productionOrder(estimateId, {
                ...(comment.trim() ? { comment: comment.trim() } : {}),
                lines: [{ estimateItemId: row.key, manufacturedItemId: itemId, qty: String(qty), ...(Object.keys(clean).length ? { params: clean } : {}) }],
              });
              toast(tt('estimates.orderCreated'), { duration: 2000 });
              onClose();
            })}>{tt('estimates.createOrder')}</Button>
          </>
        }
      >
        {loading ? <Skeleton w="100%" h={28} /> : (
          <div className="contents">
            <Field label={tt('estimates.productionProduct')}>{() => <span>{base.data?.name ?? row.name}</span>}</Field>
            <Field label={tt('estimates.productionSpec')}>
              {p => (
                <select
                  className="select"
                  id={p.id}
                  value={itemId}
                  onChange={e => { setItemId(e.target.value); setValues({}); }}
                >
                  {specs.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              )}
            </Field>
            {(spec?.params.length ?? 0) > 0 && <SpecParamFields params={spec!.params} values={values} onChange={setValues} />}
            <Field label={tt('estimates.columns.qty')}>{p => <NumberField {...p} decimal min={0} value={qty} onChange={v => setQty(String(v))} />}</Field>
            <Field label={tt('estimates.comment')}>{p => <Input {...p} value={comment} onChange={e => setComment(e.target.value)} />}</Field>
          </div>
        )}
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
