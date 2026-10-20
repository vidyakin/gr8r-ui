/* Текст из HTML-описания задачи (для подсказок): без тегов, сущности раскодированы, пробелы схлопнуты */
export function htmlToText(html: string): string {
  if (!html) return '';
  // Границы блоков превращаем в пробелы, иначе соседние абзацы слипнутся
  const spaced = html.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre)[^>]*>/gi, ' ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Обрезка до max символов по границе слова с «…» */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}
