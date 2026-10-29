/* Браузерный сценарий этапа 5 (playwright-core + Chromium): вход → новый заказ покупателя с двумя строками → провести → счёт на основании →
   печать (предпросмотр) → реализация на основании → провести → остаток уменьшился → отмена проведения вернула остаток.
   Запуск: WEB=http://127.0.0.1:4342 SHOTS=/путь/для/скриншотов bun scripts/e2e-docs.mjs  (api, воркер и web запущены, БД с сидом) */
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://127.0.0.1:4342';
const SHOTS = process.env.SHOTS ?? '.';
const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

process.on('unhandledRejection', e => {
  console.log('FAILED:', String(e).slice(0, 300));
  process.exit(1);
});
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) process.exitCode = 1;
};

// 1. вход
await page.goto(`${WEB}/#/signin`);
await page.fill('#l-email', 'demo@gr8r.dev');
await page.fill('#l-pw', 'demo1234');
await page.click('#login-btn');
await page.waitForSelector('.topbar');
const ws = await page.evaluate(async () => {
  const r = await (await fetch('/api/workspaces', { credentials: 'include' })).json();
  return (r.items ?? r).find(w => w.name === 'FutureERP').id;
});
const api = path => page.evaluate(async ([w, p]) => (await fetch('/api' + p, { credentials: 'include', headers: { 'X-Workspace-Id': w } })).json(), [ws, path]);
const screwBalance = async () => {
  const p = (await api('/products?q=HW-SCR-440')).items[0];
  const b = (await api(`/stock/balances?productId=${p.id}`)).items[0];
  return { qty: Number(b.qty), reserved: Number(b.reserved) };
};
const posted = () => page.waitForFunction(() => /-\d{4}-\d{5}/.test(document.querySelector('h1')?.innerText ?? '') && /Posted/.test(document.querySelector('h1')?.innerText ?? ''), null, { timeout: 10000 });
const before = await screwBalance();
console.log('screw stock before', before);

