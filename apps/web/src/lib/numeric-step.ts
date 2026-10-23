/* Стрелки вверх/вниз в числовом поле (как в 1С): шаг 1, с Shift — 10, ниже нуля не уходит.
   Дробная часть и разделитель (точка или запятая) сохраняются */

export function stepNumeric(value: string, dir: 1 | -1, big = false): string | null {
  const raw = value.trim().replace(/\s/g, '');
  if (raw !== '' && !/^-?\d*[.,]?\d*$/.test(raw)) return null;
  const sep = raw.includes(',') ? ',' : '.';
  const frac = raw.split(/[.,]/)[1] ?? '';
  const n = raw === '' || raw === '-' || raw === sep ? 0 : Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const next = Math.max(0, n + dir * (big ? 10 : 1));
  const out = next.toFixed(frac.length);
  return sep === ',' ? out.replace('.', ',') : out;
}

/** Меняет значение поля так, чтобы сработал onChange React (нативный setter + событие input) */
export function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Обработчик стрелок для числового поля; true — клавиша обработана */
export function handleNumericArrow(e: React.KeyboardEvent<HTMLInputElement>): boolean {
  if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey) return false;
  const el = e.currentTarget;
  if (el.disabled || el.readOnly) return false;
  const next = stepNumeric(el.value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
  if (next === null) return false;
  e.preventDefault();
  if (next !== el.value) setInputValue(el, next);
  return true;
}
