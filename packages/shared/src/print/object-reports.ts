/* Печатный отчёт о ходе работ по объекту для заказчика (задача 1277, docs/architecture/construction.md).
   Чистая функция «данные → HTML», по-русски, A4 портрет. Внутренней себестоимости в форме нет: только цена заказчику.
   Это способ отправить отчёт вручную, пока нет почты и SMS (задача 1092). */
import { dateRu, esc, moneyRu, qtyRu } from './templates';
import { moneyPage } from './payments';
import type { PrintOrganization, PrintParty } from './types';

/** Строка выполненных объёмов: позиция согласованной сметы */
export interface ProgressReportLine {
  n: number;
  name: string;
  unitSymbol: string;
  /** Объём по смете */
  qty: string;
  /** Выполнено */
  doneQty: string;
  /** Цена заказчику без НДС */
  price: string;
  /** Выполнено на сумму (выполненный объём × цена) */
  doneAmount: string;
}

/** Веха в отчёте: выполнено, принято и просрочена ли */
export interface ProgressReportMilestone {
  name: string;
  dueDate: string | null;
  doneAt: string | null;
  acceptedAt: string | null;
  overdue: boolean;
  /** Сумма вехи (цена заказчику); пусто — у процента нет стоимости договора */
  value: string | null;
}

/** Акт в отчёте: номер, дата, вид и сумма принятого */
export interface ProgressReportAct {
  number: string;
  date: string;
  /** volumes — по объёмам, milestone — по вехе, hours — по часам */
  kind: string;
  amount: string;
  signed: boolean;
}

export interface ObjectProgressReportData {
  /** Код и наименование объекта */
  objectNumber: string;
  objectName: string;
  objectAddress: string;
  customer: PrintParty;
  /** Подрядчик — наша организация; null — организация не задана (печать без шапки) */
  organization: PrintOrganization | null;
  contractLabel: string;
  periodFrom: string;
  periodTo: string;
  /** Процент выполнения и подпись способа расчёта */
  progressPercent: string | null;
  progressModeLabel: string;
  milestones: ProgressReportMilestone[];
  lines: ProgressReportLine[];
  /** Итоги по смете: план и выполнено (без НДС) */
  planTotal: string;
  doneTotal: string;
  acts: ProgressReportAct[];
  accepted: string;
  invoiced: string;
  paid: string;
  /** Дата формирования отчёта */
  generatedAt: string;
}

const ACT_KIND_RU: Record<string, string> = { volumes: 'по объёмам (КС-2)', milestone: 'по вехе', hours: 'по часам' };

