/* Печатная форма «Транспортная накладная» (задача 1214, постановление Правительства РФ № 2200, docs/architecture/trips.md).
   Разделы: 1 грузоотправитель, 2 грузополучатель, 3 груз, 4 сопроводительные документы, 5 указания грузоотправителя, 6 приём груза,
   7 сдача груза, 8 условия перевозки, 9 принятие заказа, 10 перевозчик, 11 транспортное средство, 12 оговорки и замечания перевозчика,
   13 переадресовка, 14 стоимость услуг перевозки. Раскладка не сверена с образцом из приложения к постановлению.
   Чистая функция «данные → HTML»; чего нет в данных — пустое поле для заполнения от руки. */
import { dateRu, esc, moneyRu } from './templates';

export interface TnParty {
  name: string;
  inn: string;
  kpp: string;
  address: string;
  phone: string;
  /** Контактное лицо (получатель) */
  contact: string;
}

export interface TnCargoRow {
  name: string;
  /** Количество грузовых мест (для штучного груза — количество) */
  places: string;
  /** Вес брутто, кг */
  weightKg: string;
  /** Объём, м3 */
  volumeM3: string;
  /** Получатель и адрес выгрузки — для накладной по рейсу с несколькими получателями */
  consignee: string;
}

export interface TransportWaybillPrintData {
  number: string;
  /** Дата составления YYYY-MM-DD */
  date: string;
  consignor: TnParty;
  /** Склад погрузки: название и адрес */
  loadingPlace: string;
  /** Один получатель; при нескольких — null и колонка «Получатель» в таблице груза */
  consignee: TnParty | null;
  unloadingPlace: string;
  cargo: TnCargoRow[];
  totals: { places: string; weightKg: string; volumeM3: string };
  /** Сопроводительные документы, по строке на документ */
  documents: string[];
  loadingDate: string;
  carrier: TnParty;
  vehicle: { plate: string; model: string; capacityKg: string };
  drivers: { name: string; licenseNumber: string }[];
  /** Стоимость услуг перевозки, пусто — не рассчитана */
  price: string;
  /** Номер рейса или доставки — справочно под заголовком */
  reference: string;
  /** Статус электронной накладной (ЭТрН) */
  etrnStatus: 'none' | 'draft' | 'sent' | 'signed' | 'rejected';
}

const ETRN_RU: Record<TransportWaybillPrintData['etrnStatus'], string> = { none: 'не оформлена', draft: 'черновик', sent: 'отправлена', signed: 'подписана', rejected: 'отклонена' };

const blank = (w = 180) => `<span class="line" style="min-width:${w}px"></span>`;
const val = (s: string, w = 180) => (s ? esc(s) : blank(w));

function party(p: TnParty | null, empty = 'см. таблицу груза'): string {
  if (!p) return `<div>${esc(empty)}</div>`;
  const reqs = [p.inn && `ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`].filter(Boolean).join(', ');
  return `<div class="bold">${val(p.name, 260)}</div><div>${reqs ? esc(reqs) : 'ИНН ' + blank(110)}</div><div>Адрес: ${val(p.address, 260)}</div><div>Телефон: ${val(p.phone, 120)}${p.contact ? `; контактное лицо: ${esc(p.contact)}` : ''}</div>`;
}

const sec = (n: number, title: string, body: string) => `<div class="sec"><div class="st">${n}. ${esc(title)}</div><div class="sb">${body}</div></div>`;

