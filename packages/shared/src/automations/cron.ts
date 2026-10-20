/* Расписание: пять полей cron (минута час день-месяца месяц день-недели), время — UTC.
   Поддерживается * , - / (списки, диапазоны, шаги); день недели 0–7 (0 и 7 — воскресенье).
   Если заданы и день месяца, и день недели, срабатывает любое из условий (как в классическом cron). */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(src: string, [min, max]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1]!.split('-');
      lo = Number(a);
      hi = b === undefined ? (m[2] === undefined ? lo : max) : Number(b);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, RANGES[i]!));
  if (sets.some(s => !s)) return null;
  const [minute, hour, dom, month, dow] = sets as Set<number>[];
  if (dow!.has(7)) dow!.add(0);
  return { minute: minute!, hour: hour!, dom: dom!, month: month!, dow: dow!, domAny: parts[2]!.startsWith('*'), dowAny: parts[4]!.startsWith('*') };
}

export function cronMatches(spec: CronSpec, at: Date): boolean {
  if (!spec.minute.has(at.getUTCMinutes()) || !spec.hour.has(at.getUTCHours()) || !spec.month.has(at.getUTCMonth() + 1)) return false;
  const domOk = spec.dom.has(at.getUTCDate());
  const dowOk = spec.dow.has(at.getUTCDay());
  if (spec.domAny && spec.dowAny) return true;
  if (spec.domAny) return dowOk;
  if (spec.dowAny) return domOk;
  return domOk || dowOk;
}

export const isValidCron = (expr: string) => parseCron(expr) !== null;
