/* Лист согласования (задача 1199, docs/architecture/approvals.md): этапы маршрута, кто и когда решил, комментарии.
   Чистая функция «данные → HTML», по-русски, A4 портрет. Время выводится в часовом поясе арендатора (по умолчанию Москва). */
import { BASE_CSS, esc } from './templates';

export interface ApprovalSheetTask {
  memberName: string;
  /** Должность, если задача выдана держателям должности */
  positionName: string | null;
  state: 'waiting' | 'pending' | 'done' | 'skipped';
  decision: 'approve' | 'reject' | 'comment' | null;
  comment: string;
  /** Комментарии без решения */
  notes: { text: string; at: string }[];
  decidedAt: string | null;
  dueAt: string | null;
}

export interface ApprovalSheetStep {
  name: string;
  mode: 'sequential' | 'parallel';
  tasks: ApprovalSheetTask[];
}

export interface ApprovalSheetData {
  /** «Реализация РТ-2026-00001», «Договор Д-15» */
  objectLabel: string;
  routeName: string;
  round: number;
  state: 'in_progress' | 'approved' | 'rejected' | 'cancelled';
  authorName: string | null;
  startedAt: string;
  finishedAt: string | null;
  cancelReason: string | null;
  /** Название организации-владельца листа (необязательно) */
  organizationName?: string;
  steps: ApprovalSheetStep[];
}

const STATE_RU: Record<ApprovalSheetData['state'], string> = { in_progress: 'на согласовании', approved: 'согласовано', rejected: 'отклонено', cancelled: 'отозвано' };
const MODE_RU: Record<ApprovalSheetStep['mode'], string> = { sequential: 'по очереди', parallel: 'одновременно' };

/** «2026-11-16T09:05:00Z» → «16.11.2026 12:05» в заданном часовом поясе */
export function approvalTimeRu(iso: string | null, timeZone = 'Europe/Moscow'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat('ru-RU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

function resultOf(t: ApprovalSheetTask, tz: string): string {
  if (t.state === 'done') return `${t.decision === 'reject' ? 'Отклонил' : 'Согласовал'}${t.decidedAt ? `, ${esc(approvalTimeRu(t.decidedAt, tz))}` : ''}`;
  if (t.state === 'skipped') return 'Не требуется';
  if (t.state === 'pending') return `Ожидает решения${t.dueAt ? `, срок ${esc(approvalTimeRu(t.dueAt, tz))}` : ''}`;
  return 'Ожидает очереди';
}

export function renderApprovalSheet(d: ApprovalSheetData, timeZone = 'Europe/Moscow'): string {
  const rows = d.steps
    .map((s, i) => {
      const head = `<tr class="grp"><td colspan="3" class="bold">Этап ${i + 1}${s.name ? `. ${esc(s.name)}` : ''} <span class="small">(${MODE_RU[s.mode]})</span></td></tr>`;
      const body = s.tasks
        .map(t => {
          const notes = t.notes.map(n => `<div class="small">${esc(approvalTimeRu(n.at, timeZone))}: ${esc(n.text)}</div>`).join('');
          return `<tr><td>${esc(t.memberName)}${t.positionName ? `<div class="small">${esc(t.positionName)}</div>` : ''}</td><td>${resultOf(t, timeZone)}</td><td>${esc(t.comment)}${notes}</td></tr>`;
        })
        .join('');
      return head + (body || '<tr><td colspan="3" class="small">Нет согласующих</td></tr>');
    })
    .join('');
  const title = `Лист согласования: ${d.objectLabel}`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 portrait;margin:12mm}
${BASE_CSS}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.2)}}
table.appr{width:100%;border-collapse:collapse;margin-top:6mm}
table.appr th,table.appr td{border:1px solid #333;padding:2mm 3mm;vertical-align:top;text-align:left}
table.appr tr.grp td{background:#f1f1f1}
</style></head>
<body><div class="sheet">
${d.organizationName ? `<div class="small">${esc(d.organizationName)}</div>` : ''}
<h1>${esc(title)}</h1>
<div>Маршрут: <b>${esc(d.routeName)}</b>, круг ${d.round}. Итог: <b>${STATE_RU[d.state]}</b>${d.cancelReason ? ` (${esc(d.cancelReason)})` : ''}</div>
<div>Отправил${d.authorName ? `: ${esc(d.authorName)}` : ''}, ${esc(approvalTimeRu(d.startedAt, timeZone))}${d.finishedAt ? `. Завершено: ${esc(approvalTimeRu(d.finishedAt, timeZone))}` : ''}</div>
<table class="appr"><thead><tr><th style="width:32%">Согласующий</th><th style="width:30%">Решение</th><th>Комментарий</th></tr></thead><tbody>${rows}</tbody></table>
</div></body></html>`;
}
