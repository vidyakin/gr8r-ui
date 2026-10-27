/* Каталог: дерево категорий слева, таблица товаров и услуг справа (DataTable + FilterBar), карточка товара (EntityDrawer).
   Выбранная категория живёт в адресе (?category=…), карточка — в пути (/catalog/:productId). */
import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { CircleAlert, Package, Plus, Shapes, Wrench } from 'lucide-react';
import { VAT_LABELS, type ProductKind } from '@gr8r/shared';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { EntityDrawer } from '@/components/gr8r/entity-drawer';
import { useCanWrite } from '../meta/custom-fields';
import { fmtDate } from '../lib/dates';
import { tEnum, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { AttributesDialog, CategoryDialog, CategoryTree, DeleteCategoryDialog } from './category-ui';
import { ProductDrawer, ProductFormDialog } from './product-ui';
import { useProductKinds } from '../positions/data';
import { buildCategoryTree, categoryPath, flattenTree, money, unitSymbol, useCategories, useIsAdmin, useProduct, useProducts, useUnits, type CategoryNode, type Product } from './data';

type Dialog = { type: 'category'; edit?: CategoryNode; parent?: CategoryNode | null } | { type: 'attributes'; category: CategoryNode } | { type: 'delete'; category: CategoryNode } | { type: 'product' } | null;

export function CatalogPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const categories = useCategories();
  const units = useUnits();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const filters = useFilterState();
  const t = useT();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  const tree = React.useMemo(() => buildCategoryTree(categories.data ?? []), [categories.data]);
  const flat = React.useMemo(() => flattenTree(tree), [tree]);
  const total = React.useMemo(() => (categories.data ?? []).reduce((s, c) => s + c.productCount, 0), [categories.data]);
  const catParam = sp.get('category');
  const selected = catParam && flat.some(c => c.id === catParam) ? catParam : null;
  const setSelected = (id: string | null) =>
    setSp(
      p => {
        const n = new URLSearchParams(p);
        if (id) n.set('category', id);
        else n.delete('category');
        return n;
      },
      { replace: true },
    );
  const selectedNode = flat.find(c => c.id === selected) ?? null;

  const kind = (filters.values.kind ?? []) as ProductKind[];
  const status = filters.values.status ?? [];
  const productKinds = useProductKinds();
  const pkFilter = filters.values.productKind ?? [];
  const list = useProducts({ categoryId: selected ?? undefined, q: q || undefined, kind: kind.length === 1 ? kind[0] : undefined, active: status.length === 1 ? status[0] === 'active' : undefined });
  // варианты показываются вложенно под товаром-родителем
  const rows = React.useMemo(() => {
    const all = (list.data ?? []).filter(p => !pkFilter.length || (p.productKindId && pkFilter.includes(p.productKindId))); // фильтр по виду номенклатуры (задача 1172)
    const variants = all.filter(p => p.parentProductId);
    const parents = all.filter(p => !p.parentProductId);
    const byParent = new Map<string, typeof all>();
    for (const v of variants) byParent.set(v.parentProductId!, [...(byParent.get(v.parentProductId!) ?? []), v]);
    const out: Product[] = [];
    for (const p of parents) {
      out.push(p);
      for (const v of byParent.get(p.id) ?? []) out.push(v);
    }
    return out;
  }, [list.data, pkFilter.join('|')]);

  const open = (p: Product) => navigate({ pathname: `/catalog/${p.id}`, search: sp.toString() });
  const closeDrawer = () => navigate({ pathname: '/catalog', search: sp.toString() });

  const columns = React.useMemo<Column<Product>[]>(
    () => [
      {
        id: 'name',
        header: t('catalog.col.name'),
        width: 300,
        value: p => p.name,
        cell: p => (
          <span className="row" style={{ gap: 8, minWidth: 0 }}>
            {p.kind === 'service' ? <Wrench size={14} className="faint" aria-label={t('catalog.kind.service')} /> : <Package size={14} className="faint" aria-label={t('catalog.kind.goods')} />}
            <span className="trunc" style={{ fontWeight: 450, opacity: p.isActive ? 1 : 0.6, paddingLeft: p.parentProductId ? 14 : 0 }}>
              {p.parentProductId && <span className="faint" aria-hidden="true">↳ </span>}
              {p.name}
            </span>
            {p.parentProductId && <Badge tone="gray">{t('catalog.variant')}</Badge>}
            {!p.isActive && <Badge tone="gray">{t('common.inactive')}</Badge>}
          </span>
        ),
      },
      { id: 'sku', header: t('catalog.col.sku'), width: 130, value: p => p.sku, cell: p => (p.sku ? <span className="mono">{p.sku}</span> : <span className="faint">—</span>) },
      { id: 'productKind', header: t('positions.product.kind'), width: 150, defaultHidden: true, value: p => p.productKindId ?? '', cell: p => <span className="muted trunc">{(productKinds.data ?? []).find(k => k.id === p.productKindId)?.name ?? '—'}</span> },
      { id: 'category', header: t('catalog.col.category'), width: 190, value: p => categoryPath(categories.data, p.categoryId), cell: p => <span className="trunc muted">{categoryPath(categories.data, p.categoryId).split(' / ').pop() || '—'}</span> },
      { id: 'unit', header: t('catalog.col.unit'), width: 72, value: p => unitSymbol(units.data, p.unitCode) },
      { id: 'vat', header: t('catalog.col.vat'), width: 84, value: p => tEnum('vat', p.vatRate, VAT_LABELS[p.vatRate]) },
      { id: 'price', header: t('catalog.col.price'), width: 120, align: 'right', value: p => Number(p.price), cell: p => <span className="num">{money(p.price)}</span> },
      { id: 'purchase', header: t('catalog.col.purchase'), width: 120, align: 'right', value: p => Number(p.purchasePrice), cell: p => <span className="num">{money(p.purchasePrice)}</span> },
      { id: 'barcode', header: t('catalog.col.barcode'), width: 140, defaultHidden: true, value: p => p.barcode, cell: p => (p.barcode ? <span className="mono">{p.barcode}</span> : <span className="faint">—</span>) },
      { id: 'created', header: t('catalog.col.created'), width: 112, defaultHidden: true, value: p => Date.parse(p.createdAt), cell: p => <span className="muted num">{fmtDate(new Date(p.createdAt))}</span> },
    ],
    [categories.data, units.data, productKinds.data, t],
  );
  const table = useDataTable(columns);

  const filterFields: FilterField[] = [
    { id: 'kind', name: t('common.type'), icon: <Package size={15} />, options: [{ id: 'goods', name: t('catalog.kind.goods') }, { id: 'service', name: t('catalog.kind.service') }] },
    ...((productKinds.data ?? []).length ? [{ id: 'productKind', name: t('positions.product.filter'), icon: <Shapes size={15} />, options: (productKinds.data ?? []).map(k => ({ id: k.id, name: k.name })) }] : []),
    { id: 'status', name: t('common.status'), icon: <CircleAlert size={15} />, options: [{ id: 'active', name: t('common.active') }, { id: 'inactive', name: t('common.inactive') }] },
  ];

  if (categories.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={180} h={24} />
        </div>
      </div>
    );

  const newProduct = canWrite && (
    <Button variant="primary" onClick={() => setDialog({ type: 'product' })}>
      <Plus size={14} />
      {t('catalog.newProduct')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('catalog.title')}</h1>
          <p>
            {selectedNode ? `${selectedNode.name}: ` : ''}
            {t(filters.count || q ? 'catalog.summaryMatch' : 'catalog.summary', { count: rows.length })}
          </p>
        </div>
        <div className="acts">{newProduct}</div>
      </div>
      <div className="cat-layout">
        <aside className="cat-side">
          <CategoryTree
            nodes={tree}
            total={total}
            selected={selected}
            onSelect={setSelected}
            canEdit={isAdmin}
            onCreate={parent => setDialog({ type: 'category', parent })}
            onEdit={c => setDialog({ type: 'category', edit: c })}
            onAttributes={c => setDialog({ type: 'attributes', category: c })}
            onDelete={c => setDialog({ type: 'delete', category: c })}
          />
          {selectedNode && isAdmin && (
            <Button size="sm" variant="ghost" className="cat-attrs-btn" onClick={() => setDialog({ type: 'attributes', category: selectedNode })}>
              {t('catalog.characteristicsOf', { name: selectedNode.name })}
            </Button>
          )}
        </aside>
        <section className="cat-main" aria-label={t('catalog.products')}>
          <FilterBar
            search={{ value: filters.q, onChange: filters.setQ, placeholder: t('catalog.searchPlaceholder') }}
            fields={filterFields}
            filters={filters}
            sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
            columns={columnsMenu(columns, table)}
          />
          {list.isError ? (
            <EmptyState icon={<CircleAlert size={20} />} error title={t('catalog.loadFailed')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
              {errorMessage(list.error)}
            </EmptyState>
          ) : list.isPending ? (
            <div style={{ padding: 16 }}>
              <Skeleton w="100%" h={36} />
            </div>
          ) : !rows.length && !filters.count && !q ? (
            <EmptyState icon={<Package size={20} />} title={selectedNode ? t('catalog.noProductsIn', { name: selectedNode.name }) : t('catalog.noProducts')} action={newProduct || undefined}>
              {t('catalog.noProductsHint')}
            </EmptyState>
          ) : (
            <DataTable
              aria-label={t('catalog.productsTable')}
              columns={columns}
              rows={rows}
              table={table}
              getId={p => p.id}
              onRowClick={open}
              showTotals={false}
              onNew={canWrite ? () => setDialog({ type: 'product' }) : undefined}
              newLabel={t('catalog.newProduct')}
              empty={
                <EmptyState icon={<Package size={20} />} title={t('common.noResults')} action={<Button size="sm" onClick={() => (filters.reset(), setQ(''))}>{t('common.clearFilters')}</Button>}>
                  {t('catalog.noMatch')}
                </EmptyState>
              }
            />
          )}
        </section>
      </div>

      {dialog?.type === 'category' && <CategoryDialog tree={tree} edit={dialog.edit} parent={dialog.parent} onClose={() => setDialog(null)} onSaved={c => !dialog.edit && setSelected(c.id)} />}
      {dialog?.type === 'attributes' && <AttributesDialog category={dialog.category} onClose={() => setDialog(null)} />}
      {dialog?.type === 'delete' && <DeleteCategoryDialog category={dialog.category} onClose={() => setDialog(null)} onDeleted={() => selected === dialog.category.id && setSelected(null)} />}
      {dialog?.type === 'product' && (
        <ProductFormDialog
          tree={tree}
          initialCategory={selected}
          onClose={() => setDialog(null)}
          onCreated={p => {
            setDialog(null);
            open(p);
          }}
        />
      )}
      {productId && <DrawerHost id={productId} rows={rows} tree={tree} onClose={closeDrawer} onOpenCategory={id => (closeDrawer(), setSelected(id))} />}
    </div>
  );
}

function DrawerHost({ id, rows, tree, onClose, onOpenCategory }: { id: string; rows: Product[]; tree: CategoryNode[]; onClose: () => void; onOpenCategory: (id: string) => void }) {
  const inList = rows.find(r => r.id === id);
  const single = useProduct(inList ? undefined : id);
  const product = inList ?? single.data;
  const t = useT();
  if (!product)
    return single.isError ? (
      <EntityDrawer label={t('catalog.notFoundTitle')} title={t('catalog.notFoundTitle')} onClose={onClose}>
        <p className="muted">{t('catalog.notFoundText')}</p>
      </EntityDrawer>
    ) : null;
  return <ProductDrawer key={product.id} product={product} tree={tree} onClose={onClose} onOpenCategory={onOpenCategory} />;
}
