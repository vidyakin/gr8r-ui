/* Settings → Data model: сущности воркспейса и их поля (конструктор). Системные сущности (задачи, сделки, компании, контакты,
   проекты) получают пользовательские поля; свои сущности создаются целиком. Менять модель может admin и выше. */
import * as React from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, GripVertical, Lock, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { CHOICE_COLORS, FIELD_TYPES, FIELD_TYPE_LABELS, fieldCreate, keyFromName, type FieldChoice, type FieldType } from '@gr8r/shared';
import { Alert, Badge, Button, Checkbox, Dialog, DialogClose, DialogContent, Field, Input, Radio, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { ChoiceLabel, FIELD_ICONS } from '../meta/field-ui';
import { ENTITY_ICON_NAMES, entityIcon } from '../meta/icons';
import { activeFields, call, metaKey, useAllEntities, useWsId, type MetaEntity, type MetaField } from '../meta/data';
import { SettingsHead } from './parts';

/* ---------------- запросы с обновлением метаданных ---------------- */

function useMetaApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        await qc.invalidateQueries({ queryKey: metaKey(ws) });
        // значения custom системных записей могли измениться (очистка поля) — их кэш лежит в движке данных
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

const SYSTEM_HINT: Record<string, string> = {
  task: 'Fields appear in the task card and as columns in the task table.',
  deal: 'Fields appear in the deal card.',
  company: 'Fields appear on the company page.',
  contact: 'Fields appear in the contact card.',
  project: 'Fields are stored with the project; shown through the API.',
};

/* ---------------- раздел ---------------- */

export function DataModelSection({ title }: { title: string }) {
  const { active } = useSession();
  const canEdit = active?.role === 'owner' || active?.role === 'admin';
  const all = useAllEntities();
  const entities = (all.data ?? []).filter(e => !e.archivedAt);
  const removed = (all.data ?? []).filter(e => e.archivedAt);
  const [sel, setSel] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const current = entities.find(e => e.key === sel) ?? entities.find(e => e.kind === 'custom') ?? entities[0];
  const system = entities.filter(e => e.kind === 'system');
  const custom = entities.filter(e => e.kind === 'custom');

  const item = (e: MetaEntity) => {
    const Icon = entityIcon(e.icon);
    return (
      <button key={e.key} className={cn('dm-item', current?.key === e.key && 'on')} onClick={() => setSel(e.key)} aria-label={`Entity ${e.name}`}>
        <Icon size={15} />
        <span className="trunc">{e.name}</span>
        <span className="ct">{activeFields(e).length}</span>
      </button>
    );
  };

  return (
    <>
      <SettingsHead title={title} lead="Describe your own entities and add custom fields to built-in ones. Everything you define here shows up in the app automatically." />
      {!canEdit && (
        <Alert tone="info" className="mb-4">
          Only admins and owners can change the data model. You can view it.
        </Alert>
      )}
      <div className="dm">
        <div className="dm-list" role="list" aria-label="Entities">
          <div className="gh">Built-in</div>
          {system.map(item)}
          <div className="gh">Custom</div>
          {custom.map(item)}
          {!custom.length && <div className="faint" style={{ padding: '4px 8px', fontSize: 12.5 }}>No custom entities yet</div>}
          {canEdit && (
            <Button size="sm" variant="secondary" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
              <Plus size={13} />
              New entity
            </Button>
          )}
          {canEdit && !!removed.length && <RemovedEntities list={removed} />}
        </div>
        {current ? <EntityEditor key={current.id} entity={current} canEdit={canEdit} onDeleted={() => setSel(null)} /> : <div className="faint">Loading…</div>}
      </div>
      {creating && <NewEntityDialog onClose={() => setCreating(false)} onCreated={key => setSel(key)} />}
    </>
  );
}

function RemovedEntities({ list }: { list: MetaEntity[] }) {
  const api = useMetaApi();
  const [purge, setPurge] = React.useState<MetaEntity | null>(null);
  return (
    <div className="dm-removed">
      <div className="gh">Removed</div>
      {list.map(e => (
        <div key={e.id} className="row" style={{ gap: 6, padding: '2px 8px', fontSize: 13 }}>
          <span className="trunc muted" style={{ flex: 1 }}>
            {e.name}
          </span>
          <button className="ibtn ibtn-xs" aria-label={`Restore ${e.name}`} title="Restore" onClick={async () => (await api('POST', `/entities/${e.key}/restore`)) && toast(`Restored “${e.name}”`)}>
            <RotateCcw size={13} />
          </button>
          <button className="ibtn ibtn-xs" aria-label={`Delete ${e.name} permanently`} title="Delete permanently" onClick={() => setPurge(e)}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {purge && <DeleteEntityDialog entity={purge} onClose={() => setPurge(null)} onDeleted={() => setPurge(null)} onlyPurge />}
    </div>
  );
}

/* ---------------- редактор сущности ---------------- */

function EntityEditor({ entity: e, canEdit, onDeleted }: { entity: MetaEntity; canEdit: boolean; onDeleted: () => void }) {
  const api = useMetaApi();
  const Icon = entityIcon(e.icon);
  const live = activeFields(e);
  const removed = e.fields.filter(f => f.archivedAt);
  const [dialog, setDialog] = React.useState<{ field?: MetaField } | null>(null);
  const [delField, setDelField] = React.useState<MetaField | null>(null);
  const [delEntity, setDelEntity] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const custom = e.kind === 'custom';

  const drop = async (targetId: string) => {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (!from || from === targetId) return;
    const ids = live.map(f => f.id).filter(id => id !== from);
    ids.splice(ids.indexOf(targetId), 0, from);
    await api('POST', `/entities/${e.key}/fields/reorder`, { ids });
  };

  return (
    <div>
      <div className="dm-head">
        <Icon size={20} />
        <h2>{e.name}</h2>
        <span className="mono faint" style={{ fontSize: 12 }}>
          {e.key}
        </span>
        {!custom && <Badge tone="gray">Built-in</Badge>}
        <span className="sp" style={{ flex: 1 }} />
        {custom && (
          <Link to={`/data/${e.key}`} className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Open <ArrowUpRight size={13} />
          </Link>
        )}
        {custom && canEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDelEntity(true)}>
              <Trash2 size={13} />
              Delete
            </Button>
          </>
        )}
      </div>
      {!custom && <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>{SYSTEM_HINT[e.key]} Built-in columns (title, status, amount…) are fixed.</p>}
      {custom && canEdit && <EntityMeta entity={e} />}

      <div className="dm-fields" role="table" aria-label={`${e.name} fields`}>
        <div className="dm-row head" role="row">
          <span />
          <span>Field</span>
          <span>Type</span>
          <span className="hide-s">Settings</span>
          <span />
        </div>
        {custom && (
          <div className="dm-row" role="row" style={{ background: 'var(--surface-2)' }}>
            <Lock size={13} className="faint" />
            <span className="muted">Created, Updated</span>
            <span className="faint">System</span>
            <span className="faint hide-s">Always present</span>
            <span />
          </div>
        )}
        {live.map(f => {
          const I = FIELD_ICONS[f.type];
          return (
            <div
              key={f.id}
              role="row"
              data-field={f.key}
              className={cn('dm-row', dragId === f.id && 'dragging', overId === f.id && dragId !== f.id && 'drag-over')}
              draggable={canEdit}
              onDragStart={ev => {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', f.id);
                setDragId(f.id);
              }}
              onDragOver={ev => {
                if (!dragId) return;
                ev.preventDefault();
                setOverId(f.id);
              }}
              onDrop={ev => {
                ev.preventDefault();
                void drop(f.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="dm-grip" aria-hidden title={canEdit ? 'Drag to reorder' : undefined} style={canEdit ? undefined : { cursor: 'default', opacity: 0.3 }}>
                <GripVertical size={14} />
              </span>
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                <I size={14} className="faint" />
                <span className="trunc" style={{ fontWeight: 450 }}>
                  {f.name}
                </span>
                {f.key === e.titleField && custom && <Badge tone="accent">Title</Badge>}
              </span>
              <span className="muted">{FIELD_TYPE_LABELS[f.type]}</span>
              <span className="row hide-s" style={{ gap: 4, flexWrap: 'wrap' }}>
                {f.required && <Badge>Required</Badge>}
                {f.unique && <Badge>Unique</Badge>}
                {f.filterable && <Badge tone="green">Indexed</Badge>}
                {(f.type === 'select' || f.type === 'multi_select') && (f.options.choices ?? []).slice(0, 3).map(c => <ChoiceLabel key={c.value} choice={c} />)}
                {(f.type === 'ref' || f.type === 'refs') && <span className="muted">→ {f.options.refEntity}</span>}
              </span>
              <span className="row" style={{ gap: 2 }}>
                {canEdit && (
                  <>
                    <button className="ibtn ibtn-xs" aria-label={`Edit ${f.name}`} onClick={() => setDialog({ field: f })}>
                      <Pencil size={13} />
                    </button>
                    {f.key !== e.titleField && (
                      <button className="ibtn ibtn-xs" aria-label={`Delete ${f.name}`} onClick={() => setDelField(f)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
        {!live.length && (
          <div className="dm-row" role="row" style={{ display: 'block', padding: 14 }}>
            <span className="faint">No custom fields yet.</span>
          </div>
        )}
      </div>
      {canEdit && (
        <Button variant="secondary" size="sm" style={{ marginTop: 12 }} onClick={() => setDialog({})}>
          <Plus size={13} />
          Add field
        </Button>
      )}

      {!!removed.length && canEdit && (
        <div className="dm-removed">
          <h3>Removed fields — data is kept until you delete them permanently</h3>
          <div className="dm-fields">
            {removed.map(f => (
              <div key={f.id} className="dm-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                <span className="muted trunc">
                  {f.name} <span className="mono faint">{f.key}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={async () => (await api('POST', `/entities/${e.key}/fields/${f.id}/restore`)) && toast(`Restored “${f.name}”`)}>
                  <RotateCcw size={13} />
                  Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDelField(f)}>
                  <Trash2 size={13} />
                  Delete permanently
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialog && <FieldDialog entity={e} field={dialog.field} onClose={() => setDialog(null)} />}
      {delField && <DeleteFieldDialog entity={e} field={delField} onClose={() => setDelField(null)} />}
      {delEntity && <DeleteEntityDialog entity={e} onClose={() => setDelEntity(false)} onDeleted={onDeleted} />}
    </div>
  );
}

/** Название, значок и поле-заголовок своей сущности */
function EntityMeta({ entity: e }: { entity: MetaEntity }) {
  const api = useMetaApi();
  const [name, setName] = React.useState(e.name);
  const texts = activeFields(e).filter(f => f.type === 'text');
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
      <Field label="Name" className="grow">
        {p => (
          <Input
            {...p}
            value={name}
            onChange={ev => setName(ev.target.value)}
            onBlur={() => name.trim() && name.trim() !== e.name && void api('PATCH', `/entities/${e.key}`, { name: name.trim() })}
            onKeyDown={ev => ev.key === 'Enter' && ev.currentTarget.blur()}
          />
        )}
      </Field>
      <Field label="Title field">
        {p => (
          <select className="select" id={p.id} value={e.titleField} onChange={ev => void api('PATCH', `/entities/${e.key}`, { titleField: ev.target.value })}>
            {texts.map(f => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Icon">
        {() => <IconPicker value={e.icon} onChange={icon => void api('PATCH', `/entities/${e.key}`, { icon })} />}
      </Field>
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="dm-icons" role="radiogroup" aria-label="Icon">
      {ENTITY_ICON_NAMES.map(n => {
        const I = entityIcon(n);
        return (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={n} className={cn(value === n && 'on')} onClick={() => onChange(n)}>
            <I size={16} />
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- диалоги ---------------- */

function NewEntityDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const api = useMetaApi();
  const [name, setName] = React.useState('');
  const [icon, setIcon] = React.useState('database');
  const [titleFieldName, setTitle] = React.useState('Name');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!name.trim()) return setErr('Give the entity a name');
    setBusy(true);
    const r = await api<MetaEntity>('POST', '/entities', { name: name.trim(), icon, titleFieldName: titleFieldName.trim() || 'Name' });
    setBusy(false);
    if (!r) return;
    toast(`Created “${r.name}”`);
    onCreated(r.key);
    onClose();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title="New entity"
        description="Records of the new entity get their own section in the sidebar."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              Create entity
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
          <Field label="Name" error={err}>
            {p => <Input {...p} autoFocus placeholder="e.g. Suppliers" value={name} onChange={e => (setName(e.target.value), setErr(''))} />}
          </Field>
          <Field label="Title field" hint="The main text of every record: shown as its name in tables, cards and search.">
            {p => <Input {...p} value={titleFieldName} onChange={e => setTitle(e.target.value)} />}
          </Field>
          <Field label="Icon">{() => <IconPicker value={icon} onChange={setIcon} />}</Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ChoiceDraft extends FieldChoice {
  isNew?: boolean;
}

function FieldDialog({ entity: e, field, onClose }: { entity: MetaEntity; field?: MetaField; onClose: () => void }) {
  const api = useMetaApi();
  const all = useAllEntities();
  const edit = !!field;
  const [name, setName] = React.useState(field?.name ?? '');
  const [type, setType] = React.useState<FieldType>(field?.type ?? 'text');
  const [required, setRequired] = React.useState(field?.required ?? false);
  const [unique, setUnique] = React.useState(field?.unique ?? false);
  const [filterable, setFilterable] = React.useState(field?.filterable ?? false);
  const [choices, setChoices] = React.useState<ChoiceDraft[]>(field?.options.choices?.map(c => ({ ...c })) ?? [{ value: 'option_1', label: 'Option 1', color: 'blue', isNew: true }]);
  const [refEntity, setRefEntity] = React.useState(field?.options.refEntity ?? '');
  const [min, setMin] = React.useState(field?.options.min != null ? String(field.options.min) : '');
  const [max, setMax] = React.useState(field?.options.max != null ? String(field.options.max) : '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const targets = (all.data ?? []).filter(x => !x.archivedAt);

  const setChoice = (i: number, patch: Partial<ChoiceDraft>) =>
    setChoices(list =>
      list.map((c, j) => {
        if (i !== j) return c;
        const next = { ...c, ...patch };
        if (c.isNew && patch.label !== undefined) {
          // значение нового варианта строится из подписи и остаётся уникальным
          let v = keyFromName(patch.label, 'option');
          const taken = new Set(list.filter((_, k) => k !== i).map(x => x.value));
          for (let n = 2; taken.has(v); n++) v = `${keyFromName(patch.label, 'option')}_${n}`;
          next.value = v;
        }
        return next;
      }),
    );

  const submit = async () => {
    const options: Record<string, unknown> = {};
    if (type === 'select' || type === 'multi_select') options.choices = choices.filter(c => c.label.trim()).map(({ isNew: _n, ...c }) => ({ ...c, label: c.label.trim() }));
    if (type === 'ref' || type === 'refs') options.refEntity = refEntity || undefined;
    if (['number', 'money', 'percent'].includes(type)) {
      if (min.trim() !== '') options.min = Number(min);
      if (max.trim() !== '') options.max = Number(max);
    }
    const body = { name: name.trim(), type, required, unique, filterable, options };
    const parsed = fieldCreate.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      return setErr(out);
    }
    setBusy(true);
    const r = edit
      ? await api('PATCH', `/entities/${e.key}/fields/${field!.id}`, { name: body.name, required, unique, filterable, options })
      : await api('POST', `/entities/${e.key}/fields`, body);
    setBusy(false);
    if (!r) return;
    toast(edit ? `Saved “${body.name}”` : `Added field “${body.name}”`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={edit ? `Edit field “${field!.name}”` : `New field in ${e.name}`}
        description={edit ? 'The type and key of a field cannot be changed.' : undefined}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? 'Save field' : 'Add field'}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={ev => {
            ev.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" error={err.name}>
            {p => <Input {...p} autoFocus placeholder="e.g. Story points" value={name} onChange={ev => (setName(ev.target.value), setErr({}))} />}
          </Field>
          <Field label="Type" hint={edit ? undefined : `Stored as “${keyFromName(name || 'field')}”.`}>
            {p => (
              <select className="select" id={p.id} value={type} disabled={edit} onChange={ev => setType(ev.target.value as FieldType)}>
                {FIELD_TYPES.map(t => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {(type === 'select' || type === 'multi_select') && (
            <Field label="Options" error={err.options}>
              {() => (
                <div>
                  {choices.map((c, i) => (
                    <div key={i} className="dm-choice">
                      <Input aria-label={`Option ${i + 1}`} value={c.label} onChange={ev => setChoice(i, { label: ev.target.value })} />
                      <select className="select" aria-label={`Color of option ${i + 1}`} value={c.color} onChange={ev => setChoice(i, { color: ev.target.value })}>
                        {CHOICE_COLORS.map(col => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="ibtn" aria-label={`Remove option ${i + 1}`} onClick={() => setChoices(list => list.filter((_, j) => j !== i))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChoices(list => [...list, { value: `option_${list.length + 1}`, label: '', color: CHOICE_COLORS[(list.length + 1) % CHOICE_COLORS.length]!, isNew: true }])}>
                    <Plus size={13} />
                    Add option
                  </Button>
                  {edit && <div className="hint faint" style={{ fontSize: 12, marginTop: 4 }}>Removing an option keeps the value in existing records.</div>}
                </div>
              )}
            </Field>
          )}

          {(type === 'ref' || type === 'refs') && (
            <Field label="Refers to" error={err.options}>
              {p => (
                <select className="select" id={p.id} value={refEntity} disabled={edit} onChange={ev => setRefEntity(ev.target.value)}>
                  <option value="">Choose an entity…</option>
                  {targets.map(t => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {['number', 'money', 'percent'].includes(type) && (
            <div className="row" style={{ gap: 10 }}>
              <Field label="Minimum" className="grow">
                {p => <Input {...p} inputMode="decimal" value={min} onChange={ev => setMin(ev.target.value)} />}
              </Field>
              <Field label="Maximum" className="grow">
                {p => <Input {...p} inputMode="decimal" value={max} onChange={ev => setMax(ev.target.value)} />}
              </Field>
            </div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 8 }}>
              <Checkbox checked={required} onChange={ev => setRequired(ev.target.checked)} />
              Required
            </label>
            <label className="row" style={{ gap: 8 }}>
              <Checkbox checked={unique} onChange={ev => setUnique(ev.target.checked)} />
              Unique values
            </label>
            <label className="row" style={{ gap: 8 }}>
              <Checkbox checked={filterable} onChange={ev => setFilterable(ev.target.checked)} />
              <span>
                Filterable <span className="faint">— builds an index so filtering and sorting stay fast on large lists</span>
              </span>
            </label>
          </div>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Подтверждение с вводом ключа: «скрыть» оставляет данные, «удалить навсегда» стирает их */
function DestroyDialog({ title, what, keyName, dataNote, purgeNote, onlyPurge, onClose, onConfirm }: { title: string; what: string; keyName: string; dataNote: string; purgeNote: string; onlyPurge?: boolean; onClose: () => void; onConfirm: (purge: boolean) => Promise<void> }) {
  const [purge, setPurge] = React.useState(!!onlyPurge);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const ok = typed.trim() === keyName;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={title}
        description={what}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={!ok || busy}
              onClick={async () => {
                setBusy(true);
                await onConfirm(purge);
                setBusy(false);
              }}
            >
              {purge ? 'Delete permanently' : 'Remove'}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 10 }}>
          {!onlyPurge && (
            <>
              <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <Radio name="mode" checked={!purge} onChange={() => setPurge(false)} />
                <span>
                  <b>Remove and keep data.</b> {dataNote}
                </span>
              </label>
              <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <Radio name="mode" checked={purge} onChange={() => setPurge(true)} />
                <span>
                  <b>Delete permanently.</b> {purgeNote}
                </span>
              </label>
            </>
          )}
          {onlyPurge && <Alert tone="warn">{purgeNote}</Alert>}
          <Field label={`Type “${keyName}” to confirm`}>{p => <Input {...p} autoFocus value={typed} onChange={ev => setTyped(ev.target.value)} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFieldDialog({ entity: e, field: f, onClose }: { entity: MetaEntity; field: MetaField; onClose: () => void }) {
  const api = useMetaApi();
  return (
    <DestroyDialog
      title={`Delete field “${f.name}”?`}
      what={`Field of ${e.name}.`}
      keyName={f.key}
      onlyPurge={!!f.archivedAt}
      dataNote="The field disappears from forms and tables; values stay in the records and come back if you restore the field."
      purgeNote="The field and all values stored in it are erased from every record. This cannot be undone."
      onClose={onClose}
      onConfirm={async purge => {
        const r = await api('DELETE', `/entities/${e.key}/fields/${f.id}?confirm=${encodeURIComponent(f.key)}${purge ? '&purge=true' : ''}`);
        if (r) {
          toast(purge ? `Deleted “${f.name}”` : `Removed “${f.name}” — data kept`);
          onClose();
        }
      }}
    />
  );
}

function DeleteEntityDialog({ entity: e, onClose, onDeleted, onlyPurge }: { entity: MetaEntity; onClose: () => void; onDeleted: () => void; onlyPurge?: boolean }) {
  const api = useMetaApi();
  return (
    <DestroyDialog
      title={`Delete entity “${e.name}”?`}
      what="Its section disappears from the sidebar."
      keyName={e.key}
      onlyPurge={onlyPurge}
      dataNote="All records stay in the database and come back if you restore the entity."
      purgeNote="The entity, its fields and all its records are erased. This cannot be undone."
      onClose={onClose}
      onConfirm={async purge => {
        const r = await api('DELETE', `/entities/${e.key}?confirm=${encodeURIComponent(e.key)}${purge ? '&purge=true' : ''}`);
        if (r) {
          toast(purge ? `Deleted “${e.name}”` : `Removed “${e.name}” — records kept`);
          onDeleted();
          onClose();
        }
      }}
    />
  );
}