// 2. новый заказ покупателя
await page.goto(`${WEB}/#/sales`);
await page.getByRole('button', { name: 'New document' }).click();
await page.getByRole('menuitem', { name: 'Customer order' }).click();
await page.waitForURL(/#\/documents\//);
await page.waitForSelector('table[aria-label="Document lines"]');
ok((await page.locator('h1').first().innerText()).includes('Customer order'), 'order form opened as a draft');

const cp = page.locator('.doc-head .combo input').first();
await cp.fill('Quanta');
await page.waitForSelector('[role=option]');
await page.keyboard.press('Enter');
ok((await cp.inputValue()).includes('Quanta'), 'customer chosen by search');

await page.getByRole('button', { name: 'Add line' }).click();
const pick = async (row, text) => {
  const cell = page.locator(`[data-cell="${row}:0"]`);
  await cell.fill(text);
  await page.waitForSelector('[role=option]');
  await page.keyboard.press('Enter');
};
await pick(0, 'Саморез');
await page.locator('[data-cell="0:1"]').fill('10');
await page.keyboard.press('Enter'); // последняя строка → новая строка, фокус в товаре
await pick(1, 'Болт мебельный');
await page.locator('[data-cell="1:1"]').fill('5');
ok((await page.locator('table[aria-label="Document lines"] tbody tr').count()) === 2, 'two lines in the table');
const totalText = await page.locator('[data-testid="total-sum"]').innerText();
console.log('order total:', totalText);
// 10 × 4 + 5 × 18 = 130 (НДС в том числе)
ok(totalText.startsWith('130.00'), 'total is 10×4 + 5×18 = 130.00 (VAT included)');
await page.screenshot({ path: `${SHOTS}/1-document-form.png` });

// 3. провести заказ
await page.getByRole('button', { name: 'Post', exact: true }).click();
await posted();
const orderNumber = (await page.locator('h1').first().innerText()).match(/ЗК-\d{4}-\d{5}/)?.[0];
ok(!!orderNumber, `order posted and numbered: ${orderNumber}`);
const afterOrder = await screwBalance();
ok(afterOrder.reserved === before.reserved + 10, `order reserved 10 screws (reserved ${before.reserved} → ${afterOrder.reserved})`);

// 4. счёт на основании
await page.getByRole('button', { name: /Create based on/ }).click();
await page.getByRole('menuitem', { name: 'Invoice' }).click();
await page.waitForFunction(() => document.querySelector('h1')?.innerText.includes('Invoice'));
ok((await page.locator('table[aria-label="Document lines"] tbody tr').count()) === 2, 'invoice copied both lines');
ok((await page.locator('[data-testid="total-sum"]').innerText()).startsWith('130.00'), 'invoice total matches');

// 5. печать (предпросмотр) счёта
await page.getByRole('button', { name: /^Print/ }).click();
await page.getByRole('menuitem', { name: 'Invoice for payment' }).click();
await page.waitForSelector('iframe.print-frame');
const invFrame = page.frameLocator('iframe.print-frame');
await invFrame.locator('h1').waitFor();
ok((await invFrame.locator('h1').innerText()).includes('Счёт на оплату'), 'print preview shows the invoice form');
ok((await invFrame.locator('body').innerText()).includes('Сто тридцать рублей 00 копеек'), 'amount in words on the invoice');
await page.screenshot({ path: `${SHOTS}/2a-invoice-print.png` });
await page.goBack();
await page.waitForSelector('table[aria-label="Document lines"]');

// провести счёт (основание реализации должно быть проведено) и создать реализацию на основании
await page.getByRole('button', { name: 'Post', exact: true }).click();
await posted();
await page.getByRole('button', { name: /Create based on/ }).click();
await page.getByRole('menuitem', { name: /Shipment/ }).click();
await page.waitForFunction(() => document.querySelector('h1')?.innerText.includes('Shipment'));
ok((await page.locator('table[aria-label="Document lines"] tbody tr').count()) === 2, 'shipment copied both lines');

// 6. провести реализацию — остаток уменьшился
await page.getByRole('button', { name: 'Post', exact: true }).click();
await posted();
const shipNumber = (await page.locator('h1').first().innerText()).match(/РТ-\d{4}-\d{5}/)?.[0];
ok(!!shipNumber, `shipment posted: ${shipNumber}`);
const afterShip = await screwBalance();
ok(afterShip.qty === before.qty - 10, `stock decreased by 10 (${before.qty} → ${afterShip.qty})`);
ok(afterShip.reserved === before.reserved, 'reservation released by the shipment');

// печать УПД
await page.getByRole('button', { name: /^Print/ }).click();
await page.getByRole('menuitem', { name: 'UPD' }).click();
await page.waitForSelector('iframe.print-frame');
const upd = page.frameLocator('iframe.print-frame');
await upd.locator('h1').waitFor();
ok((await upd.locator('body').innerText()).includes('Универсальный передаточный документ'), 'UPD form rendered');
ok((await upd.locator('body').innerText()).includes(shipNumber), 'UPD carries the document number');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/2b-upd-print.png` });
await page.goBack();
await page.waitForSelector('table[aria-label="Document lines"]');

// 7. склад показывает уменьшенный остаток
await page.goto(`${WEB}/#/inventory`);
await page.waitForSelector('table[aria-label="Stock balances"]');
const row = page.locator('table[aria-label="Stock balances"] tbody tr', { hasText: 'Саморез' }).first();
ok((await row.innerText()).includes(String(before.qty - 10)), 'inventory page shows the reduced stock');
await row.click();
await page.waitForSelector('table[aria-label="Stock movements"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/3-inventory.png` });
await page.keyboard.press('Escape');

// 8. отмена проведения вернула остаток
await page.goto(`${WEB}/#/sales`);
await page.locator('table[aria-label="Sales journal"] tbody tr', { hasText: shipNumber }).click();
await posted();
await page.getByRole('button', { name: 'Unpost' }).click();
await page.waitForFunction(() => /Draft/.test(document.querySelector('h1')?.innerText ?? ''));
const afterUnpost = await screwBalance();
ok(afterUnpost.qty === before.qty, `unposting returned the stock (${afterUnpost.qty})`);
ok(afterUnpost.reserved === before.reserved + 10, 'reservation is back after unposting the shipment');

// палитра команд находит документ по номеру
await page.keyboard.press('Control+k');
await page.keyboard.type(orderNumber.slice(-8));
await page.waitForSelector(`text=${orderNumber}`, { timeout: 5000 });
ok(true, 'command palette finds the order by number');

await browser.close();
console.log(process.exitCode ? 'SCENARIO FAILED' : 'SCENARIO PASSED');
