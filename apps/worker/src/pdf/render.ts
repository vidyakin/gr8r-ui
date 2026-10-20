/* HTML → PDF через headless Chromium (playwright-core). Один браузер на процесс воркера, на каждую форму — своя страница.
   Страница не ходит в сеть: допускаются только data: и about:, чтобы ссылки печати и подписи из реквизитов организации
   (их вводит администратор) не превращали воркер в прокси к внутренним адресам. В PDF картинки попадают как data:-URL,
   по http(s)-ссылке они видны только в предпросмотре браузера — до появления файлового хранилища (S3). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { printOrientation, type PrintForm } from '@gr8r/shared';

let browser: Promise<Browser> | null = null;

/** Путь к Chromium: CHROMIUM_PATH, затем каталоги playwright (PLAYWRIGHT_BROWSERS_PATH, /opt/pw-browsers, ~/.cache/ms-playwright) */
export function findChromium(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  const roots = [env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(env.HOME ?? '/root', '.cache/ms-playwright')].filter((x): x is string => !!x && x !== '0');
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const exe = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

function launch(): Promise<Browser> {
  const executablePath = findChromium();
  return chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], timeout: 30_000 });
}

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = launch();
  try {
    const b = await browser;
    if (!b.isConnected()) throw new Error('browser disconnected');
    return b;
  } catch {
    browser = launch(); // браузер упал или не стартовал — пробуем заново
    return browser;
  }
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => {});
}

/** Печатная форма (готовая HTML-страница) → PDF формата A4 с ориентацией формы */
export async function renderPdf(html: string, form: PrintForm): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.route('**/*', route => (/^(data|about|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return await page.pdf({ format: 'A4', landscape: printOrientation(form) === 'landscape', printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close().catch(() => {});
  }
}
