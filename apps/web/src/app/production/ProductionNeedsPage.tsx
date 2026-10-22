/* Экран потребностей: сводный дефицит по материалам заказов на производство и создание заказов поставщикам.
   Строки выбираются галочками — по выбранным создаются черновики заказов поставщику (по поставщику товара). */
import * as React from 'react';
import { CircleAlert, PackageSearch, Truck } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useCanWrite } from '../meta/custom-fields';
import { useQueryClient } from '@tanstack/react-query';
import { needsKey, useProductionNeeds, type NeedsRow, type SupplierOrdersResult } from './orders-data';

export function ProductionNeedsPage() {
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const needs = useProductionNeeds();
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const rows = needs.data?.items ?? [];
  const withDeficit = rows.filter(r => Number(r.deficit) > 0);
  const selected = withDeficit.filter(r => sel[r.productId]);

  const toggle = (id: string) => setSel(prev => ({ ...prev, [id]: !prev[id] }));

  const create = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const res = await call<SupplierOrdersResult>(ws, 'POST', '/production/needs/supplier-orders', { lines: selected.map(r => ({ productId: r.productId, qty: r.deficit, supplierId: r.supplierId })) });
      const without = res.withoutSupplier.length;
      toast(`Supplier orders created: ${res.orders.length}${without ? ` · ${without} without a supplier` : ''}`);
      setSel({});
      void qc.invalidateQueries({ queryKey: needsKey(ws) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Needs</h1>
          <p>What the open production orders still lack: reserved, ordered from suppliers and free stock. Pick the lines to create supplier orders.</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" disabled={busy || !selected.length} onClick={() => void create()}>
              <Truck size={14} />
              Create supplier orders
            </Button>
          )}
        </div>
      </div>
      {needs.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load the needs" action={<Button size="sm" onClick={() => needs.refetch()}>Retry</Button>}>
          {(needs.error as Error).message}
        </EmptyState>
      ) : needs.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<PackageSearch size={20} />} title="No materials are needed">
          The needs appear when a production order is posted and its materials are not covered by the stock.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="dtbl" aria-label="Needs">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Material</th>
                <th style={{ width: 100 }} className="r">
                  Needed
                </th>
                <th style={{ width: 100 }} className="r">
                  Reserved
                </th>
                <th style={{ width: 100 }} className="r">
                  Placed
                </th>
                <th style={{ width: 100 }} className="r">
                  Free
                </th>
                <th style={{ width: 100 }} className="r">
                  Incoming
                </th>
                <th style={{ width: 110 }} className="r">
                  Deficit
                </th>
                <th style={{ width: 170 }}>Supplier</th>
                <th style={{ width: 90 }}>Orders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: NeedsRow) => (
                <tr key={r.productId} data-row={Number(r.deficit) > 0 ? 'deficit' : undefined}>
                  <td>
                    {Number(r.deficit) > 0 && canWrite && (
                      <input type="checkbox" className="check" aria-label={`Select ${r.productName}`} checked={!!sel[r.productId]} onChange={() => toggle(r.productId)} />
                    )}
                  </td>
                  <td className="trunc">{r.productName}</td>
                  <td className="r num">{r.need}</td>
                  <td className="r num">{r.reserved}</td>
                  <td className="r num">{r.placed}</td>
                  <td className="r num muted">{r.free}</td>
                  <td className="r num muted">{r.incoming}</td>
                  <td className="r num">
                    {Number(r.deficit) > 0 ? <Badge tone="amber" dot>{r.deficit}</Badge> : <span className="muted">—</span>}
                  </td>
                  <td className="trunc muted">{r.supplierName ?? <span className="faint">No supplier</span>}</td>
                  <td className="num muted">{r.orders.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
