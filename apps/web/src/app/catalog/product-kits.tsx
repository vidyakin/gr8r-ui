/* Состав комплекта (набора как в УНФ) в карточке товара: подбор составляющих, количество,
   необязательная доля цены и предпросмотр распределения выручки комплекта по ценам каталога. */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { distributeKitLine } from '@erp/shared';
import { Badge, Button, IconButton, Input, toast } from '@/components/ui';
import { DrawerSection } from '@/components/erp/entity-drawer';
import { fmtNumber, useT } from '@/i18n';
import { parseNumber } from '@/i18n/format';
import { useCanWrite } from '../meta/custom-fields';
import { CatalogPickDialog } from '../docs/position-field';
import { money, unitSymbol, useProductKitItems, useSaveProductKitItems, useUnits, type Product } from './data';

interface DraftKitItem {
  key: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  componentUnitCode: string;
  componentPrice: string;
  componentPurchasePrice: string;
  componentIsKit: boolean;
  qty: string;
  priceShare: string;
}

const posNum = (s: string): number | null => {
  const n = parseNumber(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const nonNegNum = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = parseNumber(s);
  return Number.isFinite(n) && n >= 0 ? n : -1;
};

export function ProductKitSection({ product: p }: { product: Product }) {
  const t = useT();
  const canWrite = useCanWrite();
  const units = useUnits();
  const list = useProductKitItems(p.id, p.isKit);
  const save = useSaveProductKitItems(p.id);
  const [draft, setDraft] = React.useState<DraftKitItem[] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const sym = (code: string) => unitSymbol(units.data, code);

  const rows: DraftKitItem[] =
    draft ??
    (list.data?.items ?? []).map(i => ({
      key: i.id || i.componentProductId,
      componentProductId: i.componentProductId,
      componentName: i.componentName,
      componentSku: i.componentSku,
      componentUnitCode: i.componentUnitCode,
      componentPrice: i.componentPrice,
      componentPurchasePrice: i.componentPurchasePrice,
      componentIsKit: i.componentIsKit,
      qty: fmtNumber(i.qty, { maximumFractionDigits: 3, useGrouping: false }),
      priceShare: i.priceShare !== null ? fmtNumber(i.priceShare, { maximumFractionDigits: 4, useGrouping: false }) : '',
    }));

  const edit = (next: DraftKitItem[]) => setDraft(next);

  const preview = React.useMemo(() => {
    const valid = rows
      .map(r => ({
        productId: r.componentProductId,
        qty: String(posNum(r.qty) ?? 1),
        priceShare: nonNegNum(r.priceShare) !== null && (nonNegNum(r.priceShare) ?? -1) >= 0 ? String(nonNegNum(r.priceShare)) : null,
        catalogPrice: r.componentPrice,
      }));
    if (!valid.length) return new Map<string, { weightSharePct: string; total: string }>();
    const kitPrice = Number(p.price) > 0 ? p.price : '100.00';
    const dist = distributeKitLine({
      lineQty: '1',
      lineNet: kitPrice,
      lineVat: '0.00',
      lineTotal: kitPrice,
      priceIncludesVat: true,
      components: valid,
    });
    return new Map(dist.map(d => [d.productId, { weightSharePct: d.weightSharePct, total: d.total }]));
  }, [rows, p.price]);

  const catalogSum = React.useMemo(
    () => rows.reduce((s, r) => s + (posNum(r.qty) ?? 0) * Number(r.componentPrice || 0), 0),
    [rows],
  );
  const costSum = React.useMemo(
    () => rows.reduce((s, r) => s + (posNum(r.qty) ?? 0) * Number(r.componentPurchasePrice || 0), 0),
    [rows],
  );

  const onPick = (picked: Product) => {
    if (picked.id === p.id) return;
    if (rows.some(r => r.componentProductId === picked.id)) {
      toast.error(t('catalog.kits.duplicate'));
      return;
    }
    edit([
      ...rows,
      {
        key: picked.id,
        componentProductId: picked.id,
        componentName: picked.name,
        componentSku: picked.sku,
        componentUnitCode: picked.unitCode,
        componentPrice: picked.price,
        componentPurchasePrice: picked.purchasePrice,
        componentIsKit: picked.isKit,
        qty: '1',
        priceShare: '',
      },
    ]);
  };

  const submit = () => {
    const out: { componentProductId: string; qty: string; priceShare: string | null }[] = [];
    for (const r of rows) {
      const q = posNum(r.qty);
      if (q === null) return void toast.error(t('catalog.kits.invalidQty'));
      const sh = nonNegNum(r.priceShare);
      if (sh === -1) return void toast.error(t('catalog.kits.invalidShare'));
      out.push({
        componentProductId: r.componentProductId,
        qty: String(Number(q.toFixed(3))),
        priceShare: sh === null ? null : String(Number(sh.toFixed(4))),
      });
    }
    save.mutate(out, {
      onSuccess: () => {
        setDraft(null);
        toast(t('catalog.kits.saved'));
      },
    });
  };

  return (
    <DrawerSection title={t('catalog.kits.title')} count={rows.length || undefined}>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('catalog.kits.hint')}
      </p>
      {!rows.length && <p className="faint" style={{ margin: '0 0 8px' }}>{t('catalog.kits.none')}</p>}
      {!!rows.length && (
        <div className="table-wrap">
          <table className="dtbl" aria-label={t('catalog.kits.title')}>
            <thead>
              <tr>
                <th>{t('catalog.kits.component')}</th>
                <th className="num" style={{ width: 92 }}>{t('catalog.kits.qty')}</th>
                <th className="num" style={{ width: 92 }}>{t('catalog.kits.share')}</th>
                <th className="num" style={{ width: 120 }}>{t('catalog.kits.preview')}</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pv = preview.get(r.componentProductId);
                return (
                  <tr key={r.key}>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <span>{r.componentName}</span>
                        {r.componentIsKit && <Badge tone="blue">{t('catalog.kitBadge')}</Badge>}
                      </div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {r.componentSku ? <span className="mono">{r.componentSku} · </span> : null}
                        {sym(r.componentUnitCode)} · {money(r.componentPrice)}
                      </div>
                    </td>
                    <td className="num">
                      {canWrite ? (
                        <Input
                          aria-label={t('catalog.kits.qty')}
                          inputMode="decimal"
                          value={r.qty}
                          onChange={e => edit(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                        />
                      ) : (
                        r.qty
                      )}
                    </td>
                    <td className="num">
                      {canWrite ? (
                        <Input
                          aria-label={t('catalog.kits.share')}
                          inputMode="decimal"
                          placeholder={t('catalog.kits.sharePlaceholder')}
                          value={r.priceShare}
                          onChange={e => edit(rows.map((x, j) => (j === i ? { ...x, priceShare: e.target.value } : x)))}
                        />
                      ) : (
                        r.priceShare || '—'
                      )}
                    </td>
                    <td className="num muted">
                      {pv ? (
                        <>
                          <div>{pv.weightSharePct}%</div>
                          {Number(p.price) > 0 && <div className="faint" style={{ fontSize: 11 }}>{money(pv.total)}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ width: 34 }}>
                      {canWrite && (
                        <IconButton label={t('catalog.kits.remove', { name: r.componentName })} onClick={() => edit(rows.filter((_, j) => j !== i))}>
                          <Trash2 size={14} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!!rows.length && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>{t('catalog.kits.catalogSum', { sum: money(catalogSum.toFixed(2)) })}</span>
          <span>{t('catalog.kits.costEstimate', { sum: money(costSum.toFixed(2)) })}</span>
        </div>
      )}
      {canWrite && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <Plus size={14} />
            {t('catalog.kits.add')}
          </Button>
          {draft && (
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {t('catalog.kits.save')}
            </Button>
          )}
        </div>
      )}
      {picking && (
        <CatalogPickDialog
          mode="product"
          productKind="goods"
          excludeIds={[p.id, ...rows.map(r => r.componentProductId)]}
          title={t('catalog.kits.pickTitle')}
          onClose={() => setPicking(false)}
          onPick={onPick}
        />
      )}
    </DrawerSection>
  );
}
