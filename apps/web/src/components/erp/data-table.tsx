/* DataTable<T> — обобщённая таблица: описание колонок, сортировка по заголовку, группы с итогами, выбор колонок,
   ширина колонок перетаскиванием, клик по строке, пустое состояние и карточки вместо таблицы на ≤640px.
   Для больших списков: virtual (в DOM только видимые строки), manualSort (порядок задаёт сервер), onEndReached + footer (подгрузка страниц).
   Разметка и CSS-классы (.tbl, .thi, .rsz, .grow-row…) те же, что у таблицы задач (app/components/table-view.tsx). */
import * as React from 'react';
import { ArrowDown, ArrowUp, Plus, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

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
  /** Строки уже отсортированы сервером: заголовок меняет table.sort, но таблица порядок не трогает */
  manualSort?: boolean;
  /** Виртуальная прокрутка: в DOM только видимые строки (+ запас), высота строки меряется по отрисованным. Без групп */
  virtual?: boolean;
  /** Прокрутка дошла до конца загруженных строк — подгрузить следующую страницу */
  onEndReached?: () => void;
  /** Под строками: «Загрузить ещё», «Загружаем…» */
  footer?: React.ReactNode;
  'aria-label': string;
}

const OVERSCAN = 12;

/** Видимый диапазон строк по прокрутке контейнера; средняя высота строки уточняется по уже отрисованным строкам */
function useVirtualRange(enabled: boolean, count: number, el: HTMLDivElement | null, body: React.RefObject<HTMLTableSectionElement | null>, onEndReached?: () => void) {
  const [view, setView] = React.useState({ top: 0, height: 800 });
  const rowH = React.useRef(37);
  const endRef = React.useRef(onEndReached);
  endRef.current = onEndReached;
  // контейнер — состояние (callback-ref): таблица могла смонтироваться пустой, и прокрутка появляется позже
  React.useEffect(() => {
    if (!enabled || !el) return;
    const update = () => {
      setView({ top: el.scrollTop, height: el.clientHeight });
      // до конца прокрутки меньше двух экранов — просим следующую страницу (только по прокрутке пользователя, без цепочки)
      if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 2) endRef.current?.();
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [enabled, el]);
  // уточняем высоту строки по фактически отрисованным строкам данных
  React.useLayoutEffect(() => {
    const rows = body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-id]');
    if (!enabled || !rows?.length) return;
    let h = 0;
    rows.forEach(r => (h += r.offsetHeight));
    const avg = h / rows.length;
    if (avg > 0 && Math.abs(avg - rowH.current) > 0.5) rowH.current = avg;
  });
  if (!enabled) return { start: 0, end: count, before: 0, after: 0 };
  const h = rowH.current;
  const start = Math.max(0, Math.floor(view.top / h) - OVERSCAN);
  const end = Math.min(count, Math.ceil((view.top + view.height) / h) + OVERSCAN);
  return { start, end, before: start * h, after: (count - end) * h };
}

const cellValue = <T,>(c: Column<T>, row: T) => (c.cell ? c.cell(row) : (c.value?.(row) ?? <span className="faint">—</span>));

export function DataTable<T>({ columns, rows, table, getId, onRowClick, groupBy, showTotals = true, totalLabel = t('ui.total'), onNew, newLabel = t('ui.new'), empty, renderCard, manualSort, virtual, onEndReached, footer, ...rest }: DataTableProps<T>) {
  const cols = columns.filter((c, i) => i === 0 || !table.hidden.includes(c.id));
  const width = (c: Column<T>) => table.colW[c.id] ?? c.width;
  const totalW = cols.reduce((a, c) => a + width(c), 0);
  const sorted = React.useMemo(() => (manualSort ? rows : sortRows(rows, columns, table.sort)), [rows, columns, table.sort, manualSort]);
  const [wrapEl, setWrapEl] = React.useState<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const range = useVirtualRange(!!virtual && !groupBy, sorted.length, wrapEl, bodyRef, onEndReached);
  // карточки на телефоне не виртуализуются: следующая страница — когда низ списка показался на экране
  const cardsEnd = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = cardsEnd.current;
    if (!el || !onEndReached) return;
    const io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && onEndReached());
    io.observe(el);
    return () => io.disconnect();
  }, [onEndReached, rows.length]);

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
        <EmptyState icon={<SearchX size={20} />} title={t('common.noResults')}>
          {t('ui.nothingMatches')}
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
      <div className="tbl-wrap hide-m" ref={setWrapEl}>
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
          <tbody ref={bodyRef}>
            {range.before > 0 && (
              <tr aria-hidden="true">
                <td colSpan={cols.length} style={{ height: range.before, padding: 0, border: 0 }} />
              </tr>
            )}
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
              : sorted.slice(range.start, range.end).map(bodyRow)}
            {range.after > 0 && (
              <tr aria-hidden="true">
                <td colSpan={cols.length} style={{ height: range.after, padding: 0, border: 0 }} />
              </tr>
            )}
            {footer && (
              <tr>
                <td className="sticky" colSpan={cols.length}>
                  {footer}
                </td>
              </tr>
            )}
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
        {footer}
        {onEndReached && <div ref={cardsEnd} aria-hidden="true" style={{ height: 1 }} />}
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
