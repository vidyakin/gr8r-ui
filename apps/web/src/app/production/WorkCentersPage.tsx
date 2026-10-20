/* Справочник участков (work centers): название, код, ставка за час. Меняет admin и выше. */
import * as React from 'react';
import { CircleAlert, Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { money, useIsAdmin } from '../catalog/data';
import { useProductionApi, useSnapshot, type WorkCenter } from './data';

export function WorkCentersPage() {
  const isAdmin = useIsAdmin();
  const snap = useSnapshot();
  const api = useProductionApi();
  const [dialog, setDialog] = React.useState<{ wc?: WorkCenter } | null>(null);
  const [removing, setRemoving] = React.useState<WorkCenter | null>(null);
  const rows = (snap.data?.workCenters ?? []).filter(w => !w.archivedAt);

  const columns = React.useMemo<Column<WorkCenter>[]>(
    () => [
      { id: 'name', header: 'Name', width: 280, value: w => w.name, cell: w => <span style={{ fontWeight: 450 }}>{w.name}</span> },
      { id: 'code', header: 'Code', width: 120, value: w => w.code, cell: w => (w.code ? <span className="mono">{w.code}</span> : <span className="faint">—</span>) },
      { id: 'rate', header: 'Rate per hour', width: 140, align: 'right', value: w => Number(w.hourlyRate), cell: w => <span className="num">{money(w.hourlyRate)}</span> },
      { id: 'note', header: 'Note', width: 320, value: w => w.note, cell: w => <span className="trunc muted">{w.note || '—'}</span> },
      {
        id: 'actions',
        header: '',
        width: 84,
        hideable: false,
        sortable: false,
        cell: w =>
          isAdmin ? (
            <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
              <button type="button" className="ibtn ibtn-xs" aria-label={`Edit ${w.name}`} onClick={() => setDialog({ wc: w })}>
                <Pencil size={13} />
              </button>
              <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${w.name}`} onClick={() => setRemoving(w)}>
                <Trash2 size={13} />
              </button>
            </span>
          ) : null,
      },
    ],
    [isAdmin],
  );
  const table = useDataTable(columns, { hidden: [] });
  const newBtn = isAdmin && (
    <Button variant="primary" onClick={() => setDialog({})}>
      <Plus size={14} />
      New work center
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Work centers</h1>
          <p>Shops and crews with an hourly rate. Work operations in a bill of materials take their rate from here.</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      {snap.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title="Could not load work centers" action={<Button size="sm" onClick={() => snap.refetch()}>Retry</Button>}>
          {(snap.error as Error).message}
        </EmptyState>
      ) : snap.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label="Work centers table"
          columns={columns}
          rows={rows}
          table={table}
          getId={w => w.id}
          showTotals={false}
          onNew={isAdmin ? () => setDialog({}) : undefined}
          newLabel="New work center"
          empty={
            <EmptyState icon={<Factory size={20} />} title="No work centers yet" action={newBtn || undefined}>
              Add the shops where your products are made.
            </EmptyState>
          }
        />
      )}
      {dialog && <CenterDialog wc={dialog.wc} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title="Delete work center?"
        description={removing ? <><b>{removing.name}</b> will be deleted. A work center used in a bill of materials cannot be deleted.</> : undefined}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (removing && (await api('DELETE', `/work-centers/${removing.id}?hard=true`))) toast(`Deleted “${removing.name}”`);
          setRemoving(null);
        }}
      />
    </div>
  );
}

function CenterDialog({ wc, onClose }: { wc?: WorkCenter; onClose: () => void }) {
  const api = useProductionApi();
  const [name, setName] = React.useState(wc?.name ?? '');
  const [code, setCode] = React.useState(wc?.code ?? '');
  const [rate, setRate] = React.useState(wc ? String(Number(wc.hourlyRate)) : '');
  const [note, setNote] = React.useState(wc?.note ?? '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Enter a name';
    if (rate.trim() !== '' && !(Number(rate) >= 0)) errs.rate = 'Enter a non-negative number';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), hourlyRate: rate.trim() === '' ? 0 : Number(rate), note: note.trim() };
    const r = wc ? await api('PATCH', `/work-centers/${wc.id}`, body) : await api('POST', '/work-centers', body);
    setBusy(false);
    if (!r) return;
    toast(wc ? `Saved “${body.name}”` : `Added “${body.name}”`);
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={wc ? 'Edit work center' : 'New work center'}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {wc ? 'Save' : 'Create work center'}
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
          <Field label="Name" error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Code" className="grow">
              {p => <Input {...p} value={code} onChange={e => setCode(e.target.value)} />}
            </Field>
            <Field label="Rate per hour" className="grow" error={err.rate}>
              {p => <Input {...p} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />}
            </Field>
          </div>
          <Field label="Note">{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
