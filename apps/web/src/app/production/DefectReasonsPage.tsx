/* Справочник причин брака (задача 1186): название и пояснение, архив. Меняет admin и выше. */
import * as React from 'react';
import { CircleAlert, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/gr8r/data-table';
import { t, useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useProductionApi } from './data';
import { useDefectReasons, type DefectReason } from './quality-data';

export function DefectReasonsPage() {
  const tt = useT();
  const isAdmin = useIsAdmin();
  const q = useDefectReasons();
  const api = useProductionApi();
  const [dialog, setDialog] = React.useState<{ reason?: DefectReason } | null>(null);
  const [removing, setRemoving] = React.useState<DefectReason | null>(null);
  const rows = (q.data ?? []).filter(r => !r.archivedAt);

  const columns = React.useMemo<Column<DefectReason>[]>(
    () => [
      { id: 'name', header: tt('production.defectReasons.col.name'), width: 280, value: r => r.name, cell: r => <span style={{ fontWeight: 450 }}>{r.name}</span> },
      { id: 'note', header: tt('production.defectReasons.col.note'), width: 420, value: r => r.note, cell: r => <span className="trunc muted">{r.note || '—'}</span> },
      {
        id: 'actions',
        header: '',
        width: 84,
        hideable: false,
        sortable: false,
        cell: r =>
          isAdmin ? (
            <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('production.defectReasons.edit') + ' ' + r.name} onClick={() => setDialog({ reason: r })}>
                <Pencil size={13} />
              </button>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('production.common.archive') + ' ' + r.name} onClick={() => setRemoving(r)}>
                <Trash2 size={13} />
              </button>
            </span>
          ) : null,
      },
    ],
    [isAdmin, tt],
  );
  const table = useDataTable(columns, { hidden: [] });
  const newBtn = isAdmin && (
    <Button variant="primary" onClick={() => setDialog({})}>
      <Plus size={14} />
      {t('production.defectReasons.new')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.defectReasons.title')}</h1>
          <p>{t('production.defectReasons.subtitle')}</p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      {q.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.defectReasons.table')} action={<Button size="sm" onClick={() => q.refetch()}>{t('production.common.retry')}</Button>}>
          {(q.error as Error).message}
        </EmptyState>
      ) : q.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : (
        <DataTable
          aria-label={t('production.defectReasons.table')}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          showTotals={false}
          onNew={isAdmin ? () => setDialog({}) : undefined}
          newLabel={t('production.defectReasons.new')}
          empty={
            <EmptyState icon={<ShieldAlert size={20} />} title={t('production.defectReasons.empty')} action={newBtn || undefined}>
              {t('production.defectReasons.emptyHint')}
            </EmptyState>
          }
        />
      )}
      {dialog && <ReasonDialog reason={dialog.reason} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        title={t('production.common.archive') + ' ' + t('production.defectReasons.one')}
        description={removing ? <><b>{removing.name}</b> — {t('production.defectReasons.archiveHint')}</> : undefined}
        confirmLabel={t('production.common.archive')}
        cancelLabel={t('production.common.cancel')}
        onConfirm={async () => {
          if (removing && (await api('DELETE', `/defect-reasons/${removing.id}`))) toast(t('production.toast.archived'));
          setRemoving(null);
        }}
      />
    </div>
  );
}

function ReasonDialog({ reason, onClose }: { reason?: DefectReason; onClose: () => void }) {
  const tt = useT();
  const api = useProductionApi();
  const [name, setName] = React.useState(reason?.name ?? '');
  const [note, setNote] = React.useState(reason?.note ?? '');
  const [err, setErr] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr(tt('common.enterName'));
    setBusy(true);
    const body = { name: name.trim(), note: note.trim() };
    const r = reason ? await api('PATCH', `/defect-reasons/${reason.id}`, body) : await api('POST', '/defect-reasons', body);
    setBusy(false);
    if (!r) return;
    toast(tt('production.common.saved'));
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={reason ? tt('production.defectReasons.edit') : tt('production.defectReasons.newTitle')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {reason ? tt('production.common.save') : tt('production.common.create')}
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
          <Field label={tt('production.defectReasons.col.name')} error={err}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr(undefined))} />}
          </Field>
          <Field label={tt('production.defectReasons.col.note')}>{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
