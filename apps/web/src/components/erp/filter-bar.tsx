/* FilterBar — обобщённая панель вида списка: поиск, фильтры «поле → набор значений», сортировка, группировка, колонки
   и строка чипов. Внешне и по поведению повторяет ViewToolbar задач (app/components/view-toolbar.tsx), но поля
   и опции описываются данными, а не привязаны к задачам. */
import * as React from 'react';
import { ArrowUpDown, Columns3, ListFilter, Plus, RotateCcw, Rows3, Search, X } from 'lucide-react';
import { Badge, Button, Input, Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '@/components/ui';
import { t } from '@/i18n';

export interface FilterOption {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

export interface FilterField {
  id: string;
  name: string;
  icon: React.ReactNode;
  options: FilterOption[];
}

/** Состояние поиска и фильтров: q + значения по полям */
export function useFilterState(initial?: { q?: string; values?: Record<string, string[]> }) {
  const [q, setQ] = React.useState(initial?.q ?? '');
  const [values, setValues] = React.useState<Record<string, string[]>>(initial?.values ?? {});
  return {
    q,
    setQ,
    values,
    count: Object.values(values).filter(v => v.length).length,
    toggle: (field: string, id: string) =>
      setValues(m => {
        const cur = m[field] ?? [];
        return { ...m, [field]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
      }),
    remove: (field: string) => setValues(m => ({ ...m, [field]: [] })),
    clear: () => setValues({}),
    reset: () => {
      setQ('');
      setValues({});
    },
  };
}
export type FilterState = ReturnType<typeof useFilterState>;

export interface FilterBarProps {
  search: { value: string; onChange: (v: string) => void; placeholder: string };
  fields?: FilterField[];
  filters?: FilterState;
  sort?: { options: { id: string; name: string }[]; value: string | null; dir: 1 | -1; onChange: (id: string | null, dir: 1 | -1) => void };
  group?: { options: { id: string; name: string; icon?: React.ReactNode }[]; value: string; onChange: (id: string) => void };
  columns?: { options: { id: string; name: string }[]; hidden: string[]; onToggle: (id: string) => void; onReset: () => void };
  extra?: React.ReactNode;
  /** Контролы перед поиском (например, переключатель видов) */
  left?: React.ReactNode;
  right?: React.ReactNode;
}

function FilterMenu({ fields, filters, children }: { fields: FilterField[]; filters: FilterState; children: React.ReactElement }) {
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent>
        <MenuLabel>{t('ui.filterBy')}</MenuLabel>
        {fields.map(f => {
          const sel = filters.values[f.id] ?? [];
          return (
            <MenuSub key={f.id}>
              <MenuSubTrigger icon={f.icon}>
                {f.name}
                {!!sel.length && <span className="faint"> · {sel.length}</span>}
              </MenuSubTrigger>
              <MenuSubContent>
                {f.options.map(o => (
                  <MenuCheckboxItem key={o.id} icon={o.icon} checked={sel.includes(o.id)} onCheckedChange={() => filters.toggle(f.id, o.id)} onSelect={e => e.preventDefault()}>
                    {o.name}
                  </MenuCheckboxItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

export function FilterBar({ search, fields, filters, sort, group, columns, extra, left, right }: FilterBarProps) {
  const active = fields && filters ? fields.filter(f => (filters.values[f.id] ?? []).length) : [];
  const sortName = sort?.options.find(o => o.id === sort.value)?.name ?? t('ui.manual');
  const groupName = group?.options.find(o => o.id === group.value)?.name ?? t('ui.none');
  return (
    <>
      <div className="toolbar fb-bar" role="toolbar">
        {left}
        <Input size="sm" icon={<Search size={13} />} className="!w-[200px]" placeholder={search.placeholder} aria-label={search.placeholder} value={search.value} onChange={e => search.onChange(e.target.value)} />
        {fields && filters && (
          <FilterMenu fields={fields} filters={filters}>
            <Button variant="ghost" className={active.length ? 'on' : undefined}>
              <ListFilter size={14} />
              {t('ui.filter')}
              {!!active.length && (
                <Badge tone="accent" style={{ height: 16, padding: '0 5px' }}>
                  {active.length}
                </Badge>
              )}
            </Button>
          </FilterMenu>
        )}
        {sort && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost">
                <ArrowUpDown size={14} />
                <span className="hide-m">{t('ui.sort')}</span> {sortName}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuRadioGroup value={sort.value ?? 'manual'} onValueChange={id => sort.onChange(id === 'manual' ? null : id, 1)}>
                <MenuRadioItem value="manual">{t('ui.manual')}</MenuRadioItem>
                {sort.options.map(o => (
                  <MenuRadioItem key={o.id} value={o.id}>
                    {o.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuRadioGroup value={String(sort.dir)} onValueChange={d => sort.onChange(sort.value, +d as 1 | -1)}>
                <MenuRadioItem value="1">{t('ui.ascending')}</MenuRadioItem>
                <MenuRadioItem value="-1">{t('ui.descending')}</MenuRadioItem>
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
        {group && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost">
                <Rows3 size={14} />
                <span className="hide-m">{t('ui.group')}</span> {groupName}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{t('ui.groupBy')}</MenuLabel>
              <MenuRadioGroup value={group.value} onValueChange={group.onChange}>
                {group.options.map(o => (
                  <MenuRadioItem key={o.id} value={o.id} icon={o.icon}>
                    {o.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
        {columns && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost">
                <Columns3 size={14} />
                {t('ui.columns')}
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{t('ui.visibleColumns')}</MenuLabel>
              {columns.options.map(c => (
                <MenuCheckboxItem key={c.id} checked={!columns.hidden.includes(c.id)} onCheckedChange={() => columns.onToggle(c.id)} onSelect={e => e.preventDefault()}>
                  {c.name}
                </MenuCheckboxItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<RotateCcw size={14} />} onSelect={columns.onReset}>
                {t('ui.resetWidths')}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        {extra}
        <span className="sp" />
        {right}
      </div>
      {fields && filters && !!active.length && (
        <div className="chipsbar fb-bar">
          <ListFilter size={13} />
          {active.map((f, i) => {
            const names = (filters.values[f.id] ?? []).map(id => f.options.find(o => o.id === id)?.name ?? id);
            return (
              <React.Fragment key={f.id}>
                {i > 0 && <span>{t('ui.and')}</span>}
                <span className="chip">
                  <FilterMenu fields={fields} filters={filters}>
                    <button style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      {React.cloneElement(f.icon as React.ReactElement<{ size: number }>, { size: 12 })}
                      <b>{f.name}</b> {t('ui.is')} <span>{names.length > 2 ? t('ui.selected', { count: names.length }) : names.join(', ')}</span>
                    </button>
                  </FilterMenu>
                  <button className="ibtn" aria-label={t('ui.removeFilter', { name: f.name })} onClick={() => filters.remove(f.id)}>
                    <X size={12} />
                  </button>
                </span>
              </React.Fragment>
            );
          })}
          <FilterMenu fields={fields} filters={filters}>
            <Button size="sm" variant="ghost">
              <Plus size={12} />
              {t('ui.add')}
            </Button>
          </FilterMenu>
          <span className="sp" />
          <Button size="sm" variant="ghost" onClick={filters.clear}>
            {t('ui.clearAll')}
          </Button>
        </div>
      )}
    </>
  );
}
