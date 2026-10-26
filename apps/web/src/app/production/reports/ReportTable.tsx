/* Таблица отчёта: сворачиваемые группировки (уровни → итоги группы в её строке), общий итог внизу,
   клик по строке открывает документ-источник, выгрузка CSV того, что на экране (с учётом отборов).
   Любой отчёт описывает колонки, уровни группировки и строки — см. ReleaseTab и соседей. */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui';
import { dec, fmt } from '@gr8r/shared';
import { useT } from '@/i18n';
import { downloadCsv } from './csv';

export interface ReportColumn<R> {
  id: string;
  header: string;
  align?: 'r';
  width?: number;
  /** Значение для CSV и итогов (строка, число или null) */
  value: (r: R) => string | number | null;
  /** Показ в ячейке; по умолчанию — value как есть */
  render?: (r: R) => React.ReactNode;
  /** Показ суммы в строке группы и в итоге (форматтер числа) */
  total?: { format: (v: string) => string; scale?: number } | ((rows: R[]) => React.ReactNode);
  /** Значение итога для CSV, если колонка считает итог функцией */
  totalCsv?: (rows: R[]) => string | number | null;
}

export interface GroupLevel<R> {
  key: (r: R) => string;
  /** Заголовок группы на экране и в CSV */
  label: (rows: R[]) => React.ReactNode;
  csv: (rows: R[]) => string;
  /** Название колонки группы в CSV */
  csvHeader: string;
}

interface Props<R> {
  rows: R[];
  columns: ReportColumn<R>[];
  groups: GroupLevel<R>[];
  rowKey: (r: R, i: number) => string;
  /** Адрес документа-источника строки (null — строка не открывается) */
  href?: (r: R) => string | null;
  /** Выделение строки (просрочка, перегрузка) */
  rowTone?: (r: R) => 'danger' | undefined;
  /** Имя файла CSV без расширения */
  filename: string;
  label: string;
}

/** Сумма колонки по строкам: decimal, без float */
function sumOf<R>(rows: R[], col: ReportColumn<R>): string {
  const scale = typeof col.total === 'object' ? (col.total.scale ?? 3) : 3;
  return fmt(rows.reduce((s, r) => s + dec(col.value(r) as string | number | null), 0n), scale);
}

interface Node<R> {
  path: string;
  level: number;
  rows: R[];
  children: Node<R>[];
}

function build<R>(rows: R[], groups: GroupLevel<R>[], level: number, path: string): Node<R>[] {
  const g = groups[level];
  if (!g) return [];
  const map = new Map<string, R[]>();
  for (const r of rows) map.set(g.key(r), [...(map.get(g.key(r)) ?? []), r]);
  return [...map.entries()].map(([k, list]) => ({ path: `${path}/${k}`, level, rows: list, children: build(list, groups, level + 1, `${path}/${k}`) }));
}

