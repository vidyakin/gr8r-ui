/* Справочник «Этапы»: виды производства и их упорядоченные этапы. Последний этап вида — финальный
   («Завершение производства»): продукция приходуется только им. Меняет admin и выше. */
import * as React from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Skeleton, toast } from '@/components/ui';
import { t, useT } from '@/i18n';
import { useIsAdmin } from '../catalog/data';
import { useProductionApi, useProductionKinds, type ProductionKind, type ProductionStage } from './data';

interface StageDraft {
  id?: string;
  name: string;
}

export function ProductionStagesPage() {
  const isAdmin = useIsAdmin();
  const kinds = useProductionKinds();
  const api = useProductionApi();
  const [dialog, setDialog] = React.useState<{ kind?: ProductionKind } | null>(null);
  const [removing, setRemoving] = React.useState<ProductionKind | null>(null);
  const items = kinds.data?.items ?? [];

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('production.stages.title')}</h1>
          <p>{t('production.stages.subtitle')}</p>
        </div>
        <div className="acts">
          {isAdmin && (
            <Button variant="primary" onClick={() => setDialog({})}>
              <Plus size={14} />
              {t('production.stages.kind.new')}
            </Button>
          )}
        </div>
      </div>

      {kinds.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('production.stages.title')} action={<Button size="sm" onClick={() => kinds.refetch()}>{t('production.common.retry')}</Button>}>
          {(kinds.error as Error).message}
        </EmptyState>
      ) : kinds.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={<Layers size={20} />}
          title={t('production.stages.kind.noKinds')}
          action={
            isAdmin ? (
              <Button variant="primary" onClick={() => setDialog({})}>
                <Plus size={14} />
                {t('production.stages.kind.new')}
              </Button>
            ) : undefined
          }
        >
          {t('production.stages.kind.noKindsHint')}
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 12, padding: '0 var(--gutter) 24px' }}>
          {items.map(k => (
            <section key={k.id} className="panel" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 550 }}>{k.name}</div>
                  {k.note && <div className="faint" style={{ fontSize: 12.5 }}>{k.note}</div>}
                </div>
                {isAdmin && (
                  <div className="row" style={{ gap: 2 }}>
                    <button type="button" className="ibtn ibtn-xs" aria-label={`${t('production.common.edit')} ${k.name}`} onClick={() => setDialog({ kind: k })}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" className="ibtn ibtn-xs" aria-label={`${t('production.common.delete')} ${k.name}`} onClick={() => setRemoving(k)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              <ol style={{ margin: '10px 0 0', paddingLeft: 22, display: 'grid', gap: 4 }}>
                {k.stages.map((s: ProductionStage) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    {s.isFinal && (
                      <Badge tone="accent" style={{ marginLeft: 8 }}>
                        {t('production.stages.stage.final')}
                      </Badge>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {dialog && <KindDialog kind={dialog.kind} onClose={() => setDialog(null)} />}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => !o && setRemoving(null)}
        danger
        title={t('production.stages.kind.removeTitle')}
        description={removing ? <><b>{removing.name}</b></> : undefined}
        confirmLabel={t('production.common.delete')}
        cancelLabel={t('production.common.cancel')}
        onConfirm={async () => {
          if (removing && (await api('DELETE', `/production/kinds/${removing.id}`))) toast(t('production.stages.deleted'));
          setRemoving(null);
        }}
      />
    </div>
  );
}

/** Форма вида производства: наименование и список этапов по порядку */
function KindDialog({ kind, onClose }: { kind?: ProductionKind; onClose: () => void }) {
  const tt = useT();
  const api = useProductionApi();
  const [name, setName] = React.useState(kind?.name ?? '');
  const [note, setNote] = React.useState(kind?.note ?? '');
  const [stages, setStages] = React.useState<StageDraft[]>(() => (kind ? kind.stages.map(s => ({ id: s.id, name: s.name })) : [{ name: '' }]));
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const move = (i: number, dir: -1 | 1) => setStages(prev => {
    const next = [...prev];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = tt('common.enterName');
    if (!stages.length || stages.some(s => !s.name.trim())) errs.stages = tt('production.stages.stage.name');
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { name: name.trim(), note: note.trim(), stages: stages.map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim() })) };
    const r = kind ? await api('PATCH', `/production/kinds/${kind.id}`, body) : await api('POST', '/production/kinds', body);
    setBusy(false);
    if (!r) return;
    toast(t('production.stages.saved'));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={kind ? tt('production.stages.kind.edit') : tt('production.stages.kind.new')}
        description={tt('production.stages.subtitle')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{tt('production.common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {kind ? tt('production.common.save') : tt('production.common.create')}
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
          <Field label={tt('production.field.name')} error={err.name}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <Field label={tt('production.field.note')}>{p => <Input {...p} value={note} onChange={e => setNote(e.target.value)} />}</Field>
          <Field label={tt('production.stages.kind.col.stages')} error={err.stages} hint={tt('production.stages.stage.final')}>
            {() => (
              <div style={{ display: 'grid', gap: 6 }}>
                {stages.map((s, i) => (
                  <div key={s.id ?? i} className="row" style={{ gap: 6 }}>
                    <Input aria-label={tt('production.stages.stage.name') + ` ${i + 1}`} value={s.name} onChange={e => setStages(prev => prev.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.stages.stage.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.stages.stage.moveDown')} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={13} />
                    </button>
                    <button type="button" className="ibtn ibtn-xs" aria-label={tt('production.stages.stage.remove')} disabled={stages.length === 1} onClick={() => setStages(prev => prev.filter((_, n) => n !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setStages(prev => [...prev, { name: '' }])}>
                  <Plus size={13} />
                  {tt('production.stages.stage.add')}
                </Button>
              </div>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
