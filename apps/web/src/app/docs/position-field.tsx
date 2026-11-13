/* Позиция в строке табличной части: название выбранного товара или изделия и кнопка подбора справа.
   Клик по названию — карточка позиции (товар — боковая карточка каталога, изделие — окно спецификации), кнопка — окно подбора
   с поиском. Пустая позиция по клику и Enter сразу открывает подбор.
   Клавиатура в ячейке: F4 — подбор, буква или цифра — подбор с этим текстом в поиске, Enter у пустой — подбор,
   Space — карточка; остальные клавиши (стрелки, Enter у заполненной, Insert) уходят в onKeyDown — навигация по таблице. */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Factory, Package, Search, Wrench } from 'lucide-react';
import type { ProductKind } from '@gr8r/shared';
import { Button, Dialog, DialogContent, EmptyState, IconButton, Input, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/i18n';
import { useWsId } from '../meta/data';
import { SECTIONS } from '../routes';
import { buildCategoryTree, money, searchProducts, unitSymbol, useCategories, useProduct, useUnits, type Product } from '../catalog/data';
import { attachmentImageUrl, ProductDrawer } from '../catalog/product-ui';
import { searchItems, useSnapshot, type Item } from '../production/data';

/* ---------------- окно подбора ---------------- */

type PickProps =
  | { mode: 'product'; onPick: (p: Product) => void; productKind?: ProductKind; price?: 'price' | 'purchasePrice'; counterpartyId?: string | null; partnerArticles?: Map<string, { article: string; name: string }> }
  | { mode: 'item'; onPick: (i: Item) => void };

export type CatalogPickDialogProps = PickProps & {
  onClose: () => void;
  /** Текст поиска при открытии (набранная в ячейке буква) */
  initialQuery?: string;
  title?: string;
};

type Hit = { key: string; product?: Product; item?: Item };

/** Окно подбора из каталога: поиск на сервере, ↑/↓ — выбор, Enter — подтвердить, Esc — закрыть */
export function CatalogPickDialog(props: CatalogPickDialogProps) {
  const t = useT();
  const ws = useWsId();
  const [q, setQ] = React.useState(props.initialQuery ?? '');
  const [debounced, setDebounced] = React.useState(q.trim());
  const [hl, setHl] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 160);
    return () => clearTimeout(h);
  }, [q]);
  const productKind = props.mode === 'product' ? props.productKind : undefined;
  const counterpartyId = props.mode === 'product' ? props.counterpartyId : undefined;
  const res = useQuery({
    queryKey: ['ws', ws, 'catalog', 'pick', props.mode, productKind ?? '', counterpartyId ?? '', debounced],
    queryFn: async (): Promise<Hit[]> =>
      props.mode === 'product'
        ? (await searchProducts(ws, debounced, productKind, 20, counterpartyId)).map(p => ({ key: p.id, product: p }))
        : (await searchItems(ws, debounced, 20)).filter(i => !i.isInvalid).map(i => ({ key: i.id, item: i })),
    staleTime: 5_000,
    placeholderData: prev => prev,
  });
  const hits = res.data ?? [];
  React.useEffect(() => setHl(0), [debounced]);
  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  const pick = (h: Hit) => {
    props.onClose();
    if (props.mode === 'product' && h.product) props.onPick(h.product);
    else if (props.mode === 'item' && h.item) props.onPick(h.item);
  };
  const price = props.mode === 'product' ? (props.price ?? 'price') : 'price';
  const arts = props.mode === 'product' ? props.partnerArticles : undefined;

  return (
    <Dialog open onOpenChange={v => !v && props.onClose()}>
      <DialogContent
        onOpenAutoFocus={e => {
          e.preventDefault();
          input.current?.focus();
        }}
        title={props.title ?? t(props.mode === 'product' ? 'docs.pickers.pickProductTitle' : 'docs.pickers.pickItemTitle')}
        description={t('docs.pickers.pickHint')}
        footer={
          <Button variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
        }
      >
        <div className="stack" style={{ gap: 8 }}>
          <Input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls="catalog-pick-list"
            aria-label={t('docs.pickers.catalogAria')}
            autoComplete="off"
            placeholder={t(props.mode === 'product' ? 'docs.pickers.productPlaceholder' : 'docs.pickers.itemPlaceholder')}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (!hits.length) return;
              if (e.key === 'ArrowDown') (e.preventDefault(), setHl(h => (h + 1) % hits.length));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setHl(h => (h - 1 + hits.length) % hits.length));
              else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const h = hits[hl];
                if (h) pick(h);
              }
            }}
          />
          <div ref={list} id="catalog-pick-list" role="listbox" style={{ maxHeight: 360, overflowY: 'auto', minHeight: 120 }}>
            {res.isPending ? (
              <div className="stack" style={{ gap: 6, padding: 4 }}>
                <Skeleton h={22} />
                <Skeleton h={22} />
                <Skeleton h={22} />
              </div>
            ) : !hits.length ? (
              <EmptyState icon={<Search size={18} />} title={t('docs.pickers.noResults')} />
            ) : (
              hits.map((h, i) => (
                <button
                  key={h.key}
                  type="button"
                  role="option"
                  data-i={i}
                  aria-selected={i === hl}
                  tabIndex={-1}
                  className={cn('mi combo-item w-full', i === hl && 'hl')}
                  onMouseEnter={() => setHl(i)}
                  onClick={() => pick(h)}
                >
                  {h.product ? (
                    <>
                      {h.product.imageAttachmentId ? (
                        <img src={attachmentImageUrl(h.product.imageAttachmentId, 128, ws)} alt="" style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} loading="lazy" />
                      ) : h.product.kind === 'service' ? (
                        <Wrench size={13} className="faint" />
                      ) : (
                        <Package size={13} className="faint" />
                      )}
                      <span className="trunc grow" style={{ minWidth: 0 }}>{h.product.name}</span>
                      {arts?.get(h.product.id)?.article && (
                        <span className="mono accent" style={{ fontSize: 11 }} title={arts.get(h.product.id)?.name || undefined}>
                          {t('docs.partner.lineArticle', { article: arts.get(h.product.id)!.article })}
                        </span>
                      )}
                      {h.product.sku && <span className="mono faint" style={{ fontSize: 11 }}>{h.product.sku}</span>}
                      <span className="num muted" style={{ fontSize: 12 }}>{money(h.product[price])}</span>
                    </>
                  ) : h.item ? (
                    <>
                      <Factory size={13} className="faint" />
                      <span className="trunc grow" style={{ minWidth: 0 }}>{h.item.name}</span>
                      {h.item.code && <span className="mono faint" style={{ fontSize: 11 }}>{h.item.code}</span>}
                    </>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- карточки ---------------- */

/** Карточка товара каталога поверх документа (боковая панель, та же, что в каталоге) */
export function ProductCard({ id, onClose }: { id: string; onClose: () => void }) {
  const product = useProduct(id);
  const categories = useCategories();
  const navigate = useNavigate();
  const tree = React.useMemo(() => buildCategoryTree(categories.data ?? []), [categories.data]);
  if (!product.data) return null;
  return <ProductDrawer key={id} product={product.data} tree={tree} onClose={onClose} onOpenCategory={cat => (onClose(), navigate(`${SECTIONS.catalog.path}?category=${cat}`))} />;
}

const LINE_KIND: Record<Item['lines'][number]['kind'], TKey> = {
  material: 'docs.pickers.itemCard.kind.material',
  semi: 'docs.pickers.itemCard.kind.semi',
  work: 'docs.pickers.itemCard.kind.work',
  expense: 'docs.pickers.itemCard.kind.expense',
  output: 'docs.pickers.itemCard.kind.output',
  waste: 'docs.pickers.itemCard.kind.waste',
};

/** Карточка изделия: реквизиты и состав спецификации только для просмотра, кнопка — полная страница спецификации */
export function ItemCard({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const snap = useSnapshot();
  const units = useUnits();
  const navigate = useNavigate();
  const item = snap.data?.items.find(i => i.id === id);
  const lineName = (l: Item['lines'][number]) =>
    (l.productId && snap.data?.materials.find(m => m.id === l.productId)?.name) || (l.childItemId && snap.data?.items.find(i => i.id === l.childItemId)?.name) || l.operation || '—';
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={item?.name ?? t('docs.pickers.itemCard.title')}
        description={item ? [item.code, t(item.kind === 'semi' ? 'docs.pickers.itemCard.semi' : 'docs.pickers.itemCard.product')].filter(Boolean).join(' · ') : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            {item && (
              <Button variant="primary" onClick={() => (onClose(), navigate(`${SECTIONS.production.path}/${item.id}`))}>
                {t('docs.pickers.itemCard.open')}
              </Button>
            )}
          </>
        }
      >
        {snap.isPending ? (
          <Skeleton h={120} />
        ) : !item ? (
          <EmptyState icon={<Factory size={18} />} title={t('docs.pickers.itemCard.notFound')} />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row muted" style={{ gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>
                {t('docs.pickers.itemCard.unit')}: <b>{unitSymbol(units.data, item.unitCode)}</b>
              </span>
              <span>
                {t('docs.pickers.itemCard.batchQty')}: <b className="num">{item.batchQty}</b>
              </span>
            </div>
            {item.lines.length ? (
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>{t('docs.pickers.itemCard.line')}</th>
                    <th style={{ width: 140 }}>{t('docs.pickers.itemCard.kindCol')}</th>
                    <th style={{ width: 100 }} className="r">
                      {t('docs.pickers.itemCard.qty')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...item.lines]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map(l => (
                      <tr key={l.id}>
                        <td className="trunc">{lineName(l)}</td>
                        <td className="muted">{t(LINE_KIND[l.kind])}</td>
                        <td className="r num">{l.kind === 'work' ? l.hours : l.qtyExpr || l.qty}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">{t('docs.pickers.itemCard.noLines')}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- поле позиции ---------------- */

interface BaseFieldProps {
  /** id выбранной позиции; пусто — строка без позиции */
  id: string | null | undefined;
  /** Название для показа (из строки документа: может отличаться от каталога) */
  name: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  /** Адрес ячейки для навигации по таблице */
  dataCell?: string;
  cellRef?: React.Ref<HTMLButtonElement>;
  /** Клавиши, которые поле не забрало себе: навигация по таблице */
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** Заголовок окна подбора */
  pickTitle?: string;
}

export type ProductFieldProps = BaseFieldProps & {
  onPick: (p: Product) => void;
  productKind?: ProductKind;
  price?: 'price' | 'purchasePrice';
  counterpartyId?: string | null;
  partnerArticles?: Map<string, { article: string; name: string }>;
};
export type ItemFieldProps = BaseFieldProps & { onPick: (i: Item) => void };

/** Товар или услуга из каталога в строке документа */
export function ProductField({ onPick, productKind, price, counterpartyId, partnerArticles, ...rest }: ProductFieldProps) {
  const t = useT();
  return (
    <PositionField
      {...rest}
      placeholder={rest.placeholder ?? t('docs.pickers.emptyProduct')}
      icon={productKind === 'service' ? <Wrench size={13} className="faint" /> : <Package size={13} className="faint" />}
      card={(id, close) => <ProductCard id={id} onClose={close} />}
      dialog={(q, close) => <CatalogPickDialog mode="product" title={rest.pickTitle} initialQuery={q} onClose={close} onPick={onPick} productKind={productKind} price={price} counterpartyId={counterpartyId} partnerArticles={partnerArticles} />}
    />
  );
}

/** Изделие (спецификация) в строке документа */
export function ItemField({ onPick, ...rest }: ItemFieldProps) {
  const t = useT();
  return (
    <PositionField
      {...rest}
      placeholder={rest.placeholder ?? t('docs.pickers.emptyItem')}
      icon={<Factory size={13} className="faint" />}
      card={(id, close) => <ItemCard id={id} onClose={close} />}
      dialog={(q, close) => <CatalogPickDialog mode="item" title={rest.pickTitle} initialQuery={q} onClose={close} onPick={onPick} />}
    />
  );
}

function PositionField({
  id,
  name,
  disabled,
  invalid,
  placeholder,
  className,
  dataCell,
  cellRef,
  onKeyDown,
  icon,
  card,
  dialog,
  ...aria
}: BaseFieldProps & { icon: React.ReactNode; card: (id: string, close: () => void) => React.ReactNode; dialog: (q: string, close: () => void) => React.ReactNode }) {
  const t = useT();
  const [picking, setPicking] = React.useState<string | null>(null);
  const [cardOpen, setCardOpen] = React.useState(false);
  const empty = !id;
  const label = name || '';
  const openPick = (q = '') => !disabled && setPicking(q);

  return (
    <div className={cn('flex items-center min-w-0 w-full', className)} style={{ gap: 2 }}>
      <button
        ref={cellRef}
        type="button"
        data-cell={dataCell}
        aria-label={aria['aria-label'] ? `${aria['aria-label']}: ${label || placeholder}` : undefined}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        title={label ? t('docs.pickers.openCard', { name: label }) : undefined}
        disabled={disabled && empty}
        className={cn(
          'flex items-center min-w-0 grow text-left rounded-[5px] px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
          invalid && 'ring-1 ring-[var(--danger,#e5484d)]',
          empty ? 'faint' : 'hover:underline',
        )}
        style={{ gap: 6, minHeight: 28 }}
        onClick={() => (empty ? openPick() : setCardOpen(true))}
        onKeyDown={e => {
          if (e.altKey || e.ctrlKey || e.metaKey) return onKeyDown?.(e);
          if (e.key === 'F4' || (e.key === 'Enter' && empty)) {
            e.preventDefault();
            openPick();
          } else if (e.key === ' ') {
            e.preventDefault();
            if (empty) openPick();
            else setCardOpen(true);
          } else if (e.key.length === 1 && !disabled) {
            e.preventDefault();
            openPick(e.key);
          } else {
            if (e.key === 'Enter') e.preventDefault();
            onKeyDown?.(e);
          }
        }}
      >
        {!empty && icon}
        <span className="trunc">{label || placeholder}</span>
      </button>
      {!disabled && (
        <IconButton size="sm" tabIndex={-1} label={t('docs.pickers.pickAction')} shortcut="F4" onClick={() => openPick()}>
          <Search size={13} />
        </IconButton>
      )}
      {picking !== null && dialog(picking, () => setPicking(null))}
      {cardOpen && id && card(id, () => setCardOpen(false))}
    </div>
  );
}
