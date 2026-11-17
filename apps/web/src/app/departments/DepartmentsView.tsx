/* Settings → Departments (оргструктура, docs/architecture/departments.md): дерево с отступами, руководитель и число сотрудников в строке,
   диалог создания и правки (название, родитель, руководитель) и состав. Данные и вызовы API приходят пропсами — экран рендерится в тесте
   без сессии и стора; обёртка с хуками — settings/departments.tsx. Правят admin и owner. */
import * as React from 'react';
import { Network, Plus, X } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { SRow } from '../settings/parts';
import { departmentTree, selfAndDescendants, type DepartmentItem } from './tree';

/** Пустое значение списка выбора (у Radix Select значение не может быть пустой строкой) */
const NONE = '__none';

export interface DepartmentBody {
  name: string;
  parentId: string | null;
  headMemberId: string | null;
}

export interface DepartmentsViewProps {
  title: string;
  departments: readonly DepartmentItem[];
  /** Активные участники воркспейса */
  members: readonly { id: string; name: string }[];
  isAdmin: boolean;
  pending?: boolean;
  /** id null — создать; true при успехе */
  onSave: (id: string | null, body: DepartmentBody) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onSetMember: (memberId: string, departmentId: string | null) => Promise<boolean>;
}

interface Draft {
  id: string | null;
  name: string;
  parentId: string;
  headMemberId: string;
}

export function DepartmentsView({ title, departments, members, isAdmin, pending, onSave, onDelete, onSetMember }: DepartmentsViewProps) {
  const t = useT();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [del, setDel] = React.useState<DepartmentItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tree = React.useMemo(() => departmentTree(departments), [departments]);
  const nameOf = React.useMemo(() => new Map(members.map(m => [m.id, m.name])), [members]);
  const deptOf = React.useMemo(() => new Map(departments.flatMap(d => d.memberIds.map(id => [id, d] as const))), [departments]);
  const editing = draft?.id ? (departments.find(d => d.id === draft.id) ?? null) : null;

  const open = (d: DepartmentItem | null) => setDraft(d ? { id: d.id, name: d.name, parentId: d.parentId ?? NONE, headMemberId: d.headMemberId ?? NONE } : { id: null, name: '', parentId: NONE, headMemberId: NONE });
  const run = async (fn: () => Promise<boolean>, done: string) => {
    setBusy(true);
    try {
      const ok = await fn();
      if (ok) toast(done);
      return ok;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) return;
    const body: DepartmentBody = { name: draft.name.trim(), parentId: draft.parentId === NONE ? null : draft.parentId, headMemberId: draft.headMemberId === NONE ? null : draft.headMemberId };
    if (await run(() => onSave(draft.id, body), t('departments.settings.saved'))) setDraft(null);
  };

  // родителем нельзя выбрать само подразделение и его потомков
  const blocked = draft?.id ? selfAndDescendants(departments, draft.id) : new Set<string>();
  const parentOptions = [{ value: NONE, label: t('departments.settings.noParent') }, ...tree.filter(n => !blocked.has(n.d.id)).map(n => ({ value: n.d.id, label: `${'\u00a0\u00a0'.repeat(n.depth)}${n.d.name}` }))];
  const headOptions = [{ value: NONE, label: t('departments.settings.noHead') }, ...members.map(m => ({ value: m.id, label: m.name }))];
  const addOptions = editing
    ? members
        .filter(m => !editing.memberIds.includes(m.id))
        .map(m => {
          const cur = deptOf.get(m.id);
          return { value: m.id, label: cur ? t('departments.settings.inOther', { name: m.name, department: cur.name }) : m.name };
        })
    : [];

  return (
    <>
      {!isAdmin && <Alert tone="info" className="mb-3">{t('departments.settings.onlyAdmins')}</Alert>}
      <div className="sblock">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => open(null)}>
              <Plus size={13} />
              {t('departments.settings.add')}
            </Button>
          )}
        </div>
        {pending ? (
          <Skeleton w="100%" h={60} />
        ) : !tree.length ? (
          <EmptyState icon={<Network size={20} />} title={t('departments.settings.empty')}>{t('departments.settings.emptyHint')}</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {tree.map(({ d, depth }) => (
              <div key={d.id} data-depth={depth} style={{ paddingLeft: depth * 24 }}>
                <SRow
                  t={<>{d.name} <Badge>{t('departments.settings.members', { count: d.memberIds.length })}</Badge></>}
                  d={d.headMemberId ? t('departments.settings.headOf', { name: nameOf.get(d.headMemberId) ?? t('departments.settings.unknown') }) : t('departments.settings.noHead')}
                >
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => open(d)}>{t('departments.settings.edit')}</Button>
                  )}
                </SRow>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog open={!!draft} onOpenChange={o => !o && setDraft(null)}>
        {draft && (
          <DialogContent
            title={draft.id ? t('departments.settings.editTitle') : t('departments.settings.newTitle')}
            footer={
              <>
                {editing && (
                  <Button variant="ghost" disabled={busy} onClick={() => { setDel(editing); setDraft(null); }}>
                    {t('departments.settings.delete')}
                  </Button>
                )}
                <span className="sp" />
                <Button variant="ghost" onClick={() => setDraft(null)}>{t('departments.settings.cancel')}</Button>
                <Button disabled={!draft.name.trim() || busy} onClick={save}>{t('departments.settings.save')}</Button>
              </>
            }
          >
            <div className="stack" style={{ gap: 12 }}>
              <Field label={t('departments.settings.name')}>{p => <Input {...p} maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
              <Field label={t('departments.settings.parent')}>{p => <Select {...p} options={parentOptions} value={draft.parentId} onValueChange={v => setDraft({ ...draft, parentId: v })} />}</Field>
              <Field label={t('departments.settings.head')}>{p => <Select {...p} options={headOptions} value={draft.headMemberId} onValueChange={v => setDraft({ ...draft, headMemberId: v })} />}</Field>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>{t('departments.settings.composition')}</div>
                {!editing ? (
                  <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('departments.settings.compositionNew')}</p>
                ) : (
                  <div className="stack" style={{ gap: 6 }}>
                    {editing.memberIds.length ? (
                      editing.memberIds.map(id => {
                        const name = nameOf.get(id) ?? t('departments.settings.unknown');
                        return (
                          <div key={id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                            <span>{name}</span>
                            <Button size="sm" variant="ghost" disabled={busy} aria-label={t('departments.settings.remove', { name })} onClick={() => run(() => onSetMember(id, null), t('departments.settings.memberRemoved'))}>
                              <X size={13} />
                            </Button>
                          </div>
                        );
                      })
                    ) : (
                      <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('departments.settings.compositionEmpty')}</p>
                    )}
                    {!!addOptions.length && (
                      <Select
                        aria-label={t('departments.settings.addMember')}
                        placeholder={t('departments.settings.addMember')}
                        options={addOptions}
                        value=""
                        disabled={busy}
                        onValueChange={v => v && run(() => onSetMember(v, editing.id), t('departments.settings.memberAdded'))}
                      />
                    )}
                    <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('departments.settings.compositionHint')}</p>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!del}
        onOpenChange={o => !o && setDel(null)}
        title={t('departments.settings.delete')}
        description={del ? t('departments.settings.confirmDelete', { name: del.name }) : ''}
        confirmLabel={t('departments.settings.delete')}
        cancelLabel={t('departments.settings.cancel')}
        danger
        onConfirm={async () => {
          if (del) await run(() => onDelete(del.id), t('departments.settings.deleted'));
          setDel(null);
        }}
      />
    </>
  );
}
