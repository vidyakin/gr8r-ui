/* Текст из HTML-описания задачи (для подсказок): без тегов, сущности раскодированы.
   Абзацы и пункты списка — с новой строки (пункты с «•»), пробелы внутри строк схлопнуты. */
export function htmlToText(html: string): string {
  if (!html) return '';
  const marked = html
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre|\/ul|\/ol)[^>]*>/gi, '\n');
  const doc = new DOMParser().parseFromString(marked, 'text/html');
  return (doc.body.textContent ?? '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Обрезка до max символов по границе слова с «…» */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}
