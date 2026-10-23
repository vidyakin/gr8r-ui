/* Экран продукции: шапка (код, тип, единица, партия, накладные), дерево спецификации с раскрытием полуфабрикатов
   (материал / полуфабрикат / работа) и итог внизу. Любая правка строки пересчитывает дерево и итоги мгновенно:
   расчёт идёт на клиенте функцией computeBomCost, сервер подтверждает запись следом. */
import * as React from 'react';
import { handleNumericArrow } from '@/lib/numeric-step';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Boxes, ChevronRight, CircleAlert, Ellipsis, ExternalLink, GripVertical, Layers, Package, Pencil, Plus, Printer, Trash2, Wrench } from 'lucide-react';
import { dec, div, fmt, mul, type CostLine, type CostNode } from '@gr8r/shared';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '../pages/PlaceholderPage';
import { useCanWrite } from '../meta/custom-fields';
import { API_BASE } from '../data/api';
import { useWsId } from '../meta/data';
import { money, unitSymbol, useUnits, type Unit } from '../catalog/data';
import { UnitSelect } from '../catalog/product-ui';
import { PRICE_SOURCE_LABEL, useCosting, useExplosion, useProductionMutations, useSnapshot, type BomLine, type Item, type Material, type NeedRow, type ProductionMutations, type Snapshot, type WorkCenter } from './data';
import { t, useT } from '@/i18n';
import { LineDialog } from './line-dialog';
import { ParamEditor } from './params-editor';

const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const qtyText = (v: string) => trimZeros(Number(v).toFixed(3));

interface Ctx {
  snap: Snapshot;
  units: Unit[] | undefined;
  mats: Map<string, Material>;
  centers: Map<string, WorkCenter>;
  items: Map<string, Item>;
  tt: ReturnType<typeof useT>;
}

/** Строка дерева: стоимость и количество приведены к вкладу в партию корневого изделия */
interface Flat {
  /** overhead — строка накладных раскрытого полуфабриката (после его строк) */
  type: 'line' | 'overhead';
  key: string;
  depth: number;
  line: BomLine;
  cost: CostLine;
  /** Масштаб вложенных строк: сколько партий полуфабриката входит в партию родителя */
  scale: bigint;
  child?: CostNode;
  /** Масштаб строк внутри этого полуфабриката: scale × qty / партия полуфабриката */
  childScale: bigint;
  expandable: boolean;
}

function lineTitle(line: BomLine, c: Ctx) {
  if (line.kind === 'material' || line.kind === 'expense' || line.kind === 'output') return c.mats.get(line.productId ?? '')?.name ?? c.tt('production.item.unknownMaterial');
  if (line.kind === 'semi') return c.items.get(line.childItemId ?? '')?.name ?? c.tt('production.item.unknownProduct');
  return line.operation || c.tt('production.item.operationLabel');
}

function detail(line: BomLine, c: Ctx) {
  if (line.kind === 'output') {
    return (
      <span className="faint">
        {line.costShare ? c.tt('production.item.costShare', { pct: trimZeros(line.costShare) }) : c.tt('production.item.costShareSale')}
        {line.qtyExpr && <> · {c.tt('production.item.formula', { expr: line.qtyExpr })}</>}
        {line.condition && <> · {c.tt('production.item.condIf', { cond: line.condition })}</>}
      </span>
    );
  }
  if (line.kind === 'material' || line.kind === 'expense') {
    const m = c.mats.get(line.productId ?? '');
    const src = c.snap.settings.materialPriceSource;
    const price = m ? (src === 'price' ? m.price : src === 'avg_cost' ? (m.avgCost ?? m.purchasePrice) : m.purchasePrice) : '0';
    return (
      <span className="faint">
        {Number(line.scrapPct) > 0 && <>{c.tt('production.item.scrap', { pct: trimZeros(line.scrapPct) })} · </>}{c.tt('production.item.atPrice', { price: money(price) })}
        {line.qtyExpr && <> · {c.tt('production.item.formula', { expr: line.qtyExpr })}</>}
        {line.condition && <> · {c.tt('production.item.condIf', { cond: line.condition })}</>}
      </span>
    );
  }
  if (line.kind === 'semi') {
    const child = c.items.get(line.childItemId ?? '');
    return <span className="faint">{c.tt('production.item.bomBatchOf', { qty: child ? qtyText(child.batchQty) : '?' })}</span>;
  }
  const rate = line.rate ?? c.centers.get(line.workCenterId ?? '')?.hourlyRate ?? '0';
  const center = c.centers.get(line.workCenterId ?? '');
  return (
    <span className="faint">
      {center && <>{center.name} · </>}
      {Number(line.hours) > 0 && <>{t('production.common.perHour', { amount: money(rate) })}</>}
      {Number(line.fixedCost ?? 0) > 0 && <>{Number(line.hours) > 0 ? ' + ' : ''}{c.tt('production.item.fixedCost', { amount: money(line.fixedCost) })}</>}
    </span>
  );
}

