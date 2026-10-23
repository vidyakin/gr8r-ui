/* Обеспечение материалов заказа на производство: переключатель «Show stock», колонки обеспечения с цветом,
   расшифровки (резервы по складам, размещение по документам, к поступлению), правка резерва и кнопки
   «Create semi-finished orders» и «Create supplier orders». */
import * as React from 'react';
import { Boxes, PackageSearch, Pencil, Truck } from 'lucide-react';
import { Badge, Button, Dialog, DialogClose, DialogContent, Field, Input, Select } from '@/components/ui';
import { useCanWrite } from '../meta/custom-fields';
import { useWarehouses } from '../docs/data';
import { fmtDate } from '../lib/dates';
import { tProductionEnum, useT } from '@/i18n';
import { useOrderMaterials, useProductionOrderApi, type MaterialCoverageRow } from './orders-data';

/** Цвет статуса обеспечения */
export const COVERAGE_TONE: Record<MaterialCoverageRow['status'], 'green' | 'amber' | 'red'> = { full: 'green', partial: 'amber', none: 'red' };

/** Что показывать в расшифровке строки материала */
type Drill = 'reserves' | 'placements' | 'incoming';

/** Блок обеспечения материалов: колонки обеспечения и расшифровки */
export function MaterialStockBlock({ orderId, canWrite, onEdit }: { orderId: string; canWrite: boolean; onEdit: (row: MaterialCoverageRow) => void }) {
  const tt = useT();
  const materials = useOrderMaterials(orderId);
  const [drill, setDrill] = React.useState<{ row: MaterialCoverageRow; kind: Drill } | null>(null);
  const rows = materials.data?.items ?? [];

  if (!rows.length) return <p className="faint">{tt('production.coverage.noMaterials')}</p>;

  return (
    <>
      <table className="dtbl" aria-label={tt('production.coverage.title')}>
        <thead>
          <tr>
            <th>{tt('production.coverage.col.product')}</th>
            <th style={{ width: 90 }} className="r">
              {tt('production.coverage.col.need')}
            </th>
            <th style={{ width: 90 }} className="r">
              {tt('production.coverage.col.written')}
            </th>
            <th style={{ width: 100 }} className="r">
              {tt('production.coverage.col.reserved')}
            </th>
            <th style={{ width: 100 }} className="r">
              {tt('production.coverage.col.placed')}
            </th>
            <th style={{ width: 110 }} className="r">
              {tt('production.coverage.col.notEnsured')}
            </th>
            <th style={{ width: 90 }} className="r">
              {tt('production.coverage.col.free')}
            </th>
            <th style={{ width: 100 }} className="r">
              {tt('production.coverage.col.incoming')}
            </th>
            <th style={{ width: 120 }}>{tt('production.coverage.col.coverage')}</th>
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
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'reserves' })} title={tt('production.coverage.drill.reserves')}>
                  {r.reserved}
                </button>
              </td>
              <td className="r num">
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'placements' })} title={tt('production.coverage.drill.placements')}>
                  {r.placed}
                </button>
              </td>
              <td className="r num">{r.notEnsured}</td>
              <td className="r num muted">{r.free}</td>
              <td className="r num">
                <button type="button" className="num underline decoration-dotted cursor-pointer" onClick={() => setDrill({ row: r, kind: 'incoming' })} title={tt('production.coverage.drill.incoming')}>
                  {r.incoming}
                </button>
              </td>
              <td>
                <Badge tone={COVERAGE_TONE[r.status]} dot>
                  {tProductionEnum('coverage', r.status, r.status)}
                </Badge>
              </td>
              {canWrite && (
                <td className="r">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(r)} title={tt('production.coverage.changeReserve')}>
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
  const tt = useT();
  const { row, kind } = drill;
  const title =
    kind === 'reserves' ? tt('production.coverage.drill.reserves') : kind === 'placements' ? tt('production.coverage.drill.placements') : tt('production.coverage.drill.incoming');
  const rows =
    kind === 'reserves'
      ? row.reserves.map(r => ({ key: r.warehouseId, title: r.warehouseName, qty: r.qty, note: r.orderNumber }))
      : kind === 'placements'
        ? row.placements.map(p => ({ key: p.documentId, title: p.number ?? tt('production.common.draft'), qty: p.qty, note: fmtDate(new Date(p.date)) }))
        : row.incomingDocs.map(p => ({ key: p.documentId, title: p.number ?? tt('production.common.draft'), qty: p.qty, note: fmtDate(new Date(p.date)) }));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`${title}: ${row.productName}`}
        description={kind === 'reserves' ? tt('production.coverage.drillDesc.reserves') : kind === 'placements' ? tt('production.coverage.drillDesc.placements') : tt('production.coverage.drillDesc.incoming')}
      >
        {!rows.length ? (
          <p className="faint">{tt('production.common.nothing')}</p>
        ) : (
          <table className="dtbl">
            <thead>
              <tr>
                <th>{kind === 'reserves' ? tt('production.coverage.reserveWarehouse') : tt('production.common.document')}</th>
                <th style={{ width: 110 }}>{tt('production.coverage.col.dateOrNumber')}</th>
                <th style={{ width: 90 }} className="r">
                  {tt('production.field.quantity')}
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
  const tt = useT();
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
        title={`${tt('production.coverage.reserveTitle')}: ${row.productName}`}
        description={tt('production.coverage.reserveDesc')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {tt('production.common.save')}
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
          <Field label={tt('production.coverage.toReserve')} hint={tt('production.coverage.freeForReserve', { qty: row.freeAtReserve })}>
            {p => <Input {...p} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} />}
          </Field>
          <Field label={tt('production.coverage.reserveWarehouse')}>
            {p => (
              <Select
                id={p.id}
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={(warehouses.data ?? []).map(w => ({ value: w.id, label: w.name }))}
                placeholder={tt('production.coverage.chooseWarehouse')}
                aria-label={tt('production.coverage.reserveWarehouse')}
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
  const tt = useT();
  const canWrite = useCanWrite();
  const api = useProductionOrderApi();
  if (!canWrite) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="ghost" onClick={() => void api.semiOrders.mutateAsync(orderId)}>
        <Boxes size={13} />
        {tt('production.coverage.createSemi')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void api.supplierOrders.mutateAsync({ id: orderId })}>
        <Truck size={13} />
        {tt('production.coverage.createSupplier')}
      </Button>
    </div>
  );
}

/** Переключатель «Show stock» */
export function StockToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const tt = useT();
  return (
    <Button size="sm" variant={on ? 'primary' : 'ghost'} onClick={onToggle} title={tt('production.coverage.stockToggleHint')}>
      <PackageSearch size={13} />
      {tt('production.coverage.stockToggle')}
    </Button>
  );
}
