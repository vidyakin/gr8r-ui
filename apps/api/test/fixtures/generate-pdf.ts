/* Генерация PDF-фикстур для тестов импорта сметы (запустить: bun run apps/api/test/fixtures/generate-pdf.ts).
   estimate-spec.pdf — трёхстраничная «спецификация оборудования»: титул без таблиц, две страницы таблиц
   (автокадный стиль: штамп, разделы, строка «Итого», числа с пробелами и запятой). scanned.pdf — та же таблица,
   нарисованная на canvas (без текстового слоя) — для проверки отказа 422 import_pdf_scanned.
   Chromium ищется как в воркере (CHROMIUM_PATH / кэш playwright, linux и mac). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(process.env.HOME ?? '/root', '.cache/ms-playwright'), join(process.env.HOME ?? '/root', 'Library/Caches/ms-playwright')].filter(Boolean) as string[];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter(d => /^chromium(-\d+)?$/.test(d)).sort().reverse()) {
      for (const exe of [
        join(root, dir, 'chrome-linux', 'chrome'),
        join(root, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        join(root, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      ]) {
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Arial, sans-serif; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 3px 5px; text-align: left; }
  .stamp { font-size: 8pt; color: #333; margin-top: 12px; }
  .break { page-break-after: always; }
</style></head><body>${body}</body></html>`;

/* Три страницы: титул (текст без таблиц) → спецификация щитов → заземление + кабели с «Итого» */
const spec = html(`
  <h2>СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ, ИЗДЕЛИЙ И МАТЕРИАЛОВ</h2>
  <p>Система внутреннего электроснабжения. Шифр П-13-0325-12-ЭМ.</p>
  <p>Здание апарт-отеля, Карачаево-Черкесская республика, р-н Зеленчукский.</p>
  <div class="break"></div>
  <h3>ЭЛЕКТРОЩИТОВОЕ ОБОРУДОВАНИЕ</h3>
  <table>
    <tr><th>Позиция</th><th>Наименование и техническая характеристика</th><th>Тип, марка</th><th>Завод</th><th>Ед.</th><th>Кол.</th></tr>
    <tr><td>1</td><td>Вводно-распределительное устройство индивидуального изготовления</td><td>ВРУ-1</td><td>ИЭК</td><td>шт</td><td>1</td></tr>
    <tr><td>2</td><td>Щит металлический модульный IP31</td><td>ЩГ</td><td>ИЭК</td><td>шт</td><td>207</td></tr>
    <tr><td>3</td><td>Щит учетно-распределительный этажный на 17 номеров</td><td>ЩР1</td><td>ИЭК</td><td>шт</td><td>1</td></tr>
  </table>
  <div class="stamp">Изм. Лист № докум. Подп. Дата — П-13-0325-12-ЭМ.СО Лист 2</div>
  <div class="break"></div>
  <h3>Молниезащита, заземление и уравнивание потенциалов</h3>
  <table>
    <tr><th>Позиция</th><th>Наименование и техническая характеристика</th><th>Тип, марка</th><th>Завод</th><th>Ед.</th><th>Кол.</th></tr>
    <tr><td>4</td><td>Стержень заземления 16х1500мм оцинкованная сталь</td><td>ZST10-11-016-001</td><td>ИЭК</td><td>шт</td><td>26</td></tr>
    <tr><td>5</td><td>Полоса 40х4мм оцинкованная сталь</td><td>ZPS10-11-040-042</td><td>ИЭК</td><td>м</td><td>1 145</td></tr>
  </table>
  <h3>Провода и кабели</h3>
  <table>
    <tr><th>Позиция</th><th>Наименование</th><th>Ед.</th><th>Кол.</th><th>Цена, руб</th><th>Сумма, руб</th></tr>
    <tr><td>6</td><td>Кабель ВВГнг(А)-FRLS 3х2,5</td><td>м</td><td>2 050</td><td>120,50</td><td>247 025,00</td></tr>
    <tr><td></td><td>Итого по разделу</td><td></td><td></td><td></td><td>247 025,00</td></tr>
  </table>
  <div class="stamp">Изм. Лист № докум. Подп. Дата — П-13-0325-12-ЭМ.СО Лист 3</div>
`);

/** Таблица картинкой (canvas) — PDF без текстового слоя */
const scanned = html(`
  <canvas id="c" width="1600" height="900"></canvas>
  <script>
    const ctx = document.getElementById('c').getContext('2d');
    ctx.font = '28px Arial';
    const rows = [['Позиция', 'Наименование', 'Ед.', 'Кол.'], ['1', 'Щит ЩГ', 'шт', '207'], ['2', 'Кабель ВВГнг 3х2,5', 'м', '120']];
    rows.forEach((r, i) => r.forEach((c, j) => ctx.fillText(c, 40 + j * 380, 120 + i * 140)));
  </script>
`);

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--disable-gpu'] });
try {
  const p1 = await browser.newPage();
  await p1.setContent(spec);
  await Bun.write(join(import.meta.dir, 'estimate-spec.pdf'), await p1.pdf({ format: 'A4' }));
  await p1.close();

  const p2 = await browser.newPage();
  await p2.setContent(scanned);
  await p2.waitForTimeout(300); // canvas должен отрисоваться до печати
  await Bun.write(join(import.meta.dir, 'scanned.pdf'), await p2.pdf({ format: 'A4' }));
  await p2.close();
  console.log('fixtures written');
} finally {
  await browser.close();
}
