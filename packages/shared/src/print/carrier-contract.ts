/* Договор-заявка перевозчику (задача 1223, docs/architecture/transport-orders.md, п. 8 «Экспедирование»): печатная форма,
   которой экспедитор поручает рейс наёмному перевозчику — маршрут, груз, ставка, машина и водитель перевозчика, подписи.
   Простая форма без собственной нумерованной сущности в БД (как «Маршрутный лист», route-sheet.ts): номер — по рейсу. */
import { dateRu, esc, moneyRu } from './templates';

export interface CarrierContractParty {
  name: string;
  inn: string;
  kpp: string;
  address: string;
  phone: string;
}

export interface CarrierContractStop {
  kind: 'load' | 'unload' | 'delivery';
  address: string;
  day: string;
  windowFrom: string | null;
  windowTo: string | null;
  contactName: string;
  contactPhone: string;
}

export interface CarrierContractPrintData {
  tripNumber: string;
  tripDate: string;
  customer: CarrierContractParty;
  carrier: CarrierContractParty;
  stops: CarrierContractStop[];
  cargoName: string;
  weightKg: string;
  volumeM3: string;
  places: number;
  bodyType: string;
  vehiclePlate: string;
  vehicleModel: string;
  driverName: string;
  driverPhone: string;
  driverLicense: string;
  rate: string;
  contractNumber: string;
  contractDate: string | null;
  comment: string;
}

const KIND_RU: Record<CarrierContractStop['kind'], string> = { load: 'Погрузка', unload: 'Выгрузка', delivery: 'Доставка' };

const party = (p: CarrierContractParty): string => [p.name, p.inn && `ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`, p.address, p.phone && `тел.: ${p.phone}`].filter(Boolean).map(esc).join(', ');

const window = (s: CarrierContractStop): string => (s.windowFrom || s.windowTo ? `${s.windowFrom?.slice(0, 5) ?? ''}–${s.windowTo?.slice(0, 5) ?? ''}` : '');

export function renderCarrierContract(d: CarrierContractPrintData): string {
  const title = d.contractNumber ? `Договор-заявка № ${esc(d.contractNumber)}${d.contractDate ? ` от ${dateRu(d.contractDate)}` : ''}` : `Договор-заявка к рейсу ${esc(d.tripNumber)} от ${dateRu(d.tripDate)}`;
  const rows = d.stops
    .map(
      (s, n) =>
        `<tr><td class="center">${n + 1}</td><td>${esc(KIND_RU[s.kind])}</td><td class="nowrap">${dateRu(s.day)}</td><td class="nowrap">${esc(window(s))}</td><td>${esc(s.address)}</td><td>${esc(s.contactName)}<br>${esc(s.contactPhone)}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4 portrait;margin:12mm 10mm}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:11px/1.4 "Liberation Sans",Arial,Helvetica,sans-serif}
h1{font-size:15px;margin:0 0 10px;text-align:center}
h2{font-size:12px;margin:14px 0 4px}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
table.grid td,table.grid th{border:1px solid #000;padding:3px 4px}
table.grid th{text-align:center;background:#f2f2f2}
table.grid tr{break-inside:avoid}
table.plain td{padding:2px 0}
.right{text-align:right}.center{text-align:center}.nowrap{white-space:nowrap}.bold{font-weight:700}
.party{margin:3px 0}
.party b{display:inline-block;min-width:150px}
.sign{margin-top:26px;break-inside:avoid}
.sign td{padding:4px 6px;vertical-align:bottom}
.line{display:inline-block;border-bottom:1px solid #000;min-width:170px;height:26px}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:12mm 10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet">
<h1>${esc(title)}</h1>
<table class="plain">
<tr><td class="party"><b>Экспедитор (заказчик)</b> ${party(d.customer)}</td></tr>
<tr><td class="party"><b>Перевозчик (исполнитель)</b> ${party(d.carrier)}</td></tr>
</table>

<h2>Маршрут</h2>
<table class="grid"><thead><tr><th style="width:24px">№</th><th style="width:80px">Операция</th><th style="width:70px">Дата</th><th style="width:70px">Окно</th><th>Адрес</th><th style="width:150px">Контакт</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="center">Точки не заданы</td></tr>'}</tbody></table>

<h2>Груз</h2>
<table class="plain">
<tr><td class="party"><b>Наименование</b> ${esc(d.cargoName) || '—'}</td></tr>
<tr><td class="party"><b>Вес, кг</b> ${moneyRu(d.weightKg)}</td></tr>
<tr><td class="party"><b>Объём, м³</b> ${moneyRu(d.volumeM3)}</td></tr>
<tr><td class="party"><b>Количество мест</b> ${esc(d.places)}</td></tr>
<tr><td class="party"><b>Тип кузова</b> ${esc(d.bodyType) || '—'}</td></tr>
</table>

<h2>Транспортное средство и водитель</h2>
<table class="plain">
<tr><td class="party"><b>Госномер</b> ${esc(d.vehiclePlate) || '—'}</td></tr>
<tr><td class="party"><b>Марка/модель</b> ${esc(d.vehicleModel) || '—'}</td></tr>
<tr><td class="party"><b>Водитель</b> ${esc(d.driverName) || '—'}</td></tr>
<tr><td class="party"><b>Телефон водителя</b> ${esc(d.driverPhone) || '—'}</td></tr>
<tr><td class="party"><b>Удостоверение</b> ${esc(d.driverLicense) || '—'}</td></tr>
</table>

<h2>Ставка</h2>
<table class="plain">
<tr><td class="party"><b>Ставка перевозчику</b> ${moneyRu(d.rate)} руб.</td></tr>
${d.comment ? `<tr><td class="party"><b>Комментарий</b> ${esc(d.comment)}</td></tr>` : ''}
</table>

<table class="sign"><tr>
<td>Экспедитор <span class="line"></span></td>
<td>Перевозчик <span class="line"></span></td>
</tr></table>
</div></body></html>`;
}
