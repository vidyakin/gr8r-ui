/* Production: список продукции (изделия и полуфабрикаты) с себестоимостью единицы, считаемой на клиенте. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, Factory, Layers, Package, Plus } from 'lucide-react';
import { MANUFACTURED_KINDS } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Segmented, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { t, tEnum } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { money, unitSymbol, useUnits } from '../catalog/data';
import { UnitSelect } from '../catalog/product-ui';
import { useCosting, useProductionMutations, useSnapshot, type Item } from './data';

const KIND_LABEL = { product: 'Product', semi: 'Semi-finished' } as const;
const kindLabel = (k: keyof typeof KIND_LABEL) => tEnum('productionKind', k, KIND_LABEL[k]);

export function ProductionPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const snap = useSnapshot();
  const units = useUnits();
  const costing = useCosting(snap.data);
  const filters = useFilterState();
  const [creating, setCreating] = React.useState(false);

  const kinds = filters.values.kind ?? [];
  const contains = filters.values.contains ?? [];
  const q = filters.q.trim().toLowerCase();
  const rows = React.useMemo(
    () =>
      (snap.data?.items ?? []).filter(
        i =>
          (!kinds.length || kinds.includes(i.kind)) &&
          (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)) &&
          // «содержит материал/операцию»: товар или операция есть в строках спецификации
          (!contains.length || contains.some(c => i.lines.some(l => l.productId === c))),
      ),
    [snap.data, kinds, q, contains],
  );

  const columns = React.useMemo<Column<Item>[]>(
    () => [
      {
        id: 'name',
        header: t('production.field.name'),
        width: 300,
        value: i => i.name,
        cell: i => (
          <span className="row" style={{ gap: 8, minWidth: 0 }}>
            {i.kind === 'semi' ? <Layers size={14} className="faint" aria-label={t('production.item.kind.semi')} /> : <Package size={14} className="faint" aria-label={t('production.item.kind.product')} />}
            <span className="trunc" style={{ fontWeight: 450 }}>
              {i.name}
            </span>
          </span>
        ),
      },
      { id: 'code', header: t('production.field.code'), width: 130, value: i => i.code, cell: i => (i.code ? <span className="mono">{i.code}</span> : <span className="faint">—</span>) },
      { id: 'kind', header: t('production.field.type'), width: 130, value: i => kindLabel(i.kind), cell: i => <Badge tone={i.kind === 'semi' ? 'violet' : 'accent'}>{kindLabel(i.kind)}</Badge> },
      { id: 'lines', header: t('production.item.col.lineNo'), width: 80, align: 'right', value: i => i.lines.length },
      { id: 'batch', header: t('production.item.batch'), width: 100, align: 'right', value: i => Number(i.batchQty), cell: i => <span className="num">{Number(i.batchQty)} {unitSymbol(units.data, i.unitCode)}</span> },
      {
        id: 'cost',
        header: t('production.item.cost'),
        width: 140,
        align: 'right',
        value: i => Number(costing?.(i.id).tree?.unit.total ?? NaN) || null,
        cell: i => {
          const c = costing?.(i.id);
          return c?.tree ? <span className="num">{money(c.tree.unit.total)}</span> : <span className="faint">—</span>;
        },
      },
      { id: 'updated', header: t('production.order.updated'), width: 112, value: i => Date.parse(i.updatedAt), cell: i => <span className="muted num">{fmtDate(new Date(i.updatedAt))}</span> },
    ],
    [costing, units.data],
  );
  const table = useDataTable(columns);

  // материалы, расходы и операции, которые встречаются в спецификациях
  const containsOptions = React.useMemo(() => {
    const used = new Set((snap.data?.items ?? []).flatMap(i => i.lines.map(l => l.productId).filter((x): x is string => !!x)));
    return (snap.data?.materials ?? []).filter(m => used.has(m.id)).map(m => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [snap.data]);
  const filterFields: FilterField[] = [
    { id: 'kind', name: t('production.field.type'), icon: <Layers size={15} />, options: MANUFACTURED_KINDS.map(k => ({ id: k, name: kindLabel(k) })) },
    { id: 'contains', name: 'Contains', icon: <Package size={15} />, options: containsOptions },
  ];
  const newBtn = canWrite && (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus size={14} />
      {t('production.list.newProduct')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.list.title')}</h1>
          <p>{t('production.list.summary', { count: rows.length })}</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('production.list.searchPlaceholder') }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {snap.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.list.loadFailed')} action={<Button size="sm" onClick={() => snap.refetch()}>{t('production.common.retry')}</Button>}>
          {(snap.error as Error).message}
        </EmptyState>
      ) : snap.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !snap.data.items.length ? (
        <EmptyState icon={<Factory size={20} />} title={t('production.list.noProducts')} action={newBtn || undefined}>
          {t('production.list.noProductsHint')}
        </EmptyState>
      ) : (
        <DataTable
          aria-label={t('production.list.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={i => i.id}
          onRowClick={i => navigate(`/production/${i.id}`)}
          showTotals={false}
          onNew={canWrite ? () => setCreating(true) : undefined}
          newLabel={t('production.list.newProduct')}
          empty={
            <EmptyState icon={<Factory size={20} />} title={t('production.list.noMatch')} action={<Button size="sm" onClick={() => filters.reset()}>{t('common.clearFilters')}</Button>}>
              {t('production.list.noMatch')}
            </EmptyState>
          }
        />
      )}
      {creating && (
        <NewItemDialog
          onClose={() => setCreating(false)}
          onCreated={i => {
            setCreating(false);
            navigate(`/production/${i.id}`);
          }}
        />
      )}
    </div>
  );
}

function NewItemDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (i: Item) => void }) {
  const m = useProductionMutations();
  const [kind, setKind] = React.useState<'product' | 'semi'>('product');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [unitCode, setUnitCode] = React.useState('796');
  const [batch, setBatch] = React.useState('1');
  const [overhead, setOverhead] = React.useState('0');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t('common.enterName');
    if (!(Number(batch) > 0)) errs.batch = t('common.required');
    if (!(Number(overhead) >= 0)) errs.overhead = t('catalog.product.nonNegative');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const row = await m.createItem.mutateAsync({ name: name.trim(), code: code.trim(), kind, unitCode, batchQty: Number(batch), overheadPct: Number(overhead) });
      toast(t('catalog.product.added', { name: row.name }));
      onCreated(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('production.list.newProduct')}
        description={t('production.item.bomEmptyHint')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {t('production.common.create')}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Segmented aria-label={t('production.field.type')} value={kind} onValueChange={setKind} items={MANUFACTURED_KINDS.map(k => ({ value: k, label: kindLabel(k) }))} />
          <Field label={t('production.field.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={t('production.field.code')} className="grow">
              {p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}
            </Field>
            <Field label={t('production.field.unit')} className="grow">
              {p => <UnitSelect value={unitCode} onChange={setUnitCode} id={p.id} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={t('production.item.batch')} className="grow" error={err.batch}>
              {p => <Input {...p} inputMode="decimal" value={batch} onChange={e => setBatch(e.target.value)} />}
            </Field>
            <Field label="Overhead, %" className="grow" error={err.overhead}>
              {p => <Input {...p} inputMode="decimal" value={overhead} onChange={e => setOverhead(e.target.value)} />}
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
