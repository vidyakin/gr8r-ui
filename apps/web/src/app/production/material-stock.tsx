/* Обеспечение материалов заказа на производство: переключатель «Show stock», колонки обеспечения с цветом,
   расшифровки (резервы по складам, размещение по документам, к поступлению), правка резерва и кнопки
   «Create semi-finished orders» и «Create supplier orders». */
import * as React from 'react';
import { Boxes, PackageSearch, Pencil, Truck } from 'lucide-react';
import { Badge, Button, Dialog, DialogClose, DialogContent, Field, Input, Select } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { useWarehouses } from '../docs/data';
import { fmtDate } from '../lib/dates';
import { useOrderMaterials, useProductionOrderApi, type MaterialCoverageRow } from './orders-data';

/** Цвет и подпись статуса обеспечения */
export const COVERAGE_TONE: Record<MaterialCoverageRow['status'], 'green' | 'amber' | 'red'> = { full: 'green', partial: 'amber', none: 'red' };
export const COVERAGE_LABEL: Record<MaterialCoverageRow['status'], string> = { full: 'Provided', partial: 'Partly provided', none: 'Not provided' };

/** Что показывать в расшифровке строки материала */
type Drill = 'reserves' | 'placements' | 'incoming';

/** Блок обеспечения материалов: колонки обеспечения и расшифровки */
export function MaterialStockBlock({ orderId, canWrite, onEdit }: { orderId: string; canWrite: boolean; onEdit: (row: MaterialCoverageRow) => void }) {
  const materials = useOrderMaterials(orderId);
  const [drill, setDrill] = React.useState<{ row: MaterialCoverageRow; kind: Drill } | null>(null);
  const rows = materials.data?.items ?? [];

  if (!rows.length) return <p className="faint">The composition has no materials: fill it from the bill of materials.</p>;

  return (
    <>
      <table className="dtbl" aria-label="Material coverage">
        <thead>
          <tr>
            <th>Material</th>
            <th style={{ width: 90 }} className="r">
              Needed
            </th>
            <th style={{ width: 90 }} className="r">
              Written
            </th>
            <th style={{ width: 100 }} className="r">
              Reserved
            </th>
            <th style={{ width: 100 }} className="r">
              Placed
            </th>
            <th style={{ width: 110 }} className="r">
              Not provided
            </th>
            <th style={{ width: 90 }} className="r">
              Free
            </th>
            <th style={{ width: 100 }} className="r">
              Incoming
            </th>
            <th style={{ width: 120 }}>Coverage</th>
            {canWrite && <th style={{ width: 40 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.componentId}>
              <td>
                <span className="trunc">{r.productName}</span>
              </td>
              <td className="r num">{r.need}</td>
              <td className="r num muted">{r.written}</td>
              <td className="r num">
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'reserves' })} title="Reserves by warehouse">
                  {r.reserved}
                </button>
              </td>
              <td className="r num">
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'placements' })} title="Placed by documents">
                  {r.placed}
                </button>
              </td>
              <td className="r num">{r.notEnsured}</td>
              <td className="r num muted">{r.free}</td>
              <td className="r num">
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'incoming' })} title="Incoming by documents">
                  {r.incoming}
                </button>
              </td>
              <td>
                <Badge tone={COVERAGE_TONE[r.status]} dot>
                  {COVERAGE_LABEL[r.status]}
                </Badge>
              </td>
              {canWrite && (
                <td className="r">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(r)} title="Change the reserve">
                    <Pencil size={13} />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {drill && <DrilldownDialog drill={drill} onClose={() => setDrill(null)} />}
    </>
  );
}

/** Расшифровка строки: резервы по складам, размещение по документам, к поступлению по документам с датой */
function DrilldownDialog({ drill, onClose }: { drill: { row: MaterialCoverageRow; kind: Drill }; onClose: () => void }) {
  const { row, kind } = drill;
  const title = kind === 'reserves' ? 'Reserves by warehouse' : kind === 'placements' ? 'Placed by documents' : 'Incoming by documents';
  const rows =
    kind === 'reserves'
      ? row.reserves.map(r => ({ key: r.warehouseId, title: r.warehouseName, qty: r.qty, note: r.orderNumber }))
      : kind === 'placements'
        ? row.placements.map(p => ({ key: p.documentId, title: p.number ?? '(draft)', qty: p.qty, note: fmtDate(new Date(p.date)) }))
        : row.incomingDocs.map(p => ({ key: p.documentId, title: p.number ?? '(draft)', qty: p.qty, note: fmtDate(new Date(p.date)) }));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`${title}: ${row.productName}`}
        description={kind === 'reserves' ? 'The goods kept for this production order.' : kind === 'placements' ? 'Ordered from suppliers or by child production orders.' : 'Free supplier orders: the goods that will arrive.'}
      >
        {!rows.length ? (
          <p className="faint">Nothing here yet.</p>
        ) : (
          <table className="dtbl">
            <thead>
              <tr>
                <th>{kind === 'reserves' ? 'Warehouse' : 'Document'}</th>
                <th style={{ width: 110 }}>Date or number</th>
                <th style={{ width: 90 }} className="r">
                  Qty
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="trunc">{r.title}</td>
                  <td className="muted">{r.note ?? '—'}</td>
                  <td className="r num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Правка резерва строки материала: «To reserve» и «Reserve warehouse» */
export function ReserveDialog({ row, orderId, onClose }: { row: MaterialCoverageRow; orderId: string; onClose: () => void }) {
  const warehouses = useWarehouses();
  const api = useProductionOrderApi();
  const [qty, setQty] = React.useState(row.reserved);
  const [warehouseId, setWarehouseId] = React.useState(row.reserveWarehouseId ?? warehouses.data?.[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);

  const submit = () => {
    if (!warehouseId) return;
    setBusy(true);
    void api.reserve
      .mutateAsync({ id: orderId, componentId: row.componentId, qty, warehouseId })
      .then(() => onClose())
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`Reserve: ${row.productName}`}
        description="The reserve keeps the goods for this production order. It can be reduced at any time; to increase it, the free stock of the warehouse must cover the difference."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="contents"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="To reserve" hint={`Free for reserve: ${row.freeAtReserve}`}>
            {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
          </Field>
          <Field label="Reserve warehouse">
            {p => (
              <Select
                id={p.id}
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={(warehouses.data ?? []).map(w => ({ value: w.id, label: w.name }))}
                placeholder="Choose a warehouse"
                aria-label="Reserve warehouse"
              />
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопки обеспечения: дочерние заказы на полуфабрикаты и заказы поставщику */
export function SupplyButtons({ orderId }: { orderId: string }) {
  const canWrite = useCanWrite();
  const api = useProductionOrderApi();
  if (!canWrite) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="ghost" onClick={() => void api.semiOrders.mutateAsync(orderId)}>
        <Boxes size={13} />
        Create semi-finished orders
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void api.supplierOrders.mutateAsync({ id: orderId })}>
        <Truck size={13} />
        Create supplier orders
      </Button>
    </div>
  );
}

/** Переключатель «Show stock» */
export function StockToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Button size="sm" variant={on ? 'primary' : 'ghost'} onClick={onToggle} title="Show the stock columns of the materials">
      <PackageSearch size={13} />
      Show stock
    </Button>
  );
}
