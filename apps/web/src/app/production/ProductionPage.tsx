/* Production: список продукции (изделия и полуфабрикаты) с себестоимостью единицы, считаемой на клиенте. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, Factory, Layers, Package, Plus } from 'lucide-react';
import { MANUFACTURED_KINDS } from '@gr8r/shared';
import { Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Segmented, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { money, unitSymbol, useUnits } from '../catalog/data';
import { UnitSelect } from '../catalog/product-ui';
import { useCosting, useProductionMutations, useSnapshot, type Item } from './data';

const KIND_LABEL = { product: 'Product', semi: 'Semi-finished' } as const;

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
        header: 'Name',
        width: 300,
        value: i => i.name,
        cell: i => (
          <span className="row" style={{ gap: 8, minWidth: 0 }}>
            {i.kind === 'semi' ? <Layers size={14} className="faint" aria-label="Semi-finished" /> : <Package size={14} className="faint" aria-label="Product" />}
            <span className="trunc" style={{ fontWeight: 450 }}>
              {i.name}
            </span>
          </span>
        ),
      },
      { id: 'code', header: 'Code', width: 130, value: i => i.code, cell: i => (i.code ? <span className="mono">{i.code}</span> : <span className="faint">—</span>) },
      { id: 'kind', header: 'Type', width: 130, value: i => KIND_LABEL[i.kind], cell: i => <Badge tone={i.kind === 'semi' ? 'violet' : 'accent'}>{KIND_LABEL[i.kind]}</Badge> },
      { id: 'lines', header: 'Lines', width: 80, align: 'right', value: i => i.lines.length },
      { id: 'batch', header: 'Batch', width: 100, align: 'right', value: i => Number(i.batchQty), cell: i => <span className="num">{Number(i.batchQty)} {unitSymbol(units.data, i.unitCode)}</span> },
      {
        id: 'cost',
        header: 'Cost per unit',
        width: 140,
        align: 'right',
        value: i => Number(costing?.(i.id).tree?.unit.total ?? NaN) || null,
        cell: i => {
          const c = costing?.(i.id);
          return c?.tree ? <span className="num">{money(c.tree.unit.total)}</span> : <span className="faint">—</span>;
        },
      },
      { id: 'updated', header: 'Updated', width: 112, value: i => Date.parse(i.updatedAt), cell: i => <span className="muted num">{fmtDate(new Date(i.updatedAt))}</span> },
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
    { id: 'kind', name: 'Type', icon: <Layers size={15} />, options: MANUFACTURED_KINDS.map(k => ({ id: k, name: KIND_LABEL[k] })) },
    { id: 'contains', name: 'Contains', icon: <Package size={15} />, options: containsOptions },
  ];
  const newBtn = canWrite && (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus size={14} />
      New product
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Production</h1>
          <p>
            {rows.length} product{rows.length === 1 ? '' : 's'} and semi-finished product{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by name or code' }}
        fields={filterFields}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      {snap.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load production data" action={<Button size="sm" onClick={() => snap.refetch()}>Retry</Button>}>
          {(snap.error as Error).message}
        </EmptyState>
      ) : snap.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !snap.data.items.length ? (
        <EmptyState icon={<Factory size={20} />} title="No products yet" action={newBtn || undefined}>
          Describe what you make: a bill of materials with materials, semi-finished products and work gives the cost of one unit.
        </EmptyState>
      ) : (
        <DataTable
          aria-label="Products table"
          columns={columns}
          rows={rows}
          table={table}
          getId={i => i.id}
          onRowClick={i => navigate(`/production/${i.id}`)}
          showTotals={false}
          onNew={canWrite ? () => setCreating(true) : undefined}
          newLabel="New product"
          empty={
            <EmptyState icon={<Factory size={20} />} title="No results found" action={<Button size="sm" onClick={() => filters.reset()}>Clear filters</Button>}>
              No products match these filters.
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
    if (!name.trim()) errs.name = 'Enter a name';
    if (!(Number(batch) > 0)) errs.batch = 'Must be greater than zero';
    if (!(Number(overhead) >= 0)) errs.overhead = 'Must not be negative';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const row = await m.createItem.mutateAsync({ name: name.trim(), code: code.trim(), kind, unitCode, batchQty: Number(batch), overheadPct: Number(overhead) });
      toast(`Added “${row.name}”`);
      onCreated(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title="New product"
        description="Create the product first, then build its bill of materials."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Create product
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
          <Segmented aria-label="Type" value={kind} onValueChange={setKind} items={MANUFACTURED_KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} />
          <Field label="Name" error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Code" className="grow">
              {p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}
            </Field>
            <Field label="Unit" className="grow">
              {p => <UnitSelect value={unitCode} onChange={setUnitCode} id={p.id} />}
            </Field>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Batch quantity" className="grow" hint="The bill of materials is written for this many units." error={err.batch}>
              {p => <Input {...p} inputMode="decimal" value={batch} onChange={e => setBatch(e.target.value)} />}
            </Field>
            <Field label="Overhead, %" className="grow" hint="Of direct costs." error={err.overhead}>
              {p => <Input {...p} inputMode="decimal" value={overhead} onChange={e => setOverhead(e.target.value)} />}
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