export function ReportTable<R>({ rows, columns, groups, rowKey, href, rowTone, filename, label }: Props<R>) {
  const tt = useT();
  const navigate = useNavigate();
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const tree = React.useMemo(() => build(rows, groups, 0, ''), [rows, groups]);
  const toggle = (path: string) => setClosed(s => {
    const n = new Set(s);
    if (!n.delete(path)) n.add(path);
    return n;
  });
  const allPaths = React.useMemo(() => {
    const out: string[] = [];
    const walk = (ns: Node<R>[]) => ns.forEach(n => { out.push(n.path); walk(n.children); });
    walk(tree);
    return out;
  }, [tree]);

  const totalCell = (list: R[], c: ReportColumn<R>): React.ReactNode => (!c.total ? null : typeof c.total === 'function' ? c.total(list) : c.total.format(sumOf(list, c)));

  const exportCsv = () => {
    const head = [...groups.map(g => g.csvHeader), ...columns.map(c => c.header)];
    const lines: (string | number | null)[][] = [head];
    const walk = (ns: Node<R>[], ctx: string[]) => {
      for (const n of ns) {
        const gl = [...ctx, groups[n.level]!.csv(n.rows)];
        if (n.children.length) walk(n.children, gl);
        else n.rows.forEach(r => lines.push([...gl, ...columns.map(c => c.value(r))]));
      }
    };
    if (groups.length) walk(tree, []);
    else rows.forEach(r => lines.push(columns.map(c => c.value(r))));
    const sums = columns.map(c => (!c.total ? '' : typeof c.total === 'function' ? (c.totalCsv ? c.totalCsv(rows) : '') : sumOf(rows, c)));
    const totalLabel = tt('production.reports.total');
    lines.push(groups.length ? [totalLabel, ...groups.slice(1).map(() => ''), ...sums] : [totalLabel, ...sums.slice(1)]);
    downloadCsv(`${filename}.csv`, lines);
  };

  const open = (r: R) => {
    const to = href?.(r);
    if (to) navigate(to);
  };

  const dataRow = (r: R, i: number, depth: number) => {
    const to = href?.(r) ?? null;
    const tone = rowTone?.(r);
    return (
      <tr
        key={rowKey(r, i)}
        className={to ? 'clickable' : undefined}
        style={{ cursor: to ? 'pointer' : undefined, background: tone === 'danger' ? 'var(--red-soft)' : undefined }}
        onClick={to ? () => open(r) : undefined}
        onKeyDown={to ? e => { if (e.key === 'Enter') open(r); } : undefined}
        tabIndex={to ? 0 : undefined}
      >
        {columns.map((c, ci) => (
          <td key={c.id} className={c.align === 'r' ? 'r num' : undefined} style={ci === 0 ? { paddingLeft: 12 + depth * 18 } : undefined}>
            {c.render ? c.render(r) : (c.value(r) ?? '')}
          </td>
        ))}
      </tr>
    );
  };

  const renderNode = (n: Node<R>): React.ReactNode => {
    const g = groups[n.level]!;
    const isClosed = closed.has(n.path);
    return (
      <React.Fragment key={n.path}>
        <tr style={{ background: 'var(--surface-2)' }}>
          <td style={{ paddingLeft: 12 + n.level * 18, fontWeight: 600 }}>
            <button type="button" className="row" style={{ gap: 6, alignItems: 'center', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }} aria-expanded={!isClosed} onClick={() => toggle(n.path)}>
              {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              {g.label(n.rows)}
            </button>
          </td>
          {columns.slice(1).map(c => (
            <td key={c.id} className={c.align === 'r' ? 'r num' : undefined} style={{ fontWeight: 600 }}>{totalCell(n.rows, c)}</td>
          ))}
        </tr>
        {!isClosed && (n.children.length ? n.children.map(renderNode) : n.rows.map((r, i) => dataRow(r, i, n.level + 1)))}
      </React.Fragment>
    );
  };

  return (
    <section className="panel plain" style={{ margin: '0 var(--gutter) 24px' }}>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        {groups.length > 0 && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setClosed(new Set())}>{tt('production.reports.expandAll')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setClosed(new Set(allPaths))}>{tt('production.reports.collapseAll')}</Button>
          </>
        )}
        <Button size="sm" onClick={exportCsv}><Download size={14} /> {tt('production.reports.exportCsv')}</Button>
      </div>
      <table className="dtbl" aria-label={label}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.id} className={c.align === 'r' ? 'r' : undefined} style={c.width ? { width: c.width } : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{groups.length ? tree.map(renderNode) : rows.map((r, i) => dataRow(r, i, 0))}</tbody>
        <tfoot>
          <tr>
            <td><strong>{tt('production.reports.total')}</strong></td>
            {columns.slice(1).map(c => (
              <td key={c.id} className={c.align === 'r' ? 'r num' : undefined}><strong>{totalCell(rows, c)}</strong></td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
