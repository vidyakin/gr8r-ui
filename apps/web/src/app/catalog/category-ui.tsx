/* Дерево категорий и диалоги: категория (создание, переименование, перенос), редактор характеристик с унаследованными. */
import * as React from 'react';
import { ChevronRight, Ellipsis, FolderPlus, FolderTree, Lock, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { ATTRIBUTE_TYPES, CHOICE_COLORS, FIELD_TYPE_LABELS, attributeCreate, keyFromName, type FieldType } from '@gr8r/shared';
import { Badge, Button, Checkbox, Dialog, DialogClose, DialogContent, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ChoiceLabel, FIELD_ICONS } from '../meta/field-ui';
import { flattenTree, useAttributes, useCatalogApi, type Attribute, type Category, type CategoryNode } from './data';

/* ---------------- дерево ---------------- */

interface TreeProps {
  nodes: CategoryNode[];
  total: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  canEdit: boolean;
  onCreate: (parent: CategoryNode | null) => void;
  onEdit: (c: CategoryNode) => void;
  onAttributes: (c: CategoryNode) => void;
  onDelete: (c: CategoryNode) => void;
}

export function CategoryTree({ nodes, total, selected, onSelect, canEdit, onCreate, onEdit, onAttributes, onDelete }: TreeProps) {
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setClosed(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const row = (n: CategoryNode): React.ReactNode => {
    const open = !closed.has(n.id);
    return (
      <li key={n.id} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={selected === n.id}>
        <div className={cn('ctree-row', selected === n.id && 'on')} style={{ paddingLeft: 6 + n.depth * 16 }}>
          <button type="button" className={cn('ctree-chev', !n.children.length && 'none')} aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`} tabIndex={n.children.length ? 0 : -1} onClick={() => toggle(n.id)}>
            <ChevronRight size={13} className={cn('chev', open && 'open')} />
          </button>
          <button type="button" className="ctree-name" onClick={() => onSelect(n.id)}>
            <span className="trunc">{n.name}</span>
            <span className="ct num">{n.total}</span>
          </button>
          {canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <button type="button" className="ibtn ibtn-xs ctree-more" aria-label={`Options for ${n.name}`}>
                  <Ellipsis size={14} />
                </button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<FolderPlus size={15} />} onSelect={() => onCreate(n)}>
                  Add sub-category
                </MenuItem>
                <MenuItem icon={<Settings2 size={15} />} onSelect={() => onAttributes(n)}>
                  Characteristics
                </MenuItem>
                <MenuItem icon={<Pencil size={15} />} onSelect={() => onEdit(n)}>
                  Rename or move
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => onDelete(n)}>
                  Delete category
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
        {n.children.length > 0 && open && <ul role="group">{n.children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <nav className="ctree" aria-label="Categories">
      <ul role="tree" aria-label="Product categories">
        <li role="treeitem" aria-selected={selected === null}>
          <div className={cn('ctree-row', selected === null && 'on')}>
            <span className="ctree-chev none" />
            <button type="button" className="ctree-name" onClick={() => onSelect(null)}>
              <FolderTree size={14} className="faint" />
              <span className="trunc">All products</span>
              <span className="ct num">{total}</span>
            </button>
          </div>
        </li>
        {nodes.map(row)}
      </ul>
      {canEdit && (
        <button type="button" className="ctree-add" onClick={() => onCreate(null)}>
          <Plus size={14} />
          New category
        </button>
      )}
    </nav>
  );
}

/* ---------------- категория ---------------- */

export function CategoryDialog({ tree, edit, parent, onClose, onSaved }: { tree: CategoryNode[]; edit?: CategoryNode; parent?: CategoryNode | null; onClose: () => void; onSaved?: (c: Category) => void }) {
  const api = useCatalogApi();
  const [name, setName] = React.useState(edit?.name ?? '');
  const [parentId, setParentId] = React.useState<string>(edit ? (edit.parentId ?? '') : (parent?.id ?? ''));
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // Переносить можно в любую категорию, кроме себя и своих потомков
  const options = flattenTree(tree).filter(n => !edit || (n.id !== edit.id && !n.path.startsWith(`${edit.path}/`)));

  const submit = async () => {
    if (!name.trim()) return setError('Enter a name');
    setBusy(true);
    const body = { name: name.trim(), parentId: parentId || null };
    const r = edit ? await api<Category>('PATCH', `/product-categories/${edit.id}`, body) : await api<Category>('POST', '/product-categories', body);
    setBusy(false);
    if (!r) return;
    toast(edit ? `Saved “${r.name}”` : `Added category “${r.name}”`);
    onSaved?.(r);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={edit ? 'Edit category' : 'New category'}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? 'Save' : 'Create category'}
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
          <Field label="Name" error={error}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setError(''))} />}
          </Field>
          <Field label="Parent category" hint="Sub-categories inherit the characteristics of their parents.">
            {p => (
              <select className="select" id={p.id} value={parentId} onChange={e => setParentId(e.target.value)}>
                <option value="">None (top level)</option>
                {options.map(n => (
                  <option key={n.id} value={n.id}>
                    {' '.repeat(n.depth)}
                    {n.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCategoryDialog({ category, onClose, onDeleted }: { category: CategoryNode; onClose: () => void; onDeleted: () => void }) {
  const api = useCatalogApi();
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`Delete “${category.name}”?`}
        description={
          category.children.length || category.productCount
            ? 'Only empty categories can be deleted: move or delete the sub-categories and products first.'
            : 'The category and its characteristics will be removed.'
        }
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api('DELETE', `/product-categories/${category.id}`);
                setBusy(false);
                if (!r) return;
                toast(`Deleted “${category.name}”`);
                onDeleted();
                onClose();
              }}
            >
              Delete category
            </Button>
          </>
        }
      >
        <span />
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- характеристики ---------------- */

export function AttributesDialog({ category, onClose }: { category: CategoryNode; onClose: () => void }) {
  const list = useAttributes(category.id);
  const [form, setForm] = React.useState<{ attr?: Attribute } | null>(null);
  const [del, setDel] = React.useState<Attribute | null>(null);
  const attrs = list.data ?? [];
  const inherited = attrs.filter(a => a.inherited);
  const own = attrs.filter(a => !a.inherited);

  const rowOf = (a: Attribute) => {
    const I = FIELD_ICONS[a.type];
    return (
      <div key={a.id} className="attr-row" data-attr={a.key}>
        <I size={14} className="faint" />
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <span className="trunc" style={{ fontWeight: 450 }}>
            {a.name}
          </span>
          {a.unit && <span className="faint">{a.unit}</span>}
        </span>
        <span className="muted">{FIELD_TYPE_LABELS[a.type]}</span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {a.required && <Badge>Required</Badge>}
          {(a.type === 'select' || a.type === 'multi_select') && (a.options.choices ?? []).slice(0, 3).map(c => <ChoiceLabel key={c.value} choice={c} />)}
          {a.inherited && (
            <Badge tone="gray">
              <Lock size={10} /> from {a.categoryName}
            </Badge>
          )}
        </span>
        <span className="row" style={{ gap: 2 }}>
          {!a.inherited && (
            <>
              <button type="button" className="ibtn ibtn-xs" aria-label={`Edit ${a.name}`} onClick={() => setForm({ attr: a })}>
                <Pencil size={13} />
              </button>
              <button type="button" className="ibtn ibtn-xs" aria-label={`Delete ${a.name}`} onClick={() => setDel(a)}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <DialogContent
          size="lg"
          title={`Characteristics of “${category.name}”`}
          description="Products in this category (and its sub-categories) get these fields. Characteristics set on a parent category are inherited and shown here read-only."
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm({})}>
                <Plus size={14} />
                Add characteristic
              </Button>
              <span className="sp" />
              <DialogClose asChild>
                <Button variant="primary">Done</Button>
              </DialogClose>
            </>
          }
        >
          {!!inherited.length && (
            <section aria-label="Inherited characteristics">
              <h3 className="attr-h">Inherited</h3>
              <div className="attr-list">{inherited.map(rowOf)}</div>
            </section>
          )}
          <section aria-label="Own characteristics">
            <h3 className="attr-h">This category</h3>
            <div className="attr-list">
              {own.map(rowOf)}
              {!own.length && <div className="faint" style={{ padding: 14 }}>{list.isPending ? 'Loading…' : 'No characteristics of its own yet.'}</div>}
            </div>
          </section>
        </DialogContent>
      </Dialog>
      {form && <AttributeForm category={category} attr={form.attr} onClose={() => setForm(null)} />}
      {del && <DeleteAttributeDialog attr={del} onClose={() => setDel(null)} />}
    </>
  );
}

interface ChoiceDraft {
  value: string;
  label: string;
  color: string;
  isNew?: boolean;
}

function AttributeForm({ category, attr, onClose }: { category: CategoryNode; attr?: Attribute; onClose: () => void }) {
  const api = useCatalogApi();
  const edit = !!attr;
  const [name, setName] = React.useState(attr?.name ?? '');
  const [type, setType] = React.useState<FieldType>(attr?.type ?? 'text');
  const [unit, setUnit] = React.useState(attr?.unit ?? '');
  const [required, setRequired] = React.useState(attr?.required ?? false);
  const [choices, setChoices] = React.useState<ChoiceDraft[]>(attr?.options.choices?.map(c => ({ ...c })) ?? [{ value: 'option_1', label: 'Option 1', color: 'blue', isNew: true }]);
  const [min, setMin] = React.useState(attr?.options.min != null ? String(attr.options.min) : '');
  const [max, setMax] = React.useState(attr?.options.max != null ? String(attr.options.max) : '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const setChoice = (i: number, patch: Partial<ChoiceDraft>) =>
    setChoices(list =>
      list.map((c, j) => {
        if (i !== j) return c;
        const next = { ...c, ...patch };
        if (c.isNew && patch.label !== undefined) {
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
    if (type === 'number' || type === 'money' || type === 'percent') {
      if (min.trim() !== '') options.min = Number(min);
      if (max.trim() !== '') options.max = Number(max);
    }
    const body = { name: name.trim(), type, required, unit: unit.trim(), options };
    const parsed = attributeCreate.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      return setErr(out);
    }
    setBusy(true);
    const r = edit
      ? await api('PATCH', `/attribute-defs/${attr!.id}`, { name: body.name, required, unit: body.unit, options })
      : await api('POST', `/product-categories/${category.id}/attributes`, body);
    setBusy(false);
    if (!r) return;
    toast(edit ? `Saved “${body.name}”` : `Added “${body.name}”`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={edit ? `Edit “${attr!.name}”` : `New characteristic in ${category.name}`}
        description={edit ? 'The type and key of a characteristic cannot be changed.' : undefined}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? 'Save' : 'Add characteristic'}
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
            {p => <Input {...p} autoFocus placeholder="e.g. Width" value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label="Type" className="grow" hint={edit ? undefined : `Stored as “${keyFromName(name || 'attr', 'attr')}”.`}>
              {p => (
                <select className="select" id={p.id} value={type} disabled={edit} onChange={e => setType(e.target.value as FieldType)}>
                  {ATTRIBUTE_TYPES.map(t => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Unit" className="grow" hint="Shown next to the value, e.g. mm, kg.">
              {p => <Input {...p} value={unit} maxLength={20} onChange={e => setUnit(e.target.value)} />}
            </Field>
          </div>

          {(type === 'select' || type === 'multi_select') && (
            <Field label="Options" error={err.options}>
              {() => (
                <div>
                  {choices.map((c, i) => (
                    <div key={i} className="dm-choice">
                      <Input aria-label={`Option ${i + 1}`} value={c.label} onChange={e => setChoice(i, { label: e.target.value })} />
                      <select className="select" aria-label={`Color of option ${i + 1}`} value={c.color} onChange={e => setChoice(i, { color: e.target.value })}>
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
                </div>
              )}
            </Field>
          )}

          {(type === 'number' || type === 'money' || type === 'percent') && (
            <div className="row" style={{ gap: 10 }}>
              <Field label="Minimum" className="grow">
                {p => <Input {...p} inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} />}
              </Field>
              <Field label="Maximum" className="grow">
                {p => <Input {...p} inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} />}
              </Field>
            </div>
          )}

          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={required} onChange={e => setRequired(e.target.checked)} />
            Required for new products
          </label>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAttributeDialog({ attr, onClose }: { attr: Attribute; onClose: () => void }) {
  const api = useCatalogApi();
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={`Delete “${attr.name}”?`}
        description="The values of this characteristic are erased from all products in the category and its sub-categories. This cannot be undone."
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy || typed !== attr.key}
              onClick={async () => {
                setBusy(true);
                const r = await api<{ cleared: number }>('DELETE', `/attribute-defs/${attr.id}?confirm=${attr.key}`);
                setBusy(false);
                if (!r) return;
                toast(`Deleted “${attr.name}”${r.cleared ? ` and cleared ${r.cleared} value${r.cleared === 1 ? '' : 's'}` : ''}`);
                onClose();
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <Field label={`Type “${attr.key}” to confirm`}>{p => <Input {...p} autoFocus value={typed} onChange={e => setTyped(e.target.value)} />}</Field>
      </DialogContent>
    </Dialog>
  );
}
