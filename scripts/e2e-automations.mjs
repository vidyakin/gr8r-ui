/* Браузерный сценарий этапа 6 (playwright-core + Chromium): вход → в редакторе собрать flow «поле задачи «Priority» изменилось → приоритет = 10 → уведомление» →
   Publish → изменить приоритет задачи → во вкладке Runs успешный запуск (и пропущенный защитой от зацикливания: flow меняет то же поле) → уведомление пришло.
   Запуск: WEB=http://127.0.0.1:4352 SHOTS=/путь/для/скриншотов bun scripts/e2e-automations.mjs  (api, воркер и web запущены, БД с сидом)
   Приоритет задачи меняется запросом из страницы (сессия браузера): сам интерфейс задач здесь не проверяется. Скрипт удаляет flow «Priority escalation» прошлых прогонов. */
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://127.0.0.1:4352';
const SHOTS = process.env.SHOTS ?? '.';
const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const NAME = 'Priority escalation';

process.on('unhandledRejection', e => {
  console.log('FAILED:', String(e).slice(0, 300));
  process.exit(1);
});
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => m.type() === 'error' && !/401/.test(m.text()) && console.log('CONSOLE', m.text().slice(0, 200)));
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) process.exitCode = 1;
};
// Тёмная тема для скриншота редактора: настройка просмотра, как её хранит приложение
await page.addInitScript(() => localStorage.setItem('gr8r-ui.prefs', JSON.stringify({ theme: window.__light ? 'light' : 'dark' })));

await page.goto(`${WEB}/#/signin`);
await page.fill('#l-email', 'demo@gr8r.dev');
await page.fill('#l-pw', 'demo1234');
await page.click('#login-btn');
await page.waitForSelector('.topbar');
const ws = await page.evaluate(async () => {
  const r = await (await fetch('/api/workspaces', { credentials: 'include' })).json();
  return (r.items ?? r).find(w => w.name === 'FutureERP').id;
});
const api = (method, path, body) =>
  page.evaluate(
    async ([w, m, p, b]) => {
      const r = await fetch('/api' + p, { method: m, credentials: 'include', headers: { 'X-Workspace-Id': w, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      return r.json();
    },
    [ws, method, path, body],
  );

// чистый старт
for (const f of (await api('GET', '/flows?limit=100')).items.filter(f => f.name === NAME)) await api('DELETE', `/flows/${f.id}`);

// 1. редактор: триггер → действие → действие
await page.goto(`${WEB}/#/automations`);
await page.getByText('Сделка выиграна → создать задачу «Старт проекта»').first().waitFor();
ok((await page.locator('tr.dt-click').count()) >= 2, 'list shows the two demo automations');
await page.getByRole('button', { name: 'New automation' }).click();
await page.waitForURL(/#\/automations\/flow\//);
await page.getByLabel('Automation name').fill(NAME);
const pick = async (combo, option) => {
  await page.getByRole('combobox', { name: combo }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
await page.locator('.pal-item', { hasText: 'Field changed' }).click();
await pick('Field', 'Priority');
await page.locator('.pal-item', { hasText: 'Update field' }).click();
await pick('Field', 'Priority');
await page.getByLabel('New value').fill('10');
await page.locator('.pal-item', { hasText: 'Notify member' }).click();
await pick('Recipient', 'Андрей Волков');
await page.getByLabel('Message').fill('Priority escalated to 10');
await page.getByLabel('Link to task (optional)').fill('{{trigger.recordId}}');
ok((await page.locator('.react-flow__node').count()) === 3 && (await page.locator('.react-flow__edge').count()) === 2, 'three connected nodes on the canvas');
await page.getByText('Graph is valid').waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/automations-editor.png` });

// 2. Publish
await page.getByRole('button', { name: 'Publish' }).click();
await page.getByText('Live · v1').waitFor({ timeout: 10000 });
ok(true, 'published and enabled');

// 3. изменить приоритет задачи
const task = (await api('GET', '/tasks?limit=50')).items.find(t => t.status !== 'done' && t.priority !== 3 && t.priority !== 10);
const noteCount = async () => (await api('GET', `/notifications?q=${encodeURIComponent('Priority escalated')}`)).items.filter(n => n.taskId === task.id).length;
const before = await noteCount();
await api('PATCH', `/tasks/${task.id}`, { priority: 3 });

// 4. Runs
await page.getByRole('tab', { name: 'Runs' }).click();
await page.locator('.run-row[data-status="succeeded"]').first().waitFor({ timeout: 20000 });
ok(true, 'a succeeded run appeared in Runs');
await page.locator('.run-row[data-status="succeeded"]').first().click();
await page.locator('.step').nth(2).waitFor();
ok((await page.locator('.step .step-t').allTextContents()).join() === 'Field changed,Update field,Notify member', 'run has three steps');
await page.locator('.step-h').nth(1).click();
ok((await page.locator('.run-row[data-status="skipped"]').count()) === 1, 'the flow-made priority change was skipped by loop protection');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/automations-runs.png` });

// 5. итог
const after = await api('GET', `/tasks/${task.id}`);
ok(after.priority === 10, `task priority is now ${after.priority}`);
ok((await noteCount()) === before + 1, 'the notification arrived');
await browser.close();