/** Отчёт о ходе работ по объекту для заказчика */
export function renderObjectProgressReport(d: ObjectProgressReportData): string {
  const party = (label: string, value: string) => `<tr><td style="width:170px">${label}</td><td>${value}</td></tr>`;
  const org = d.organization;
  const milestoneRows = d.milestones.length
    ? d.milestones
        .map(
          m =>
            `<tr><td>${esc(m.name)}</td><td class="center">${esc(m.dueDate ? dateRu(m.dueDate) : '—')}</td><td class="center">${esc(m.doneAt ? dateRu(m.doneAt.slice(0, 10)) : '—')}</td><td class="center">${esc(m.acceptedAt ? dateRu(m.acceptedAt.slice(0, 10)) : '—')}</td><td class="center">${m.overdue ? 'просрочена' : m.doneAt ? 'выполнена' : 'в работе'}</td><td class="right">${m.value === null ? '—' : moneyRu(m.value)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="center">Вехи не заданы</td></tr>`;
  const lineRows = d.lines.length
    ? d.lines
        .map(
          l =>
            `<tr><td class="center">${l.n}</td><td>${esc(l.name)}</td><td class="center">${esc(l.unitSymbol)}</td><td class="right">${qtyRu(l.qty)}</td><td class="right">${qtyRu(l.doneQty)}</td><td class="right">${moneyRu(l.price)}</td><td class="right">${moneyRu(l.doneAmount)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="7" class="center">Согласованной сметы нет</td></tr>`;
  const actRows = d.acts.length
    ? d.acts
        .map(
          a =>
            `<tr><td class="center">${esc(a.number || '—')}</td><td class="center">${esc(dateRu(a.date))}</td><td>${esc(ACT_KIND_RU[a.kind] ?? a.kind)}</td><td class="center">${a.signed ? 'подписан' : 'черновик'}</td><td class="right">${moneyRu(a.amount)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="center">Актов нет</td></tr>`;
  const sign = (label: string, name: string) => `<td><b>${label}</b><br><span class="line"></span> / ${esc(name || '________________')} /<br><span class="small">(подпись) (расшифровка подписи)</span></td>`;
  return moneyPage(
    'Отчёт о ходе работ по объекту',
    `<h1 class="center">Отчёт о ходе работ по объекту</h1>
<div class="center small">на ${esc(dateRu(d.generatedAt))}</div>
<table class="plain" style="margin-top:6px">
${party('Заказчик', `${esc(d.customer.fullName || d.customer.name)}${d.customer.inn ? `, ИНН ${esc(d.customer.inn)}` : ''}`)}
${party('Подрядчик', org ? `${esc(org.fullName || org.name)}${org.inn ? `, ИНН ${esc(org.inn)}` : ''}` : '—')}
${party('Объект', `${esc(d.objectName)}${d.objectNumber ? ` (${esc(d.objectNumber)})` : ''}${d.objectAddress ? `, ${esc(d.objectAddress)}` : ''}`)}
${party('Договор (контракт)', d.contractLabel ? esc(d.contractLabel) : '—')}
${party('Отчётный период', `с ${esc(dateRu(d.periodFrom))} по ${esc(dateRu(d.periodTo))}`)}
${party('Выполнение', `${d.progressPercent === null ? 'не определено' : `${esc(d.progressPercent)}%`} <span class="small">(${esc(d.progressModeLabel)})</span>`)}
</table>
<h2 style="margin-top:10px">Вехи</h2>
<table class="grid"><thead><tr><th>Наименование</th><th style="width:80px">Срок</th><th style="width:80px">Выполнено</th><th style="width:80px">Принято</th><th style="width:80px">Состояние</th><th style="width:96px">Сумма, руб.</th></tr></thead>
<tbody>${milestoneRows}</tbody></table>
<h2 style="margin-top:10px">Выполненные объёмы по смете</h2>
<table class="grid"><thead><tr><th style="width:34px">№</th><th>Наименование работ</th><th style="width:44px">Ед.</th><th style="width:72px">Объём</th><th style="width:72px">Выполнено</th><th style="width:92px">Цена, руб.</th><th style="width:104px">Выполнено на сумму, руб.</th></tr></thead>
<tbody>${lineRows}
<tr class="bold"><td colspan="6" class="right">Итого выполнено на сумму, руб.</td><td class="right">${moneyRu(d.doneTotal)}</td></tr>
</tbody></table>
<p class="small">Стоимость по смете без НДС: ${moneyRu(d.planTotal)} руб. Суммы указаны по ценам согласованной сметы, без НДС.</p>
<h2 style="margin-top:10px">Акты и оплаты</h2>
<table class="grid"><thead><tr><th style="width:110px">Номер</th><th style="width:80px">Дата</th><th>Вид</th><th style="width:80px">Статус</th><th style="width:110px">Сумма, руб.</th></tr></thead>
<tbody>${actRows}</tbody></table>
<table class="plain" style="margin-top:6px">
${party('Принято заказчиком', moneyRu(d.accepted))}
${party('Выставлено', moneyRu(d.invoiced))}
${party('Оплачено', moneyRu(d.paid))}
</table>
<table class="sign plain" style="margin-top:22px"><tr>
${sign('Сдал (подрядчик)', org?.directorName ?? '')}
${sign('Принял (заказчик)', '')}
</tr></table>`,
    false,
  );
}
