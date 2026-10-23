/* Дерево категорий и диалоги: категория (создание, переименование, перенос), редактор характеристик с унаследованными. */
import * as React from 'react';
import { ChevronRight, Ellipsis, FolderPlus, FolderTree, Lock, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { ATTRIBUTE_TYPES, CHOICE_COLORS, FIELD_TYPE_LABELS, attributeCreate, keyFromName, type FieldType } from '@gr8r/shared';
import { Badge, Button, Checkbox, Dialog, DialogClose, DialogContent, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ChoiceLabel, FIELD_ICONS } from '../meta/field-ui';
import { flattenTree, useAttributes, useCatalogApi, type Attribute, type Category, type CategoryNode } from './data';
import { t, tEnum, useT } from '@/i18n';

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
  const t = useT();
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
          <button type="button" className={cn('ctree-chev', !n.children.length && 'none')} aria-label={t(open ? 'catalog.tree.collapse' : 'catalog.tree.expand', { name: n.name })} tabIndex={n.children.length ? 0 : -1} onClick={() => toggle(n.id)}>
            <ChevronRight size={13} className={cn('chev', open && 'open')} />
          </button>
          <button type="button" className="ctree-name" onClick={() => onSelect(n.id)}>
            <span className="trunc">{n.name}</span>
            <span className="ct num">{n.total}</span>
          </button>
          {canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <button type="button" className="ibtn ibtn-xs ctree-more" aria-label={t('catalog.tree.options', { name: n.name })}>
                  <Ellipsis size={14} />
                </button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<FolderPlus size={15} />} onSelect={() => onCreate(n)}>
                  {t('catalog.tree.addSub')}
                </MenuItem>
                <MenuItem icon={<Settings2 size={15} />} onSelect={() => onAttributes(n)}>
                  {t('catalog.tree.characteristics')}
                </MenuItem>
                <MenuItem icon={<Pencil size={15} />} onSelect={() => onEdit(n)}>
                  {t('catalog.tree.renameMove')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={15} />} danger onSelect={() => onDelete(n)}>
                  {t('catalog.tree.deleteCategory')}
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
    <nav className="ctree" aria-label={t('catalog.tree.categories')}>
      <ul role="tree" aria-label={t('catalog.tree.productCategories')}>
        <li role="treeitem" aria-selected={selected === null}>
          <div className={cn('ctree-row', selected === null && 'on')}>
            <span className="ctree-chev none" />
            <button type="button" className="ctree-name" onClick={() => onSelect(null)}>
              <FolderTree size={14} className="faint" />
              <span className="trunc">{t('catalog.tree.allProducts')}</span>
              <span className="ct num">{total}</span>
            </button>
          </div>
        </li>
        {nodes.map(row)}
      </ul>
      {canEdit && (
        <button type="button" className="ctree-add" onClick={() => onCreate(null)}>
          <Plus size={14} />
          {t('catalog.tree.newCategory')}
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
    if (!name.trim()) return setError(t('common.enterName'));
    setBusy(true);
    const body = { name: name.trim(), parentId: parentId || null };
    const r = edit ? await api<Category>('PATCH', `/product-categories/${edit.id}`, body) : await api<Category>('POST', '/product-categories', body);
    setBusy(false);
    if (!r) return;
    toast(t(edit ? 'catalog.category.saved' : 'catalog.category.added', { name: r.name }));
    onSaved?.(r);
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={edit ? t('catalog.category.edit') : t('catalog.category.new')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? t('common.save') : t('catalog.category.create')}
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
          <Field label={t('common.name')} error={error}>
            {p => <Input {...p} autoFocus value={name} onChange={e => (setName(e.target.value), setError(''))} />}
          </Field>
          <Field label={t('catalog.category.parent')} hint={t('catalog.category.parentHint')}>
            {p => (
              <select className="select" id={p.id} value={parentId} onChange={e => setParentId(e.target.value)}>
                <option value="">{t('catalog.category.topLevel')}</option>
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
        title={t('catalog.category.deleteTitle', { name: category.name })}
        description={
          category.children.length || category.productCount
            ? t('catalog.category.deleteNotEmpty')
            : t('catalog.category.deleteEmpty')
        }
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api('DELETE', `/product-categories/${category.id}`);
                setBusy(false);
                if (!r) return;
                toast(t('catalog.category.deleted', { name: category.name }));
                onDeleted();
                onClose();
              }}
            >
              {t('catalog.tree.deleteCategory')}
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
  const t = useT();

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
        <span className="muted">{tEnum('fieldType', a.type, FIELD_TYPE_LABELS[a.type])}</span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {a.required && <Badge>{t('common.required')}</Badge>}
          {(a.type === 'select' || a.type === 'multi_select') && (a.options.choices ?? []).slice(0, 3).map(c => <ChoiceLabel key={c.value} choice={c} />)}
          {a.inherited && (
            <Badge tone="gray">
              <Lock size={10} /> {t('catalog.attrs.from', { name: a.categoryName })}
            </Badge>
          )}
        </span>
        <span className="row" style={{ gap: 2 }}>
          {!a.inherited && (
            <>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('catalog.attrs.editAria', { name: a.name })} onClick={() => setForm({ attr: a })}>
                <Pencil size={13} />
              </button>
              <button type="button" className="ibtn ibtn-xs" aria-label={t('catalog.attrs.deleteAria', { name: a.name })} onClick={() => setDel(a)}>
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
          title={t('catalog.characteristicsOf', { name: category.name })}
          description={t('catalog.attrs.description')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm({})}>
                <Plus size={14} />
                {t('catalog.attrs.add')}
              </Button>
              <span className="sp" />
              <DialogClose asChild>
                <Button variant="primary">{t('common.done')}</Button>
              </DialogClose>
            </>
          }
        >
          {!!inherited.length && (
            <section aria-label={t('catalog.attrs.inheritedAria')}>
              <h3 className="attr-h">{t('catalog.attrs.inherited')}</h3>
              <div className="attr-list">{inherited.map(rowOf)}</div>
            </section>
          )}
          <section aria-label={t('catalog.attrs.ownAria')}>
            <h3 className="attr-h">{t('catalog.attrs.own')}</h3>
            <div className="attr-list">
              {own.map(rowOf)}
              {!own.length && <div className="faint" style={{ padding: 14 }}>{list.isPending ? t('common.loading') : t('catalog.attrs.noneOwn')}</div>}
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
  const t = useT();
  const edit = !!attr;
  const [name, setName] = React.useState(attr?.name ?? '');
  const [type, setType] = React.useState<FieldType>(attr?.type ?? 'text');
  const [unit, setUnit] = React.useState(attr?.unit ?? '');
  const [required, setRequired] = React.useState(attr?.required ?? false);
  const [choices, setChoices] = React.useState<ChoiceDraft[]>(attr?.options.choices?.map(c => ({ ...c })) ?? [{ value: 'option_1', label: t('catalog.attrs.option', { n: 1 }), color: 'blue', isNew: true }]);
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
    toast(t(edit ? 'catalog.attrs.saved' : 'catalog.attrs.added', { name: body.name }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={edit ? t('catalog.attrs.editTitle', { name: attr!.name }) : t('catalog.attrs.newTitle', { name: category.name })}
        description={edit ? t('catalog.attrs.immutable') : undefined}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {edit ? t('common.save') : t('catalog.attrs.add')}
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
          <Field label={t('common.name')} error={err.name}>
            {p => <Input {...p} autoFocus placeholder={t('catalog.attrs.namePlaceholder')} value={name} onChange={e => (setName(e.target.value), setErr({}))} />}
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <Field label={t('common.type')} className="grow" hint={edit ? undefined : t('catalog.attrs.storedAs', { key: keyFromName(name || 'attr', 'attr') })}>
              {p => (
                <select className="select" id={p.id} value={type} disabled={edit} onChange={e => setType(e.target.value as FieldType)}>
                  {ATTRIBUTE_TYPES.map(ft => (
                    <option key={ft} value={ft}>
                      {tEnum('fieldType', ft, FIELD_TYPE_LABELS[ft])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('catalog.attrs.unit')} className="grow" hint={t('catalog.attrs.unitHint')}>
              {p => <Input {...p} value={unit} maxLength={20} onChange={e => setUnit(e.target.value)} />}
            </Field>
          </div>

          {(type === 'select' || type === 'multi_select') && (
            <Field label={t('catalog.attrs.options')} error={err.options}>
              {() => (
                <div>
                  {choices.map((c, i) => (
                    <div key={i} className="dm-choice">
                      <Input aria-label={t('catalog.attrs.option', { n: i + 1 })} value={c.label} onChange={e => setChoice(i, { label: e.target.value })} />
                      <select className="select" aria-label={t('catalog.attrs.optionColor', { n: i + 1 })} value={c.color} onChange={e => setChoice(i, { color: e.target.value })}>
                        {CHOICE_COLORS.map(col => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="ibtn" aria-label={t('catalog.attrs.removeOption', { n: i + 1 })} onClick={() => setChoices(list => list.filter((_, j) => j !== i))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChoices(list => [...list, { value: `option_${list.length + 1}`, label: '', color: CHOICE_COLORS[(list.length + 1) % CHOICE_COLORS.length]!, isNew: true }])}>
                    <Plus size={13} />
                    {t('catalog.attrs.addOption')}
                  </Button>
                </div>
              )}
            </Field>
          )}

          {(type === 'number' || type === 'money' || type === 'percent') && (
            <div className="row" style={{ gap: 10 }}>
              <Field label={t('catalog.attrs.minimum')} className="grow">
                {p => <Input {...p} inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} />}
              </Field>
              <Field label={t('catalog.attrs.maximum')} className="grow">
                {p => <Input {...p} inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} />}
              </Field>
            </div>
          )}

          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={required} onChange={e => setRequired(e.target.checked)} />
            {t('catalog.attrs.requiredForNew')}
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
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('catalog.attrs.deleteTitle', { name: attr.name })}
        description={t('catalog.attrs.deleteText')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy || typed !== attr.key}
              onClick={async () => {
                setBusy(true);
                const r = await api<{ cleared: number }>('DELETE', `/attribute-defs/${attr.id}?confirm=${attr.key}`);
                setBusy(false);
                if (!r) return;
                toast(r.cleared ? t('catalog.attrs.deletedCleared', { name: attr.name, count: r.cleared }) : t('catalog.attrs.deleted', { name: attr.name }));
                onClose();
              }}
            >
              {t('catalog.attrs.deletePermanently')}
            </Button>
          </>
        }
      >
        <Field label={t('catalog.attrs.typeToConfirm', { key: attr.key })}>{p => <Input {...p} autoFocus value={typed} onChange={e => setTyped(e.target.value)} />}</Field>
      </DialogContent>
    </Dialog>
  );
}
