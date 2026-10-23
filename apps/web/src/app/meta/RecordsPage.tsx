/* Экран пользовательской сущности, собранный из метаданных на готовых компонентах Gr8r: FilterBar, DataTable, Kanban
   (если есть поле select — колонки по нему), EntityDrawer (карточка записи) и форма создания. Ничего не знает о конкретной сущности. */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { CircleAlert, CircleDot, Plus, SquareKanban, Table2, Trash2, User } from 'lucide-react';
import { plainValue, validateRecord, type FieldType } from '@gr8r/shared';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, MenuItem, Segmented, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { EntityDrawer } from '@/components/gr8r/entity-drawer';
import { FilterBar, useFilterState, type FilterField } from '@/components/gr8r/filter-bar';
import { Kanban, type KanbanColumn } from '@/components/gr8r/kanban';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { MemberAvatar } from '../components/workspace';
import { fmtDate } from '../lib/dates';
import { NotFoundPage } from '../pages/PlaceholderPage';
import { useCanWrite } from './custom-fields';
import { activeFields, useAllEntities, useRecord, useRecordMutations, useRecords, type DataRecord, type MetaEntity, type MetaField } from './data';
import { ChoiceLabel, FIELD_ICONS, FieldInput, FieldValue, choiceOf } from './field-ui';
import { entityIcon } from './icons';

type Mode = 'table' | 'board';
const NONE = '__none';

export function RecordsPage() {
  const { key, recordId } = useParams();
  const all = useAllEntities();
  const entity = all.data?.find(e => e.key === key && e.kind === 'custom' && !e.archivedAt);
  if (all.isPending)
    return (
      <div className="page flush">
        <div className="ph">
          <Skeleton w={180} h={24} />
        </div>
      </div>
    );
  if (!entity) return <NotFoundPage />;
  return <EntityScreen key={entity.id} entity={entity} recordId={recordId} />;
}

/** Строка таблицы/карточка: заголовок записи */
const titleOf = (e: MetaEntity, r: DataRecord) => String(r.data[e.titleField] ?? '') || '';

