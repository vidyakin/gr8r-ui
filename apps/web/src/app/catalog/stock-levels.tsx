/* Вкладка «Stock levels» в карточке товара: нормы запаса мин./макс. по складам и одна строка без склада (норма по компании).
   Способ пополнения (закупка, производство, перемещение) и склад-источник для перемещения.
   Нормы читает общий расчёт потребностей (/production/needs). */
import * as React from 'react';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import type { StockReplenishment } from '@gr8r/shared';
import { STOCK_REPLENISHMENT_LABELS } from '@gr8r/shared';
import { Button, IconButton, Input, toast } from '@/components/ui';
import { DrawerSection } from '@/components/gr8r/entity-drawer';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCanWrite } from '../meta/custom-fields';
import { useWarehouses } from '../docs/data';
import { tEnum, useT } from '@/i18n';

export interface StockLevelRow {
  id: string;
  productId: string;
  warehouseId: string | null;
  warehouseName: string | null;
  minQty: string;
  maxQty: string;
  replenishment: StockReplenishment;
  sourceWarehouseId: string | null;
  sourceWarehouseName: string | null;
}

export const stockLevelsKey = (ws: string, productId: string) => ['ws', ws, 'stock-levels', productId] as const;

const num = (v: string) => Number(v || 0).toFixed(3);

export function StockLevelsTab({ productId }: { productId: string }) {
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const warehouses = useWarehouses();
  const levels = useQuery({ queryKey: stockLevelsKey(ws, productId), queryFn: () => call<{ items: StockLevelRow[] }>(ws, 'GET', `/stock-levels?productId=${productId}`), staleTime: Infinity });
  const rows = levels.data?.items ?? [];
  const whs = (warehouses.data ?? []).filter(w => w.kind !== 'transit');
  const [busy, setBusy] = React.useState(false);
  const t = useT();

  const save = async (next: Omit<StockLevelRow, 'id' | 'warehouseName' | 'sourceWarehouseName'>[]) => {
    setBusy(true);
    try {
      await call(ws, 'PUT', '/stock-levels', {
        productId,
        rows: next.map(r => ({ warehouseId: r.warehouseId ?? null, minQty: r.minQty, maxQty: r.maxQty, replenishment: r.replenishment, sourceWarehouseId: r.sourceWarehouseId ?? null })),
      });
      void qc.invalidateQueries({ queryKey: stockLevelsKey(ws, productId) });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'needs-calc'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = (index: number, body: Partial<StockLevelRow>) => save(rows.map((r, i) => (i === index ? { ...r, ...body } : r)));
  const add = () => save([...rows, { productId, warehouseId: null, minQty: '0', maxQty: '0', replenishment: 'purchase', sourceWarehouseId: null }]);
  const remove = (index: number) => save(rows.filter((_, i) => i !== index));

  return (
    <DrawerSection title={t('catalog.levels.title')} count={rows.length || undefined}>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('catalog.levels.hint')}
      </p>
      {levels.isPending ? (
        <p className="faint" style={{ margin: 0 }}>
          {t('common.loading')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dtbl" aria-label={t('catalog.levels.title')}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t('catalog.levels.warehouse')}</th>
                <th style={{ width: 90 }} className="r">
                  {t('catalog.levels.min')}
                </th>
                <th style={{ width: 90 }} className="r">
                  {t('catalog.levels.max')}
                </th>
                <th style={{ width: 140 }}>{t('catalog.levels.replenishment')}</th>
                <th style={{ width: 150 }}>{t('catalog.levels.source')}</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i}>
                  <td>
                    {canWrite ? (
                      <select className="select" aria-label={t('catalog.levels.warehouse')} value={r.warehouseId ?? ''} onChange={e => patch(i, { warehouseId: e.target.value || null })}>
                        <option value="">{t('catalog.levels.company')}</option>
                        {whs.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">{r.warehouseName ?? t('catalog.levels.company')}</span>
                    )}
                  </td>
                  <td className="r">
                    {canWrite ? (
                      <Input aria-label={t('catalog.levels.minimum')} className="num" type="number" step="0.001" value={r.minQty} onChange={e => patch(i, { minQty: num(e.target.value) })} style={{ textAlign: 'right' }} />
                    ) : (
                      <span className="num">{r.minQty}</span>
                    )}
                  </td>
                  <td className="r">
                    {canWrite ? (
                      <Input aria-label={t('catalog.levels.maximum')} className="num" type="number" step="0.001" value={r.maxQty} onChange={e => patch(i, { maxQty: num(e.target.value) })} style={{ textAlign: 'right' }} />
                    ) : (
                      <span className="num">{r.maxQty}</span>
                    )}
                  </td>
                  <td>
                    {canWrite ? (
                      <select className="select" aria-label={t('catalog.levels.replenishment')} value={r.replenishment} onChange={e => patch(i, { replenishment: e.target.value as StockReplenishment })}>
                        {Object.entries(STOCK_REPLENISHMENT_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {tEnum('replenishment', value, label)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">{tEnum('replenishment', r.replenishment, STOCK_REPLENISHMENT_LABELS[r.replenishment])}</span>
                    )}
                  </td>
                  <td>
                    {r.replenishment === 'transfer' ? (
                      canWrite ? (
                        <select className="select" aria-label={t('catalog.levels.source')} value={r.sourceWarehouseId ?? ''} onChange={e => patch(i, { sourceWarehouseId: e.target.value || null })}>
                          <option value="">{t('common.choose')}</option>
                          {whs.filter(w => w.id !== r.warehouseId).map(w => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">{r.sourceWarehouseName ?? '—'}</span>
                      )
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>{canWrite && <IconButton label={t('catalog.levels.remove')} onClick={() => remove(i)}><Trash2 size={14} /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" disabled={busy} onClick={add}>
            <Plus size={14} />
            {t('catalog.levels.add')}
          </Button>
          {!rows.length && (
            <span className="faint" style={{ marginLeft: 10, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Boxes size={14} />
              {t('catalog.levels.none')}
            </span>
          )}
        </div>
      )}
    </DrawerSection>
  );
}
