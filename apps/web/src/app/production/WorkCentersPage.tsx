/* Справочник участков (work centers): название, код, ставка за час. Меняет admin и выше. */
import * as React from 'react';
import { CircleAlert, Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { t, useT } from '@/i18n';
import { money, useIsAdmin } from '../catalog/data';
import { useWarehouses } from '../docs/data';
import { useProductionApi, useSnapshot, type WorkCenter } from './data';

export function WorkCentersPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const snap = useSnapshot();
  const api = useProductionApi();
  const warehouses = useWarehouses();
  const workshops = (warehouses.data ?? []).filter(w => w.kind === 'workshop');
  const [dialog, setDialog] = React.useState<{ wc?: WorkCenter } | null>(null);
  const [removing, setRemoving] = React.useState<WorkCenter | null>(null);
  const rows = (snap.data?.workCenters ?? []).filter(w => !w.archivedAt);

  const columns = React.useMemo<Column<WorkCenter>[]>(
    () => [
      { id: 'name', header: tt('production.workCenters.col.name'), width: 280, value: w => w.name, cell: w => <span style={{ fontWeight: 450 }}>{w.name}</span> },
      { id: 'code', header: tt('production.workCenters.col.code'), width: 120, value: w => w.code, cell: w => (w.code ? <span className="mono">{w.code}</span> : <span className="faint">—</span>) },
      { id: 'rate', header: tt('production.workCenters.col.rate'), width: 140, align: 'right', value: w => Number(w.hourlyRate), cell: w => <span className="num">{money(w.hourlyRate)}</span> },
      { id: 'warehouse', header: tt('production.workCenters.col.warehouse'), width: 190, defaultHidden: true, value: w => w.warehouseId ?? '', cell: w => <span className="trunc muted">{w.warehouseId ? (workshops.find(x => x.id === w.warehouseId)?.name ?? '—') : '—'}</span> },
      { id: 'note', header: tt('production.workCenters.col.comment'), width: 320, value: w => w.note, cell: w => <span className="trunc muted">{w.note || '—'}</span> },
      {
        id: 'actions',
        header: '',
        width: 84,
        hideable: false,
        sortable: false,
        cell: w =>
          isAdmin ? (
            <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('production.workCenters.edit') + ' ' + w.name} onClick={() => setDialog({ wc: w })}>
                <Pencil size={13} />
              </button>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('production.common.delete') + ' ' + w.name} onClick={() => setRemoving(w)}>
                <Trash2 size={13} />
              </button>
            </span>
          ) : null,
      },
    ],
    [isAdmin, workshops, tt],
  );
  const table = useDataTable(columns, { hidden: [] });
  const newBtn = isAdmin && (
    <Button variant="primary" onClick={() => setDialog({})}>
      <Plus size={14} />
      {t('production.workCenters.new')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.workCenters.title')}</h1>
          <p>{t('production.workCenters.subtitle')}</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      {snap.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.workCenters.table')} action={<Button size="sm" onClick={() => snap.refetch()}>{t('production.common.retry')}</Button>}>
          {(snap.error as Error).message}
        </EmptyState>
      ) : snap.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('production.workCenters.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={w => w.id}
          showTotals={false}
          onNew={isAdmin ? () => setDialog({}) : undefined}
          newLabel={t('production.workCenters.new')}
          empty={
            <EmptyState icon={<Factory size={20} />} title={t('production.workCenters.noCenters')} action={newBtn || undefined}>
              {t('production.workCenters.noCentersHint')}
            </EmptyState>
          }
        />
      )}
      {dialog && <CenterDialog wc={dialog.wc} workshops={workshops.map(w => ({ id: w.id, name: w.name }))} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title={t('production.common.delete') + ' ' + t('production.workCenters.title')}
        description={removing ? <><b>{removing.name}</b></> : undefined}
        confirmLabel={t('production.common.delete')}
        cancelLabel={t('production.common.cancel')}
        onConfirm={async () => {
          if (removing && (await api('DELETE', `/work-centers/${removing.id}?hard=true`))) toast(t('production.workCenters.deleted'));
          setRemoving(null);
        }}
      />
    </div>
  );
}

function CenterDialog({ wc, workshops, onClose }: { wc?: WorkCenter; workshops: { id: string; name: string }[]; onClose: () => void }) {
  const tt = useT();
  const api = useProductionApi();
  const [name, setName] = React.useState(wc?.name ?? '');
  const [code, setCode] = React.useState(wc?.code ?? '');
  const [rate, setRate] = React.useState(wc ? String(Number(wc.hourlyRate)) : '');
  const [warehouseId, setWarehouseId] = React.useState(wc?.warehouseId ?? '');
  const [note, setNote] = React.useState(wc?.note ?? '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = tt('common.enterName');
    if (rate.trim() !== '' && !(Number(rate) >= 0)) errs.rate = tt('catalog.product.nonNegative');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), hourlyRate: rate.trim() === '' ? 0 : Number(rate), warehouseId: warehouseId || null, note: note.trim() };
    const r = wc ? await api('PATCH', `/work-centers/${wc.id}`, body) : await api('POST', '/work-centers', body);
    setBusy(false);
    if (!r) return;
    toast(t('production.common.saved'));
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={wc ? tt('production.workCenters.edit') : tt('production.workCenters.newTitle')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {wc ? tt('production.common.save') : tt('production.common.create')}
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
          <Field label={tt('production.workCenters.fields.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={tt('production.workCenters.fields.code')} className="grow">
              {p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}
            </Field>
            <Field label={tt('production.workCenters.fields.rate')} className="grow" error={err.rate}>
              {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />}
            </Field>
          </div>
          <Field label={tt('production.workCenters.fields.warehouse')} hint="">
            {p => (
              <select className="select" id={p.id} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                <option value="">{tt('production.common.notChosen')}</option>
                {workshops.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={tt('production.workCenters.fields.comment')}>{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
