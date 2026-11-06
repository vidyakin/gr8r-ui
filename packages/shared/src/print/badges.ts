/* Печатная страница бейджей работников (задача 1271, docs/architecture/construction.md): имя, табельный номер
   и QR-код участника. По-русски, без перевода. Бейдж идентифицирует работника, но не даёт доступа к приложению
   и не содержит ставки. QR рисуется встроенным SVG (`qrSvg`) — страница не ходит в сеть. */
import { qrSvg } from '../qr';
import { BASE_CSS, esc } from './templates';

export interface BadgePrintItem {
  name: string;
  /** Табельный номер */
  personnelNumber: string | null;
  /** Код бейджа (он же содержимое QR) */
  badgeCode: string;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 portrait;margin:10mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.2)}}
.badges{display:flex;flex-wrap:wrap;gap:8mm}
.badge{width:85mm;height:54mm;border:1px solid #bbb;border-radius:3mm;padding:4mm;display:flex;gap:4mm;align-items:center;page-break-inside:avoid}
.badge .qr{width:36mm;height:36mm;flex:0 0 36mm}
.badge .name{font-size:14pt;font-weight:700;line-height:1.15}
.badge .num{font-size:11pt;color:#333;margin-top:2mm}
.badge .code{font-family:monospace;font-size:8pt;color:#666;margin-top:2mm;letter-spacing:.5px}
</style></head>
<body><div class="sheet">${body}</div></body></html>`;

export function renderBadges(badges: BadgePrintItem[]): string {
  const body = badges.length
    ? `<div class="badges">${badges
        .map(
          b => `<div class="badge">
  <div class="qr">${qrSvg(b.badgeCode)}</div>
  <div><div class="name">${esc(b.name)}</div>
  <div class="num">Таб. № ${esc(b.personnelNumber ?? '—')}</div>
  <div class="code">${esc(b.badgeCode)}</div></div>
</div>`,
        )
        .join('')}</div>`
    : '<p>Нет работников с выпущенными бейджами.</p>';
  return page('Бейджи работников', body);
}
