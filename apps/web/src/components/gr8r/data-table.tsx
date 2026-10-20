/* DataTable<T> — обобщённая таблица: описание колонок, сортировка по заголовку, группы с итогами, выбор колонок,
   ширина колонок перетаскиванием, клик по строке, пустое состояние и карточки вместо таблицы на ≤640px.
   Разметка и CSS-классы (.tbl, .thi, .rsz, .grow-row…) те же, что у таблицы задач (app/components/table-view.tsx). */
import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  header: string;
  /** Ширина по умолчанию, px */
  width: number;
  align?: 'left' | 'right';
  /** Значение для сортировки (и текст ячейки, если нет cell) */
  value?: (row: T) => string | number | null | undefined;
  cell?: (row: T) => React.ReactNode;
  /** По умолчанию сортируется всё, у чего есть value */
  sortable?: boolean;
  /** Итог по колонке: для строки «Total» внизу и для строк групп */
  total?: (rows: T[]) => React.ReactNode;
  /** false — колонку нельзя скрыть (первая колонка не скрывается никогда) */
  hideable?: boolean;
  /** Скрыта, пока её не включат в меню Columns */
  defaultHidden?: boolean;
  /** false — не показывать в карточке на телефоне */
  mobile?: boolean;
}

export interface SortState {
  /** null — исходный порядок строк */
  id: string | null;
  dir: 1 | -1;
}

export interface DataTableState {
  sort: SortState;
  /** Клик по заголовку: тот же столбец меняет направление, новый — сортировка по возрастанию */
  setSort: (id: string | null, dir?: 1 | -1) => void;
  hidden: string[];
  toggleColumn: (id: string) => void;
  colW: Record<string, number>;
  setColW: (id: string, w: number) => void;
  resetColW: () => void;
}

/** Состояние таблицы: сортировка, скрытые колонки и ширины. Живёт у страницы, чтобы тулбар мог им управлять */
export function useDataTable<T>(columns: Column<T>[], initial?: { sort?: SortState; hidden?: string[] }): DataTableState {
  const [sort, setSortState] = React.useState<SortState>(initial?.sort ?? { id: null, dir: 1 });
  const [hidden, setHidden] = React.useState<string[]>(() => initial?.hidden ?? columns.filter(c => c.defaultHidden).map(c => c.id));
  const [colW, setW] = React.useState<Record<string, number>>({});
  return {
    sort,
    setSort: (id, dir) => setSortState(s => ({ id, dir: dir ?? (id && s.id === id ? (s.dir === 1 ? -1 : 1) : 1) })),
    hidden,
    toggleColumn: id => setHidden(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id])),
    colW,
    setColW: (id, w) => setW(m => ({ ...m, [id]: w })),
    resetColW: () => setW({}),
  };
}

const sortable = <T,>(c: Column<T>) => c.sortable ?? !!c.value;

/** Сортирует копию массива по колонке; пустые значения всегда внизу */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState): T[] {
  const col = columns.find(c => c.id === sort.id);
  if (!col?.value) return rows;
  const val = col.value;
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
    return r * sort.dir;
  });
}

/** Данные для пункта Columns в FilterBar */
export function columnsMenu<T>(columns: Column<T>[], table: DataTableState) {
  return {
    options: columns.filter((c, i) => i > 0 && c.hideable !== false).map(c => ({ id: c.id, name: c.header })),
    hidden: table.hidden,
    onToggle: table.toggleColumn,
    onReset: table.resetColW,
  };
}

export interface DataTableGroup<T> {
  key: (row: T) => string;
  label: (key: string, rows: T[]) => React.ReactNode;
  /** Порядок групп; остальные идут после, в порядке появления */
  order?: string[];
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  table: DataTableState;
  getId: (row: T) => string;
  onRowClick?: (row: T) => void;
  groupBy?: DataTableGroup<T>;
  /** Строка «Total» внизу (если у колонок есть total) */
  showTotals?: boolean;
  totalLabel?: React.ReactNode;
  /** Строка «+ New …» внизу таблицы */
  onNew?: () => void;
  newLabel?: string;
  /** Пустое состояние; по умолчанию «No results found» */
  empty?: React.ReactNode;
  /** Своя карточка строки для телефона */
  renderCard?: (row: T) => React.ReactNode;
  'aria-label': string;
}

const cellValue = <T,>(c: Column<T>, row: T) => (c.cell ? c.cell(row) : (c.value?.(row) ?? <span className="faint">—</span>));

