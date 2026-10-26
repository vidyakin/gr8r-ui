/* Выгрузка отчёта в CSV: значения как есть (форматтеры интерфейса не применяются), разделитель — точка с запятой,
   BOM в начале — так файл правильно открывается в Excel. */
const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: (string | number | null | undefined)[][]): string => rows.map(r => r.map(cell).join(';')).join('\r\n');

/** Скачивает текст как файл */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