function EntityScreen({ entity, recordId }: { entity: MetaEntity; recordId?: string }) {
  const navigate = useNavigate();
  const t = useT();
  const { data: ws } = useWorkspace();
  const canWrite = useCanWrite();
  const fields = activeFields(entity);
  const selects = fields.filter(f => f.type === 'select');
  const [mode, setMode] = React.useState<Mode>('table');
  const [boardKey, setBoardKey] = React.useState(selects[0]?.key ?? '');
  const [group, setGroup] = React.useState('none');
  const [creating, setCreating] = React.useState<Record<string, unknown> | null>(null);
  const filters = useFilterState();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Фильтры панели → параметры filter=ключ:in:значения (сервер фильтрует по jsonb)
  const serverFilters = React.useMemo(() => {
    const out: string[] = [];
    for (const f of fields) {
      const sel = filters.values[f.key] ?? [];
      if (!sel.length) continue;
      if (f.type === 'boolean') {
        if (sel.length === 1) out.push(`${f.key}:eq:${sel[0]}`);
      } else out.push(`${f.key}:in:${sel.join(',')}`);
    }
    return out;
  }, [fields, filters.values]);

  const list = useRecords(entity.key, { q: q || undefined, filters: serverFilters });
  const rows = list.data ?? [];
  const m = useRecordMutations(entity.key);

  const columns = React.useMemo<Column<DataRecord>[]>(() => {
    const title = fields.find(f => f.key === entity.titleField);
    const rest = fields.filter(f => f.key !== entity.titleField);
    const col = (f: MetaField, first = false): Column<DataRecord> => ({
      id: f.key,
      header: f.name,
      width: first ? 280 : f.type === 'long_text' ? 240 : f.type === 'multi_select' || f.type === 'refs' ? 200 : 150,
      align: ['number', 'money', 'percent'].includes(f.type) ? 'right' : undefined,
      value: r => {
        const v = r.data[f.key];
        if (v == null || v === '') return null;
        return ['number', 'money', 'percent'].includes(f.type) ? Number(v) : plainValue(f, v);
      },
      cell: r =>
        first ? (
          <span className="trunc" style={{ fontWeight: 450 }}>
            {titleOf(entity, r)}
          </span>
        ) : (
          <FieldValue field={f} value={r.data[f.key]} />
        ),
    });
    return [
      ...(title ? [col(title, true)] : []),
      ...rest.map(f => col(f)),
      { id: '__created', header: t('meta.records.colCreated'), width: 112, defaultHidden: true, value: r => Date.parse(r.createdAt), cell: r => <span className="muted num">{fmtDate(new Date(r.createdAt))}</span> },
    ];
  }, [fields, entity, t]);
  const table = useDataTable(columns);

  const filterFields: FilterField[] = fields
    .filter(f => ['select', 'boolean', 'user'].includes(f.type))
    .map(f => ({
      id: f.key,
      name: f.name,
      icon: React.createElement(FIELD_ICONS[f.type], { size: 15 }),
      options:
        f.type === 'select'
          ? (f.options.choices ?? []).map(c => ({ id: c.value, name: c.label }))
          : f.type === 'boolean'
            ? [{ id: 'true', name: t('meta.records.yesValue') }, { id: 'false', name: t('meta.records.noValue') }]
            : ws.members.filter(x => x.status === 'active').map(x => ({ id: x.id, name: x.name, icon: <MemberAvatar id={x.id} size="sm" tooltip={false} /> })),
    }));

  const groupField = selects.find(f => f.key === group);
  const groupBy = groupField
    ? {
        key: (r: DataRecord) => String(r.data[groupField.key] ?? NONE),
        order: [...(groupField.options.choices ?? []).map(c => c.value), NONE],
        label: (k: string) => (choiceOf(groupField, k) ? <ChoiceLabel choice={choiceOf(groupField, k)!} /> : <span className="muted">{t('meta.records.noField', { field: groupField.name.toLowerCase() })}</span>),
      }
    : undefined;

  const boardField = selects.find(f => f.key === boardKey) ?? selects[0];
  const boardCols: KanbanColumn[] = boardField
    ? [...(boardField.options.choices ?? []).map(c => ({ id: c.value, title: c.label, name: c.label, icon: <span className="pdot" style={{ '--c': `var(--${c.color === 'gray' ? 'text-3' : c.color === 'indigo' ? 'accent' : c.color})` } as React.CSSProperties} /> })), { id: NONE, title: t('meta.records.noField', { field: boardField.name.toLowerCase() }), name: t('meta.records.noField', { field: boardField.name }) }]
    : [];

  const open = (r: DataRecord) => navigate(`/data/${entity.key}/${r.id}`);
  const Icon = entityIcon(entity.icon);
  const newBtn = canWrite && (
    <Button variant="primary" onClick={() => setCreating({})}>
      <Plus size={14} />
      {t('meta.records.newRecord')}
    </Button>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{entity.name}</h1>
          <p>
            {t('meta.records.total', { count: rows.length })}
            {filters.count || q ? ` · ${t('meta.records.match')}` : ''}
          </p>
        </div>
        <div className="acts">{newBtn}</div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('meta.records.searchPlaceholder', { name: entity.name.toLowerCase() }) }}
        fields={filterFields}
        filters={filters}
        sort={mode === 'table' ? { options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort } : undefined}
        group={mode === 'table' && selects.length ? { options: [{ id: 'none', name: t('meta.records.none') }, ...selects.map(f => ({ id: f.key, name: f.name, icon: <CircleDot size={15} /> }))], value: group, onChange: setGroup } : undefined}
        columns={mode === 'table' ? columnsMenu(columns, table) : undefined}
        left={
          selects.length ? (
            <Segmented
              aria-label={t('meta.records.viewModeAria')}
              value={mode}
              onValueChange={setMode}
              items={[
                { value: 'table', label: <span className="hide-m">{t('meta.records.table')}</span>, icon: <Table2 size={13} />, 'aria-label': t('meta.records.table') },
                { value: 'board', label: <span className="hide-m">{t('meta.records.board')}</span>, icon: <SquareKanban size={13} />, 'aria-label': t('meta.records.board') },
              ]}
            />
          ) : undefined
        }
        extra={
          mode === 'board' && selects.length > 1 ? (
            <select className="select" style={{ width: 'auto' }} aria-label={t('meta.records.boardColumnsByAria')} value={boardField?.key} onChange={e => setBoardKey(e.target.value)}>
              {selects.map(f => (
                <option key={f.key} value={f.key}>
                  {t('meta.records.boardColumnsBy', { name: f.name })}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      {list.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={t('meta.records.loadFailed')} action={<Button size="sm" onClick={() => list.refetch()}>{t('common.retry')}</Button>}>
          {(list.error as Error).message}
        </EmptyState>
      ) : list.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length && !filters.count && !q ? (
        <EmptyState icon={<Icon size={20} />} title={t('meta.records.empty', { name: entity.name.toLowerCase() })} action={newBtn || undefined}>
          {selects.length ? t('meta.records.emptyHintBoard') : t('meta.records.emptyHintTable')}
        </EmptyState>
      ) : mode === 'board' && boardField ? (
        <Kanban
          aria-label={t('meta.records.boardAria', { name: entity.name })}
          columns={boardCols}
          items={rows}
          getId={r => r.id}
          getColumn={r => String(r.data[boardField.key] ?? NONE)}
          renderCard={r => <RecordCard entity={entity} record={r} onOpen={() => open(r)} />}
          onMove={canWrite ? (r, col) => (String(r.data[boardField.key] ?? NONE) !== col ? m.update.mutate({ id: r.id, data: { [boardField.key]: col === NONE ? null : col } }) : undefined) : undefined}
          onAdd={canWrite ? col => setCreating(col === NONE ? {} : { [boardField.key]: col }) : undefined}
          addLabel={t('meta.records.addRecord')}
        />
      ) : (
        <DataTable
          aria-label={t('meta.records.tableAria', { name: entity.name })}
          columns={columns}
          rows={rows}
          table={table}
          getId={r => r.id}
          onRowClick={open}
          groupBy={groupBy}
          onNew={canWrite ? () => setCreating({}) : undefined}
          newLabel={t('meta.records.newRecord')}
          empty={
            <EmptyState icon={<Icon size={20} />} title={t('meta.records.noResults')} action={<Button size="sm" onClick={() => (filters.reset(), setQ(''))}>{t('meta.records.clearFilters')}</Button>}>
              {t('meta.records.noResultsHint')}
            </EmptyState>
          }
        />
      )}
      {creating && (
        <RecordFormDialog
          entity={entity}
          initial={creating}
          onClose={() => setCreating(null)}
          onSubmit={async data => {
            const row = await m.create.mutateAsync(data);
            toast(t('meta.records.toastAdded', { name: titleOf(entity, row) }));
            setCreating(null);
            open(row);
          }}
        />
      )}
      {recordId && <RecordDrawer entity={entity} id={recordId} rows={rows} onClose={() => navigate(`/data/${entity.key}`)} />}
    </div>
  );
}

/** Карточка записи на доске: заголовок и первые заполненные поля */
function RecordCard({ entity, record: r, onOpen }: { entity: MetaEntity; record: DataRecord; onOpen: () => void }) {
  const extra = activeFields(entity)
    .filter(f => f.key !== entity.titleField && f.type !== 'select' && f.type !== 'long_text' && r.data[f.key] != null && r.data[f.key] !== '')
    .slice(0, 3);
  return (
    <div className="panel ent-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => e.key === 'Enter' && onOpen()}>
      <div className="t trunc">{titleOf(entity, r)}</div>
      {!!extra.length && (
        <div className="kvs">
          {extra.map(f => (
            <React.Fragment key={f.key}>
              <span className="k">{f.name}</span>
              <span className="trunc">
                <FieldValue field={f} value={r.data[f.key]} />
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- форма создания ---------------- */

function FormRow({ field: f, error, children }: { field: MetaField; error?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {f.name}
        {f.required && <span className="faint"> *</span>}
      </label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children}
      {error && (
        <span className="err">
          <CircleAlert size={12} />
          {error}
        </span>
      )}
    </div>
  );
}

function RecordFormDialog({ entity, initial, onClose, onSubmit }: { entity: MetaEntity; initial: Record<string, unknown>; onClose: () => void; onSubmit: (data: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const fields = activeFields(entity);
  const [values, setValues] = React.useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    // та же zod-схема, что проверит сервер
    const r = validateRecord(fields, values, 'create');
    if (!r.ok) return setErrors(r.errors);
    setBusy(true);
    try {
      await onSubmit(r.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('meta.records.newRecordOf', { name: entity.name })}
        className="[&>.modal-b]:!gap-3"
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {t('meta.records.createRecord')}
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
          {fields.map(f => (
            <FormRow key={f.key} field={f} error={errors[f.key]}>
              <FieldInput
                live
                field={f}
                value={values[f.key]}
                invalid={!!errors[f.key]}
                onChange={v => {
                  setValues(s => ({ ...s, [f.key]: v }));
                  setErrors(s => ({ ...s, [f.key]: '' }));
                }}
              />
            </FormRow>
          ))}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- карточка записи ---------------- */

function RecordDrawer({ entity, id, rows, onClose }: { entity: MetaEntity; id: string; rows: DataRecord[]; onClose: () => void }) {
  const t = useT();
  const canWrite = useCanWrite();
  const m = useRecordMutations(entity.key);
  const inList = rows.find(r => r.id === id);
  const single = useRecord(entity.key, inList ? undefined : id);
  const record = inList ?? single.data;
  const [confirm, setConfirm] = React.useState(false);
  const Icon = entityIcon(entity.icon);
  if (!record) return single.isError ? <NotFoundDrawer onClose={onClose} /> : null;

  const save = (f: MetaField, v: unknown) => {
    const check = validateRecord([f], { [f.key]: v }, 'patch');
    if (!check.ok) return void toast.error(check.errors[f.key] ?? t('meta.records.invalidValue'));
    m.update.mutate({ id, data: { [f.key]: v ?? null } });
  };
  const rest = activeFields(entity).filter(f => f.key !== entity.titleField);
  const title = titleOf(entity, record);
  const titleField = activeFields(entity).find(f => f.key === entity.titleField);

  return (
    <>
      <EntityDrawer
        label={t('meta.records.drawerLabel', { entity: entity.name, title })}
        onClose={onClose}
        crumb={
          <>
            <span className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <Icon size={14} />
              {entity.name}
            </span>
          </>
        }
        title={title}
        onTitleChange={canWrite && titleField ? v => save(titleField, v) : undefined}
        subtitle={<span className="faint">{t('meta.records.created', { date: fmtDate(new Date(record.createdAt)) })}</span>}
        menu={
          canWrite ? (
            <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => setConfirm(true)}>
              {t('meta.records.deleteRecord')}
            </MenuItem>
          ) : undefined
        }
        fields={rest.map(f => ({
          icon: FIELD_ICONS[f.type as FieldType] ?? User,
          label: f.name,
          value: canWrite ? <FieldInput field={f} value={record.data[f.key]} onChange={v => save(f, v)} /> : <FieldValue field={f} value={record.data[f.key]} />,
        }))}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title={t('meta.records.deleteRecordTitle')}
        description={
          <>
            <b>{title}</b> {t('meta.records.deleteRecordDesc', { entity: entity.name })}
          </>
        }
        confirmLabel={t('meta.records.deleteRecord')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          m.remove.mutate(id);
          toast(t('meta.records.toastDeleted', { name: title }));
          onClose();
        }}
      />
    </>
  );
}

function NotFoundDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <EntityDrawer label={t('meta.records.notFound')} title={t('meta.records.notFound')} onClose={onClose}>
      <p className="muted">{t('meta.records.notFoundHint')}</p>
    </EntityDrawer>
  );
}