export function DataTable<T>({ columns, rows, table, getId, onRowClick, groupBy, showTotals = true, totalLabel = 'Total', onNew, newLabel = 'New', empty, renderCard, ...rest }: DataTableProps<T>) {
  const cols = columns.filter((c, i) => i === 0 || !table.hidden.includes(c.id));
  const width = (c: Column<T>) => table.colW[c.id] ?? c.width;
  const totalW = cols.reduce((a, c) => a + width(c), 0);
  const sorted = React.useMemo(() => sortRows(rows, columns, table.sort), [rows, columns, table.sort]);

  const groups = React.useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, T[]>();
    for (const r of sorted) {
      const k = groupBy.key(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    const order = groupBy.order ?? [];
    const keys = [...map.keys()].sort((a, b) => {
      const i = order.indexOf(a);
      const j = order.indexOf(b);
      return (i < 0 ? 1e6 : i) - (j < 0 ? 1e6 : j);
    });
    return keys.map(k => ({ key: k, rows: map.get(k)! }));
  }, [groupBy, sorted]);

  if (!rows.length)
    return (
      empty ?? (
        <EmptyState icon={<SearchX size={20} />} title="No results found">
          Nothing matches the current filters.
        </EmptyState>
      )
    );

  // Ширина колонки меняется перетаскиванием правого края заголовка
  const startResize = (e: React.PointerEvent, col: Column<T>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.classList.add('on');
    const w0 = width(col);
    const x0 = e.clientX;
    const mv = (ev: PointerEvent) => table.setColW(col.id, Math.max(64, Math.round(w0 + ev.clientX - x0)));
    const up = () => {
      el.classList.remove('on');
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  const hasTotals = showTotals && cols.some(c => c.total);
  const right = (c: Column<T>) => (c.align === 'right' ? { textAlign: 'right' as const } : undefined);
  const rowProps = (r: T) =>
    onRowClick ? { tabIndex: 0, onClick: () => onRowClick(r), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && onRowClick(r) } : {};
  const bodyRow = (r: T) => (
    <tr key={getId(r)} data-id={getId(r)} className={onRowClick ? 'dt-click' : undefined} {...rowProps(r)}>
      {cols.map((c, i) => (
        <td key={c.id} className={cn(i === 0 && 'sticky', c.align === 'right' && 'num')} style={right(c)}>
          {cellValue(c, r)}
        </td>
      ))}
    </tr>
  );

  const mobileCols = cols.slice(1).filter(c => c.mobile !== false).slice(0, 5);
  const mobileCard = (r: T) =>
    renderCard ? (
      <div key={getId(r)} {...rowProps(r)} role={onRowClick ? 'button' : undefined}>
        {renderCard(r)}
      </div>
    ) : (
      <div key={getId(r)} className={cn('panel dt-card', !onRowClick && '!cursor-default')} role={onRowClick ? 'button' : undefined} {...rowProps(r)}>
        <div className="dt-card-t">{cellValue(cols[0], r)}</div>
        <div className="dt-card-kv">
          {mobileCols.map(c => (
            <React.Fragment key={c.id}>
              <span className="faint">{c.header}</span>
              <span className="dt-card-v">{cellValue(c, r)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );

  return (
    <>
      <div className="tbl-wrap hide-m">
        <table className="tbl" style={{ width: totalW }} {...rest}>
          <colgroup>
            {cols.map(c => (
              <col key={c.id} style={{ width: width(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => {
                const on = table.sort.id === c.id;
                const SortIcon = table.sort.dir > 0 ? ArrowUp : ArrowDown;
                const can = sortable(c);
                return (
                  <th key={c.id} className={i === 0 ? 'sticky' : undefined} style={{ position: 'sticky' }} scope="col" aria-sort={on ? (table.sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                    <div
                      className="thi"
                      style={{ ...(c.align === 'right' ? { justifyContent: 'flex-end' } : null), ...(can ? null : { cursor: 'default' }) }}
                      onClick={can ? () => table.setSort(c.id) : undefined}
                    >
                      {on && c.align === 'right' && <SortIcon size={11} />}
                      {c.header}
                      {on && c.align !== 'right' && <SortIcon size={11} />}
                    </div>
                    <span className="rsz" aria-hidden onPointerDown={e => startResize(e, c)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map(g => (
                  <React.Fragment key={g.key}>
                    <tr className="grow-row">
                      {cols.map((c, i) => (
                        <td key={c.id} className={cn(i === 0 && 'sticky', c.align === 'right' && 'num')} style={right(c)}>
                          {i === 0 ? (
                            <span className="row" style={{ gap: 6 }}>
                              {groupBy!.label(g.key, g.rows)}
                              <span className="faint" style={{ fontWeight: 500 }}>
                                {g.rows.length}
                              </span>
                            </span>
                          ) : (
                            c.total?.(g.rows)
                          )}
                        </td>
                      ))}
                    </tr>
                    {g.rows.map(bodyRow)}
                  </React.Fragment>
                ))
              : sorted.map(bodyRow)}
            {onNew && (
              <tr>
                <td className="sticky cellbtn" colSpan={cols.length} style={{ color: 'var(--text-3)' }} onClick={onNew}>
                  <span className="row" style={{ gap: 6 }}>
                    <Plus size={14} />
                    {newLabel}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td key={c.id} className={cn(i === 0 && 'sticky', c.align === 'right' && 'num')} style={right(c)}>
                    {i === 0 ? (
                      <span className="row" style={{ gap: 6 }}>
                        {totalLabel}
                        <span className="faint" style={{ fontWeight: 500 }}>
                          {rows.length}
                        </span>
                      </span>
                    ) : (
                      c.total?.(rows)
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {/* На телефоне таблица заменяется списком карточек */}
      <div className="only-m dt-cards">
        {(groups ?? [{ key: '', rows: sorted }]).map(g => (
          <React.Fragment key={g.key}>
            {groups && (
              <div className="dt-mgroup">
                {groupBy!.label(g.key, g.rows)}
                <span className="faint">{g.rows.length}</span>
              </div>
            )}
            {g.rows.map(mobileCard)}
          </React.Fragment>
        ))}
        {hasTotals && (
          <div className="dt-mtotal">
            <b>{totalLabel}</b>
            <span className="faint">{rows.length}</span>
            {cols.filter(c => c.total).map(c => (
              <span key={c.id} className="row" style={{ gap: 4 }}>
                <span className="faint">{c.header}</span>
                {c.total!(rows)}
              </span>
            ))}
          </div>
        )}
        {onNew && (
          <button className="addcard" style={{ marginTop: 4 }} onClick={onNew}>
            <Plus size={14} />
            {newLabel}
          </button>
        )}
      </div>
    </>
  );
}
