/* Лёгкий SVG-график столбцами: группы по оси X, в группе — несколько рядов (план и факт и т. п.).
   Без зависимостей; цвета рядов — токены темы (var(--…)), поэтому тёмная тема работает сама. */
import { fmtNumber } from '@/i18n';

export interface BarSeries {
  id: string;
  label: string;
  /** Цвет — токен темы, например var(--accent) */
  color: string;
}

export interface BarGroup {
  label: string;
  /** Значения по id ряда */
  values: Record<string, number>;
  /** Столбцы группы подсвечены предупреждением (перегрузка) */
  flag?: boolean;
}

interface Props {
  groups: BarGroup[];
  series: BarSeries[];
  /** Подпись для скринридера */
  title: string;
  /** Линия-ориентир (например, 100 % мощности) */
  reference?: { value: number; label: string };
  height?: number;
  /** Значения — штуки: деления шкалы только целые */
  integer?: boolean;
}

const PAD = { l: 44, r: 8, t: 8, b: 44 };

/** Круглое верхнее значение оси: 1, 2, 5 × 10^n */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function BarChart({ groups, series, title, reference, height = 220, integer }: Props) {
  const width = Math.max(320, groups.length * (series.length * 18 + 22) + PAD.l + PAD.r);
  const top = Math.max(reference?.value ?? 0, ...groups.flatMap(g => series.map(s => g.values[s.id] ?? 0)));
  // для штук — 4 целых деления: шаг округляем вверх
  const max = integer ? Math.max(1, Math.ceil(top / 4)) * 4 : niceMax(top);
  const plotH = height - PAD.t - PAD.b;
  const gw = (width - PAD.l - PAD.r) / Math.max(groups.length, 1);
  const bw = Math.min(26, (gw - 10) / Math.max(series.length, 1));
  const y = (v: number) => PAD.t + plotH - (Math.max(v, 0) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  return (
    <figure style={{ margin: 0, overflowX: 'auto' }}>
      <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: 'block', maxWidth: '100%' }}>
        {ticks.map(tk => (
          <g key={tk}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(tk)} y2={y(tk)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(tk) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">{fmtNumber(tk, { maximumFractionDigits: 1 })}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const x0 = PAD.l + gi * gw + (gw - bw * series.length) / 2;
          return (
            <g key={gi}>
              {series.map((s, si) => {
                const v = g.values[s.id] ?? 0;
                return (
                  <rect key={s.id} x={x0 + si * bw} y={y(v)} width={Math.max(bw - 2, 1)} height={Math.max(PAD.t + plotH - y(v), 0)} rx={2} fill={g.flag ? 'var(--red)' : s.color}>
                    <title>{`${g.label} · ${s.label}: ${fmtNumber(v, { maximumFractionDigits: 2 })}`}</title>
                  </rect>
                );
              })}
              <text x={PAD.l + gi * gw + gw / 2} y={height - PAD.b + 16} textAnchor="middle" fontSize={11} fill="var(--text-2)">{g.label.length > 14 ? `${g.label.slice(0, 13)}…` : g.label}</text>
            </g>
          );
        })}
        {reference && (
          <g>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--amber)" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={width - PAD.r} y={y(reference.value) - 4} textAnchor="end" fontSize={11} fill="var(--amber)">{reference.label}</text>
          </g>
        )}
      </svg>
      <figcaption className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 12, marginTop: 4 }}>
        {series.map(s => (
          <span key={s.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
