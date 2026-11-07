/* Очистка HTML описаний (задачи): в базу попадает только то, что умеет панель форматирования интерфейса —
   жирный и курсив, списки, заголовок, абзацы, переносы и ссылки http(s)/mailto. Скрипты, обработчики событий,
   стили, iframe и картинки вырезаются. Описание вставляется в интерфейс как HTML, поэтому очистка на записи —
   первый пояс защиты от хранимого XSS; второй — DOMPurify перед вставкой (apps/web, task-drawer/pickers.tsx). */
import sanitizeHtml from 'sanitize-html';

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'h4', 'p', 'div', 'br', 'a', 'blockquote', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // ссылка из описания открывается в новой вкладке и не получает доступа к окну приложения
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  disallowedTagsMode: 'discard',
};

/** Безопасный HTML описания: лишние теги и атрибуты отбрасываются, текст сохраняется */
export function sanitizeRichText(html: string): string {
  return html ? sanitizeHtml(html, OPTIONS) : html;
}