const KIND_ICON = { material: Package, semi: Layers, work: Wrench, expense: Package, output: Package } as const;

/** Печатная форма спецификации: готовая HTML-страница открывается в новом окне и печатается */
export function printSpec(ws: string, itemId: string, form: 'short' | 'expanded') {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write('<p style="font:13px sans-serif">Loading…</p>');
  fetch(`${API_BASE()}/manufactured-items/${itemId}/print/${form}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } })
    .then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `Request failed (${r.status})`);
      return r.text();
    })
    .then(html => {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
    })
    .catch(e => {
      win.document.write(`<p style="font:13px sans-serif">${e instanceof Error ? e.message : String(e)}</p>`);
    });
}

export function ItemPage() {
  const { id } = useParams();
  const snap = useSnapshot();
  if (snap.isPending)
    return (
      <div className="page wide">
        <Skeleton w={240} h={26} />
      </div>
    );
  if (snap.isError)
    return (
      <div className="page wide">
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.item.loadFailed')} action={<Button size="sm" onClick={() => snap.refetch()}>{t('production.common.retry')}</Button>}>
          {(snap.error as Error).message}
        </EmptyState>
      </div>
    );
  const item = snap.data.items.find(i => i.id === id);
  if (!item) return <NotFoundPage />;
  return <ItemScreen key={item.id} snap={snap.data} item={item} />;
}

function ItemScreen({ snap, item }: { snap: Snapshot; item: Item }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const ws = useWsId();
  const unitsQ = useUnits();
  const m = useProductionMutations();
  const tt = useT();
  const costing = useCosting(snap)!;
  const { tree, error } = costing(item.id);
  // вид производства изделия: этапы, на которых расходуются материалы и выполняются операции
  const kind = snap.kinds.find(k => k.id === item.productionKindId) ?? null;
  const stageName = (id: string | null) => (id ? (kind?.stages.find(x => x.id === id)?.name ?? null) : null);
  const [dialog, setDialog] = React.useState<{ kind: BomLine['kind']; line?: BomLine } | null>(null);
  const [removing, setRemoving] = React.useState<BomLine | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [needOn, setNeedOn] = React.useState(false);
  const [needQty, setNeedQty] = React.useState('1');
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(item.lines.filter(l => l.kind === 'semi').map(l => l.id)));
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const ctx: Ctx = React.useMemo(
    () => ({ snap, units: unitsQ.data, mats: new Map(snap.materials.map(x => [x.id, x])), centers: new Map(snap.workCenters.map(x => [x.id, x])), items: new Map(snap.items.map(x => [x.id, x])), tt }),
    [snap, unitsQ.data, tt],
  );

  // Потребность в материалах: остатки считает сервер, поэтому запрос отдельный
  const need = useExplosion(needOn ? item.id : undefined, needQty, null);
  const needRows: NeedRow[] = React.useMemo(() => (need.data ? [...need.data.materials, ...need.data.semis] : []), [need.data]);

  // Плоский список видимых строк: корневые строки и раскрытые полуфабрикаты (только чтение)
  const flat = React.useMemo(() => {
    if (!tree) return [] as Flat[];
    const out: Flat[] = [];
    const walk = (node: CostNode, lines: BomLine[], depth: number, scale: bigint, prefix: string) => {
      for (const l of lines) {
        const cl = node.lines.find(x => x.id === l.id);
        if (!cl) continue;
        const key = `${prefix}${l.id}`;
        const childItem = l.kind === 'semi' ? ctx.items.get(l.childItemId ?? '') : undefined;
        const childScale = childItem ? div(mul(scale, dec(l.qty)), dec(childItem.batchQty)) : 0n;
        out.push({ type: 'line', key, depth, line: l, cost: cl, scale, child: cl.child, childScale, expandable: l.kind === 'semi' && !!cl.child });
        if (childItem && cl.child && open.has(key)) {
          walk(cl.child, childItem.lines, depth + 1, childScale, `${key}/`);
          if (Number(cl.child.overheadPct) > 0) out.push({ type: 'overhead', key: `${key}#overhead`, depth: depth + 1, line: l, cost: cl, scale, child: cl.child, childScale, expandable: false });
        }
      }
    };
    walk(tree, item.lines, 0, dec('1'), '');
    return out;
  }, [tree, item.lines, open, ctx.items]);

  const toggle = (key: string) =>
    setOpen(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allKeys = () => {
    const keys: string[] = [];
    const walk = (lines: BomLine[], prefix: string, depthLeft: number) => {
      for (const l of lines) {
        if (l.kind !== 'semi' || !l.childItemId || depthLeft <= 0) continue;
        keys.push(`${prefix}${l.id}`);
        walk(ctx.items.get(l.childItemId)?.lines ?? [], `${prefix}${l.id}/`, depthLeft - 1);
      }
    };
    walk(item.lines, '', 8);
    return keys;
  };

  const move = (id: string, delta: number) => {
    const ids = item.lines.map(l => l.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    m.reorder.mutate({ itemId: item.id, ids });
  };
  const drop = (target: string) => {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (!from || from === target) return;
    const ids = item.lines.map(l => l.id).filter(x => x !== from);
    ids.splice(ids.indexOf(target), 0, from);
    m.reorder.mutate({ itemId: item.id, ids });
  };

  const unit = unitSymbol(unitsQ.data, item.unitCode);
  const batch = Number(item.batchQty);
  const missing = tree ? countMissing(tree) : 0;
  const parents = snap.items.filter(i => i.lines.some(l => l.childItemId === item.id));

  return (
    <div className="page wide bom-page">
      <div className="bom-crumb">
        <Link to="/production" className="crm-link">
          {tt('production.section.production')}
        </Link>
        <ChevronRight size={13} className="faint" />
        <span className="muted">{item.kind === 'semi' ? tt('production.line.kind.semi') : tt('production.line.kind.material')}</span>
      </div>
      <div className="ph" style={{ marginBottom: 12 }}>
        <div className="grow" style={{ minWidth: 260 }}>
          <input
            className="ttl-edit bom-title"
            aria-label={tt('production.field.name')}
            defaultValue={item.name}
            readOnly={!canWrite}
            onBlur={e => {
              const v = e.currentTarget.value.trim();
              if (v && v !== item.name) m.updateItem.mutate({ id: item.id, patch: { name: v } });
              else e.currentTarget.value = item.name;
            }}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <p>
            {item.code && <span className="mono">{item.code} · </span>}
            {tt('production.item.bomForBatch', { qty: qtyText(item.batchQty), unit })}
            {parents.length > 0 && (
              <>
                {' · '}
                {tt('production.item.bomUsedIn')}{' '}
                {parents.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {i > 0 && ', '}
                    <Link to={`/production/${p.id}`} className="crm-link">
                      {p.name}
                    </Link>
                  </React.Fragment>
                ))}
              </>
            )}
          </p>
        </div>
        <div className="acts">
          <Button variant={needOn ? 'primary' : 'secondary'} aria-pressed={needOn} onClick={() => setNeedOn(v => !v)}>
            <Boxes size={14} />
            {tt('production.section.needs')}
          </Button>
          {canWrite && (
            <>
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="primary">
                    <Plus size={14} />
                    {tt('production.item.addLine')}
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  {item.mode === 'disassembly' ? (
                    <>
                      <MenuItem icon={<Package size={15} />} onSelect={() => setDialog({ kind: 'output' })}>
                        {tt('production.line.kind.output')}
                      </MenuItem>
                      <MenuItem icon={<Wrench size={15} />} onSelect={() => setDialog({ kind: 'work' })}>
                        {tt('production.line.kind.work')}
                      </MenuItem>
                    </>
                  ) : (
                    <>
                      <MenuItem icon={<Package size={15} />} onSelect={() => setDialog({ kind: 'material' })}>
                        {tt('production.line.kind.material')}
                      </MenuItem>
                      <MenuItem icon={<Layers size={15} />} onSelect={() => setDialog({ kind: 'semi' })}>
                        {tt('production.line.kind.semi')}
                      </MenuItem>
                      <MenuItem icon={<Wrench size={15} />} onSelect={() => setDialog({ kind: 'work' })}>
                        {tt('production.line.kind.work')}
                      </MenuItem>
                      <MenuItem icon={<Package size={15} />} onSelect={() => setDialog({ kind: 'expense' })}>
                        {tt('production.line.kind.expense')}
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label={tt('production.item.more')} tooltip={false}>
                    <Ellipsis size={16} />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<Printer size={15} />} onSelect={() => printSpec(ws, item.id, 'short')}>
                    {tt('production.item.printShort')}
                  </MenuItem>
                  <MenuItem icon={<Printer size={15} />} onSelect={() => printSpec(ws, item.id, 'expanded')}>
                    {tt('production.item.printExpanded')}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setDeleting(true)}>
                    {tt('production.item.archive')}
                  </MenuItem>
                </MenuContent>
              </Menu>
            </>
          )}
        </div>
      </div>

      <div className="bom-params" aria-label={tt('production.params.title')}>
        <label>
          <span className="label">{tt('production.field.type')}</span>
          <select className="select" value={item.kind} disabled={!canWrite} aria-label={tt('production.field.type')} onChange={e => m.updateItem.mutate({ id: item.id, patch: { kind: e.target.value } })}>
            <option value="product">{tt('production.line.kind.material')}</option>
            <option value="semi">{tt('production.line.kind.semi')}</option>
          </select>
        </label>
        <label>
          <span className="label">{tt('production.line.fields.kind')}</span>
          <select className="select" value={item.mode ?? 'assembly'} disabled={!canWrite} aria-label={tt('production.line.fields.kind')} onChange={e => m.updateItem.mutate({ id: item.id, patch: { mode: e.target.value } })}>
            <option value="assembly">{tt('productionEnums.operation.assembly')}</option>
            <option value="disassembly">{tt('productionEnums.operation.disassembly')}</option>
          </select>
        </label>
        <label>
          <span className="label">{tt('production.field.code')}</span>
          <ParamInput label={tt('production.field.code')} value={item.code} disabled={!canWrite} onCommit={v => m.updateItem.mutate({ id: item.id, patch: { code: v } })} />
        </label>
        <label>
          <span className="label">{tt('production.field.unit')}</span>
          {canWrite ? <UnitSelect value={item.unitCode} onChange={unitCode => m.updateItem.mutate({ id: item.id, patch: { unitCode } })} /> : <span>{unit}</span>}
        </label>
        <label>
          <span className="label">{tt('production.item.batchQty')}</span>
          <ParamInput label={tt('production.item.batchQty')} numeric value={qtyText(item.batchQty)} disabled={!canWrite} onCommit={v => Number(v) > 0 && m.updateItem.mutate({ id: item.id, patch: { batchQty: Number(v) } })} />
        </label>
        <label>
          <span className="label">{tt('productionEnums.componentKind.material')}, %</span>
          <ParamInput label={tt('productionEnums.componentKind.material')} numeric value={trimZeros(Number(item.overheadPct).toFixed(2))} disabled={!canWrite} onCommit={v => Number(v) >= 0 && m.updateItem.mutate({ id: item.id, patch: { overheadPct: Number(v) } })} />
        </label>
        <label>
          <span className="label">{tt('production.item.bomLeadDays')}</span>
          <ParamInput label={tt('production.item.bomLeadDays')} numeric value={String(item.leadDays ?? 0)} disabled={!canWrite} onCommit={v => Number(v) >= 0 && m.updateItem.mutate({ id: item.id, patch: { leadDays: Number(v) } })} />
        </label>
        <label>
          <span className="label">{tt('production.stages.title')}</span>
          <select className="select" value={item.productionKindId ?? ''} disabled={!canWrite} aria-label={tt('production.stages.title')} onChange={e => m.updateItem.mutate({ id: item.id, patch: { productionKindId: e.target.value || null } })}>
            <option value="">{tt('production.item.bomNoStages')}</option>
            {snap.kinds.map(k => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">{tt('production.item.bomNeedFor')}</span>
          <ParamInput label={tt('production.item.bomNeedFor')} numeric value={needQty} onCommit={v => Number(v) > 0 && setNeedQty(v)} />
        </label>
        <label>
          <span className="label">{tt('production.item.bomInvalid')}</span>
          <input type="checkbox" aria-label={tt('production.item.bomInvalid')} checked={!!item.isInvalid} disabled={!canWrite} onChange={e => m.updateItem.mutate({ id: item.id, patch: { isInvalid: e.currentTarget.checked } })} />
        </label>
      </div>

      <ParamEditor item={item} canWrite={canWrite} />

      {error && <Alert tone="danger" title={tt('production.item.bomCostLine')}>{error}</Alert>}

      <div className="bom" role="treegrid" aria-label={tt('production.item.bom')}>
        <div className="bom-row head" role="row">
          <span>
            {tt('production.item.bomLine')}{' '}
            {allKeys().length > 0 && (
              <button type="button" className="bom-link" onClick={() => setOpen(s => (allKeys().every(k => s.has(k)) ? new Set() : new Set(allKeys())))}>
                {allKeys().every(k => open.has(k)) ? tt('production.item.bomCollapseAll') : tt('production.item.bomExpandAll')}
              </button>
            )}
          </span>
          <span className="r">{tt('production.field.quantity')}</span>
          <span>{tt('production.field.unit')}</span>
          <span className="hide-s">{tt('production.field.note')}</span>
          <span className="r">{tt('production.field.cost')}</span>
          <span />
        </div>
        {flat.map(f => {
          if (f.type === 'overhead' && f.child)
            return (
              <div key={f.key} role="row" className="bom-row nested overhead" aria-level={f.depth + 1}>
                <span className="bom-name" style={{ paddingLeft: f.depth * 22 }}>
                  <span style={{ width: 14 }} />
                  <span style={{ width: 22 }} />
                  <span className="faint">
                    {tt('production.item.bomOverheadOf', { name: f.child.name, pct: trimZeros(Number(f.child.overheadPct).toFixed(2)) })}
                  </span>
                </span>
                <span />
                <span />
                <span className="hide-s" />
                <span className="r num faint">{money(fmt(mul(dec(f.child.batch.overhead), f.childScale), 2))}</span>
                <span />
              </div>
            );
          const l = f.line;
          const root = f.depth === 0;
          const I = KIND_ICON[l.kind];
          const isOpen = open.has(f.key);
          const scaledQty = fmt(mul(dec(l.kind === 'work' ? l.hours : l.qty), f.scale), 3);
          const scaledCost = fmt(mul(dec(f.cost.cost), f.scale), 2);
          const editable = root && canWrite;
          const kindLabelKey: Record<typeof l.kind, string> = {
            material: 'productionEnums.componentKind.material',
            semi: 'productionEnums.componentKind.semi',
            work: 'productionEnums.componentKind.work',
            expense: 'productionEnums.componentKind.expense',
            output: 'productionEnums.componentKind.output',
          };
          const kindLabel = t(kindLabelKey[l.kind] as any);
          return (
            <React.Fragment key={f.key}>
              <div
                role="row"
                data-kind={l.kind}
                data-line={l.id}
                aria-level={f.depth + 1}
                aria-expanded={f.expandable ? isOpen : undefined}
                className={cn('bom-row', !root && 'nested', dragId === l.id && 'dragging', overId === l.id && dragId !== l.id && 'drag-over')}
                draggable={editable}
                onDragStart={ev => {
                  ev.dataTransfer.effectAllowed = 'move';
                  ev.dataTransfer.setData('text/plain', l.id);
                  setDragId(l.id);
                }}
                onDragOver={ev => {
                  if (!dragId || !root) return;
                  ev.preventDefault();
                  setOverId(l.id);
                }}
                onDrop={ev => {
                  ev.preventDefault();
                  if (root) drop(l.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <span className="bom-name" style={{ paddingLeft: f.depth * 22 }}>
                  <span className="dm-grip" aria-hidden style={editable ? undefined : { visibility: 'hidden' }} title={editable ? tt('production.item.bomDragToReorder') : undefined}>
                    <GripVertical size={14} />
                  </span>
                  {f.expandable ? (
                    <button type="button" className="ibtn ibtn-xs" aria-label={t(isOpen ? 'production.common.collapse' : 'production.common.expand', { name: lineTitle(l, ctx) })} onClick={() => toggle(f.key)}>
                      <ChevronRight size={13} className={cn('chev', isOpen && 'open')} />
                    </button>
                  ) : (
                    <span style={{ width: 22 }} />
                  )}
                  <span className={cn('bom-ico', l.kind)} title={kindLabel}>
                    <I size={13} aria-label={kindLabel} />
                  </span>
                  <span className="trunc" style={{ fontWeight: root ? 450 : 400 }}>
                    {lineTitle(l, ctx)}
                  </span>
                  {f.cost.missingPrice && (
                    <Badge tone="amber" title={tt('production.item.bomMissingPriceHint', { source: PRICE_SOURCE_LABEL[snap.settings.materialPriceSource] })}>
                      <CircleAlert size={11} /> {tt('production.item.bomMissingPrice')}
                    </Badge>
                  )}
                  {root && l.stageId && stageName(l.stageId) && <Badge tone="gray">{stageName(l.stageId)}</Badge>}
                </span>
                <span className="r num">
                  {editable ? (
                    <QtyInput
                      label={l.kind === 'work' ? tt('production.item.bomHoursOf', { name: lineTitle(l, ctx) }) : tt('production.item.bomQtyOf', { name: lineTitle(l, ctx) })}
                      value={qtyText(l.kind === 'work' ? l.hours : l.qty)}
                      onCommit={v => m.updateLine.mutate({ id: l.id, itemId: item.id, patch: l.kind === 'work' ? { hours: v } : { qty: v } })}
                    />
                  ) : (
                    trimZeros(scaledQty)
                  )}
                </span>
                <span className="muted">{l.kind === 'work' ? t('production.common.hoursShort') : unitSymbol(unitsQ.data, l.unitCode ?? '')}</span>
                <span className="hide-s trunc">{detail(l, ctx)}</span>
                <span className="r num" style={{ fontWeight: root ? 500 : 400 }}>
                  {l.kind === 'output' ? <span className="faint">—</span> : root ? money(f.cost.cost) : money(scaledCost)}
                </span>
                <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                  {l.kind === 'semi' && l.childItemId && (
                    <Link to={`/production/${l.childItemId}`} className="ibtn ibtn-xs" aria-label={tt('production.item.openProductBom', { name: lineTitle(l, ctx) })} title={tt('production.item.bomOpenLine')}>
                      <ExternalLink size={13} />
                    </Link>
                  )}
                  {editable && (
                    <Menu>
                      <MenuTrigger asChild>
                        <button type="button" className="ibtn ibtn-xs" aria-label={`${tt('production.item.bomLineEdit')}: ${lineTitle(l, ctx)}`}>
                          <Ellipsis size={14} />
                        </button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem icon={<Pencil size={15} />} onSelect={() => setDialog({ kind: l.kind, line: l })}>
                          {tt('production.item.bomLineEdit')}
                        </MenuItem>
                        <MenuItem icon={<ArrowUp size={15} />} onSelect={() => move(l.id, -1)}>
                          {tt('production.item.bomLineMoveUp')}
                        </MenuItem>
                        <MenuItem icon={<ArrowDown size={15} />} onSelect={() => move(l.id, 1)}>
                          {tt('production.item.bomLineMoveDown')}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setRemoving(l)}>
                          {tt('production.item.bomLineRemove')}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                </span>
              </div>
            </React.Fragment>
          );
        })}
        {!item.lines.length && (
          <div className="bom-empty">
            <EmptyState
              icon={<Layers size={20} />}
              size="sm"
              title={tt('production.item.bomEmpty')}
              action={canWrite ? <Button size="sm" onClick={() => setDialog({ kind: item.mode === 'disassembly' ? 'output' : 'material' })}>{item.mode === 'disassembly' ? tt('production.item.bomAddOutput') : tt('production.item.bomAddMaterial')}</Button> : undefined}
            >
              {item.mode === 'disassembly' ? tt('production.item.bomDisassembly') : tt('production.item.bomAssembly')}
            </EmptyState>
          </div>
        )}
      </div>

      {needOn && (
        <section className="bom needs" aria-label={tt('production.item.bomNeeds')}>
          <div className="bom-row head" role="row">
            <span>{tt('production.field.need')}</span>
            <span className="r">{tt('production.field.need')}</span>
            <span>{tt('production.field.unit')}</span>
            <span className="hide-s">{tt('production.field.available')}</span>
            <span className="r">{tt('production.field.deficit')}</span>
            <span />
          </div>
          {need.isPending && (
            <div className="bom-row">
              <span className="faint">{tt('production.item.bomNeedsCalc')}</span>
            </div>
          )}
          {needRows.map(r => (
            <div key={`${r.kind}:${r.itemId ?? r.productId}`} className="bom-row" data-kind={r.kind}>
              <span className="bom-name">
                <span className={cn('bom-ico', r.kind)} title={r.kind === 'material' ? tt('productionEnums.componentKind.material') : tt('productionEnums.componentKind.semi')}>
                  {r.kind === 'material' ? <Package size={13} /> : <Layers size={13} />}
                </span>
                <span className="trunc">{r.name}</span>
                {r.kind === 'semi' && Number(r.produce) > 0 && <Badge tone="amber">{tt('production.item.bomNeedsProduce', { qty: qtyText(r.produce) })}</Badge>}
              </span>
              <span className="r num">{qtyText(r.qty)}</span>
              <span className="muted">{unitSymbol(unitsQ.data, r.unitCode ?? '')}</span>
              <span className="hide-s num">{qtyText(r.available)}</span>
              <span className={cn('r num', Number(r.deficit) > 0 && 'need-deficit')}>{qtyText(r.deficit)}</span>
              <span />
            </div>
          ))}
          {(need.data?.works ?? []).map((w, i) => (
            <div key={`w:${i}`} className="bom-row" data-kind="work">
              <span className="bom-name">
                <span className="bom-ico work" title={tt('productionEnums.componentKind.work')}>
                  <Wrench size={13} />
                </span>
                <span className="trunc">{w.operation}</span>
              </span>
              <span className="r num">{qtyText(w.hours)}</span>
              <span className="muted">{t('production.common.hoursShort')}</span>
              <span className="hide-s" />
              <span className="r" />
              <span />
            </div>
          ))}
          {need.data && !needRows.length && !need.data.works.length && (
            <div className="bom-empty">
              <EmptyState icon={<Boxes size={20} />} size="sm" title={tt('production.item.bomNeedsNothing')}>
                {tt('production.item.bomNeedsNothingHint')}
              </EmptyState>
            </div>
          )}
        </section>
      )}

      {tree && (
        <section className="bom-total" aria-label={tt('production.item.bomCostSumTitle')}>
          <table className="bom-sum">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" className="r">
                  {tt('production.item.bomCostSumHeaderBatch', { qty: qtyText(item.batchQty), unit })}
                </th>
                <th scope="col" className="r">
                  {tt('production.item.bomCostSumHeaderUnit', { unit })}
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [tt('production.item.bomCostPartMaterials'), 'materials'],
                  [tt('production.item.bomCostPartWorks'), 'works'],
                  [tt('production.item.bomCostPartOverhead'), 'overhead'],
                ] as const
              ).map(([label, k]) => (
                <tr key={k} data-part={k}>
                  <th scope="row">{label}</th>
                  <td className="r num">{money(tree.batch[k])}</td>
                  <td className="r num">{money(tree.unit[k])}</td>
                </tr>
              ))}
              <tr className="sum">
                <th scope="row">{tt('production.item.bomCostTotal')}</th>
                <td className="r num">{money(tree.batch.total)}</td>
                <td className="r num">{money(tree.unit.total)}</td>
              </tr>
            </tbody>
          </table>
          <div className="bom-unit" aria-live="polite">
            <span className="muted">{tt('production.item.bomCostOfUnit', { unit })}</span>
            <b data-testid="unit-cost" className="num">
              {money(tree.unit.total)}
            </b>
            {batch !== 1 && <span className="faint">{tt('production.item.bomBatchCosts', { qty: qtyText(item.batchQty), amount: money(tree.batch.total) })}</span>}
            <span className="faint">
              {tt('production.item.bomPriceSource', { source: PRICE_SOURCE_LABEL[snap.settings.materialPriceSource] })}{' '}
              <Link to="/settings/production" className="crm-link">{tt('production.item.bomChangePriceSource')}</Link>
            </span>
            {missing > 0 && (
              <span className="bom-warn">
                <CircleAlert size={13} /> {missing === 1 ? tt('production.item.bomNoPriceLabel', { count: missing }) : tt('production.item.bomNoPriceLabelPlural', { count: missing })}
              </span>
            )}
          </div>
        </section>
      )}

      {dialog && <LineDialog kind={dialog.kind} item={item} line={dialog.line} snap={snap} m={m} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title={tt('production.item.bomLineRemoveTitle')}
        description={removing ? <><b>{lineTitle(removing, ctx)}</b> {tt('production.item.willBeRemoved')}.</> : undefined}
        confirmLabel={tt('production.item.bomLineRemove')}
        cancelLabel={tt('production.common.cancel')}
        onConfirm={() => {
          if (removing) m.removeLine.mutate({ id: removing.id, itemId: item.id });
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        danger
        title={tt('production.item.archiveTitle')}
        description={<><b>{item.name}</b> {tt('production.item.willBeArchived')}.</>}
        confirmLabel={tt('production.item.archive')}
        cancelLabel={tt('production.common.cancel')}
        onConfirm={async () => {
          try {
            await m.removeItem.mutateAsync(item.id);
            toast(tt('production.item.archived', { name: item.name }));
            navigate('/production');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
          setDeleting(false);
        }}
      />
    </div>
  );
}

function countMissing(n: CostNode): number {
  return n.lines.reduce((s, l) => s + (l.missingPrice ? 1 : 0) + (l.child ? countMissing(l.child) : 0), 0);
}

/** Поле параметра: черновик, значение уходит по Enter или потере фокуса */
function ParamInput({ value, onCommit, label, numeric, disabled }: { value: string; onCommit: (v: string) => void; label: string; numeric?: boolean; disabled?: boolean }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return (
    <input
      className="input"
      aria-label={label}
      inputMode={numeric ? 'decimal' : undefined}
      disabled={disabled}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => v.trim() !== value && (v.trim() === '' && numeric ? setV(value) : onCommit(v.trim()))}
      onKeyDown={e => (e.key === 'Enter' ? e.currentTarget.blur() : numeric && handleNumericArrow(e))}
    />
  );
}

/** Количество в строке: правка на месте, пересчёт идёт сразу после Enter или потери фокуса */
function QtyInput({ value, onCommit, label }: { value: string; onCommit: (v: number) => void; label: string }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) return setV(value);
    if (n !== Number(value)) onCommit(n);
  };
  return <input className="input bom-qty" inputMode="decimal" aria-label={label} value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => (e.key === 'Enter' ? e.currentTarget.blur() : handleNumericArrow(e))} />;
}

export type { ProductionMutations };
