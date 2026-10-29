/* Печатная форма «Путевой лист» (приказ Минтранса № 390 от 28.09.2022): реквизиты, показания одометра, топливо,
   отметки медицинского осмотра и технического контроля, подписи. Чистая функция «данные → HTML». */
import { dateRu, esc } from './templates';

export interface WaybillPrintData {
  number: string;
  /** Дата листа YYYY-MM-DD */
  date: string;
  organization: string;
  organizationAddress: string;
  vehicle: { plate: string; model: string; kind: string };
  driver: { name: string; licenseNumber: string };
  route: string;
  departureAt: string;
  returnAt: string;
  odometerOut: string;
  odometerBack: string;
  distanceKm: string;
  fuelType: string;
  fuelOut: string;
  fuelFilled: string;
  fuelBack: string;
  normPer100: string;
  normLiters: string;
  actualLiters: string;
  medical: { ok: boolean; time: string; by: string };
  tech: { ok: boolean; time: string; by: string };
  comment: string;
}

const mark = (m: { ok: boolean; time: string; by: string }, label: string) =>
  `<tr><td>${label}</td><td>${m.ok ? 'Пройден, допущен' : '&nbsp;'}</td><td class="nowrap">${esc(m.time)}</td><td>${esc(m.by)}</td><td style="width:110px"></td></tr>`;

export function renderWaybill(d: WaybillPrintData): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Путевой лист ${esc(d.number)}</title>
<style>
@page{size:A4 portrait;margin:10mm 10mm}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:11px/1.4 "Liberation Sans",Arial,Helvetica,sans-serif}
h1{font-size:15px;margin:0 0 2px;text-align:center}
.sub{text-align:center;margin-bottom:8px}
table{border-collapse:collapse;width:100%;margin-bottom:8px}
td,th{vertical-align:top}
table.grid td,table.grid th{border:1px solid #000;padding:3px 5px}
table.grid th{text-align:center;background:#f2f2f2}
table.grid tr{break-inside:avoid}
.kv td:first-child{width:200px;color:#333}
.center{text-align:center}.nowrap{white-space:nowrap}
.sign{margin-top:16px;break-inside:avoid}.sign td{padding:4px 6px;vertical-align:bottom}
.line{display:inline-block;border-bottom:1px solid #000;min-width:150px;height:20px}
@media screen{body{background:#e9e9ec}.sheet{background:#fff;margin:12px auto;padding:10mm;width:210mm;min-height:297mm;box-shadow:0 1px 6px rgba(0,0,0,.25)}}
</style></head>
<body><div class="sheet">
<h1>ПУТЕВОЙ ЛИСТ № ${esc(d.number)}</h1>
<div class="sub">от ${esc(dateRu(d.date))}</div>
<table class="kv grid">
<tr><td>Организация</td><td>${esc(d.organization)}${d.organizationAddress ? `, ${esc(d.organizationAddress)}` : ''}</td></tr>
<tr><td>Транспортное средство</td><td>${esc(d.vehicle.model)} (${esc(d.vehicle.kind)}), гос. номер <b>${esc(d.vehicle.plate)}</b></td></tr>
<tr><td>Водитель</td><td>${esc(d.driver.name)}${d.driver.licenseNumber ? `, водительское удостоверение ${esc(d.driver.licenseNumber)}` : ''}</td></tr>
<tr><td>Маршрут, задание</td><td>${esc(d.route)}</td></tr>
<tr><td>Время выезда / возвращения</td><td>${esc(d.departureAt)} / ${esc(d.returnAt)}</td></tr>
</table>
<table class="grid"><thead><tr><th colspan="3">Показания одометра, км</th><th colspan="5">Топливо (${esc(d.fuelType)}), л</th></tr>
<tr><th>при выезде</th><th>при возвращении</th><th>пробег</th><th>при выезде</th><th>заправлено</th><th>при возвращении</th><th>по норме</th><th>фактически</th></tr></thead>
<tbody><tr class="center"><td>${esc(d.odometerOut)}</td><td>${esc(d.odometerBack)}</td><td>${esc(d.distanceKm)}</td><td>${esc(d.fuelOut)}</td><td>${esc(d.fuelFilled)}</td><td>${esc(d.fuelBack)}</td><td>${esc(d.normLiters)}</td><td>${esc(d.actualLiters)}</td></tr></tbody></table>
<p>Норма расхода: ${esc(d.normPer100)} л на 100 км.</p>
<table class="grid"><thead><tr><th style="width:190px">Отметка</th><th>Результат</th><th style="width:70px">Время</th><th>Должностное лицо</th><th>Подпись</th></tr></thead><tbody>
${mark(d.medical, 'Предрейсовый медицинский осмотр')}
${mark(d.tech, 'Предрейсовый технический контроль')}
</tbody></table>
${d.comment ? `<p>Примечание: ${esc(d.comment)}</p>` : ''}
<table class="sign"><tr><td>Водитель <span class="line"></span> / ${esc(d.driver.name)} /</td><td>Автомобиль принял при возвращении <span class="line"></span></td></tr>
<tr><td>Выпуск на линию разрешил <span class="line"></span></td><td>Диспетчер <span class="line"></span></td></tr></table>
</div></body></html>`;
}
