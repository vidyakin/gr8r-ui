/* Окно печати открывается из HTML, скачанного с API: blob: или document.write. Такое окно живёт на origin приложения,
   а заголовок CSP ответа теряется — поэтому тот же запрет вставляется в саму страницу тегом <meta>. Скрипты в печатной
   форме не нужны: если в шаблоне забудут экранировать данные, вставленный скрипт не выполнится. */
export const PRINT_CSP = "default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; font-src data:";

const META = `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`;

/** HTML печатной формы с запретом скриптов: <meta> — первым тегом <head>, чтобы действовать до любого содержимого */
export function withPrintCsp(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + META + html.slice(head.index + head[0].length);
  return `<!doctype html><html><head>${META}</head><body>${html}</body></html>`;
}