export function renderTransportWaybill(d: TransportWaybillPrintData): string {
  const multi = d.consignee === null;
  const rows = d.cargo
    .map(
      (r, i) =>
        `<tr><td class="center">${i + 1}</td><td>${esc(r.name)}</td>${multi ? `<td>${esc(r.consignee)}</td>` : ''}<td class="right">${esc(r.places)}</td><td class="right">${esc(r.weightKg)}</td><td class="right">${esc(r.volumeM3)}</td></tr>`,
    )
    .join('');
  const empty = d.cargo.length ? '' : `<tr><td class="center">1</td><td>&nbsp;</td>${multi ? '<td></td>' : ''}<td></td><td></td><td></td></tr>`;
  const cols = multi ? 6 : 5;
  const drivers = d.drivers.length ? d.drivers.map(x => `${esc(x.name)}${x.licenseNumber ? `, в/у ${esc(x.licenseNumber)}` : ''}`).join('; ') : blank(260);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Транспортная накладная ${esc(d.number)}</title>
<style>
@page{size:A4 portrait;margin:10mm 10mm}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:11px/1.4 "Liberation Sans",Arial,Helvetica,sans-serif}
h1{font-size:15px;margin:0 0 2px;text-align:center}
.sub{text-align:center;margin-bottom:8px}
.small{font-size:9px;color:#444}
table{border-collapse:collapse;width:100%}
table.grid td,table.grid th{border:1px solid #000;padding:3px 4px;vertical-align:top}
table.grid th{text-align:center;background:#f2f2f2}
table.grid tr{break-inside:avoid}
.right{text-align:right}.center{text-align:center}.bold{font-weight:700}
.sec{border:1px solid #000;margin-top:-1px;break-inside:avoid}
.st{background:#f2f2f2;font-weight:700;padding:2px 5px;border-bottom:1px solid #000}
.sb{padding:4px 5px;min-height:22px}
.line{display:inline-block;border-bottom:1px solid #000;min-width:160px;height:14px;vertical-align:bottom}
.sig{display:flex;gap:24px;margin-top:10px}.sig>div{flex:1}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet">
<h1>ТРАНСПОРТНАЯ НАКЛАДНАЯ № ${esc(d.number)}</h1>
<div class="sub">от ${esc(dateRu(d.date))}${d.reference ? ` (${esc(d.reference)})` : ''}<br><span class="small">Форма по постановлению Правительства РФ от 15.04.2011 № 272 в ред. постановления № 2200. Электронная транспортная накладная (ЭТрН): ${esc(ETRN_RU[d.etrnStatus])}</span></div>
${sec(1, 'Грузоотправитель', `${party(d.consignor)}<div>Адрес погрузки: ${val(d.loadingPlace, 260)}</div>`)}
${sec(2, 'Грузополучатель', `${party(d.consignee)}<div>Адрес выгрузки: ${multi ? 'по точкам, см. таблицу груза' : val(d.unloadingPlace, 260)}</div>`)}
${sec(
  3,
  'Груз',
  `<table class="grid"><thead><tr><th style="width:26px">№</th><th>Наименование груза</th>${multi ? '<th style="width:170px">Получатель, адрес</th>' : ''}<th style="width:70px">Мест</th><th style="width:80px">Вес брутто, кг</th><th style="width:70px">Объём, м³</th></tr></thead><tbody>${rows}${empty}<tr class="bold"><td colspan="${cols - 3}" class="right">Итого</td><td class="right">${esc(d.totals.places)}</td><td class="right">${esc(d.totals.weightKg)}</td><td class="right">${esc(d.totals.volumeM3)}</td></tr></tbody></table><div class="small">Упаковка, опасный груз (класс, номер ООН), объявленная стоимость — заполняются от руки при необходимости.</div>`,
)}
${sec(4, 'Сопроводительные документы на груз', d.documents.length ? d.documents.map(x => `<div>${esc(x)}</div>`).join('') : blank(300))}
${sec(5, 'Указания грузоотправителя по особым условиям перевозки', blank(380))}
${sec(6, 'Приём груза', `Дата и время погрузки: ${d.loadingDate ? esc(dateRu(d.loadingDate)) + ' ' : ''}${blank(120)}<br>Масса груза: ${esc(d.totals.weightKg || '')} ${blank(60)} кг; количество мест: ${esc(d.totals.places || '')} ${blank(60)}<br>Грузоотправитель (представитель) ${blank(120)} / ${blank(120)} /`)}
${sec(7, 'Сдача груза', `Дата и время выгрузки: ${blank(160)}<br>Масса груза: ${blank(80)} кг; количество мест: ${blank(80)}<br>Грузополучатель (представитель) ${blank(120)} / ${blank(120)} /`)}
${sec(8, 'Условия перевозки', `Сроки доставки, температурный режим, особые условия: ${blank(260)}`)}
${sec(9, 'Информация о принятии заказа (заявки) к исполнению', `Заказ (заявка) №: ${d.reference ? esc(d.reference) : blank(100)}; принят к исполнению: ${blank(120)}`)}
${sec(10, 'Перевозчик', party(d.carrier))}
${sec(11, 'Транспортное средство', `Государственный регистрационный знак: <b>${val(d.vehicle.plate, 110)}</b>; марка, модель: ${val(d.vehicle.model, 140)}; грузоподъёмность: ${d.vehicle.capacityKg ? esc(d.vehicle.capacityKg) + ' кг' : blank(70)}<br>Водитель(и): ${drivers}`)}
${sec(12, 'Оговорки и замечания перевозчика', blank(380))}
${sec(13, 'Переадресовка', `Новый грузополучатель и адрес: ${blank(300)}`)}
${sec(14, 'Стоимость услуг перевозки (расчёт платы)', d.price ? `<b>${moneyRu(d.price)}</b> руб.` : blank(160))}
<div class="sig"><div>Грузоотправитель<br><br>${blank(150)}<div class="small">подпись, расшифровка, печать</div></div><div>Перевозчик (водитель)<br><br>${blank(150)}<div class="small">подпись, расшифровка</div></div><div>Грузополучатель<br><br>${blank(150)}<div class="small">подпись, расшифровка, печать</div></div></div>
</div></body></html>`;
}
