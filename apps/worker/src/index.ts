/* Точка входа воркера: опрос jobs + outbox, ускорение по LISTEN gr8r_events. */
import { createSql, databaseUrl, ddlDatabaseUrl, EVENTS_CHANNEL, listenChannel } from '@gr8r/db';
import { closeBrowser } from './pdf/render';
import { scheduleFlowsOnce } from './flows/triggers';
import { runBillingOnce } from './billing';
import { runNextContactsOnce } from './next-contacts';
import { runAppointmentsOnce } from './appointments';
import { defaultOptions, processEventsOnce, processJobsOnce, requeueStale } from './worker';

const pollMs = Number(process.env.WORKER_POLL_MS ?? 1000);
const sql = createSql(databaseUrl(), { max: 5 });
// DDL (индексы полей конструктора) — отдельное подключение роли-владельца; у API его нет
const ddlUrl = ddlDatabaseUrl();
const ddl = ddlUrl ? createSql(ddlUrl, { max: 2 }) : null;
const o = defaultOptions({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4), ddl });

let stopping = false;
let wake: (() => void) | null = null;
const sleep = () => new Promise<void>(res => {
  const t = setTimeout(res, pollMs);
  wake = () => {
    clearTimeout(t);
    res();
  };
});

// Новое событие в outbox → просыпаемся сразу, не дожидаясь следующего опроса
const stopListening = await listenChannel(databaseUrl(), EVENTS_CHANNEL, () => wake?.());
if (!ddl) o.log('DATABASE_URL_DDL is not set: DDL jobs (field indexes) will fail until it is configured');
o.log(`started as ${o.workerId}, poll ${pollMs} ms, concurrency ${o.concurrency}`);

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  o.log(`${signal}: shutting down`);
  wake?.();
  await stopListening();
  await closeBrowser();
  await ddl?.end({ timeout: 5 });
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

let lastStaleCheck = 0;
let lastMinute = 0;
let lastBillingHour = '';
while (!stopping) {
  try {
    if (Date.now() - lastStaleCheck > 60_000) {
      lastStaleCheck = Date.now();
      const n = await requeueStale(sql, o);
      if (n) o.log(`requeued ${n} stale job(s)`);
    }
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      const n = await scheduleFlowsOnce(sql); // автоматизации по расписанию: раз в минуту, повтор той же минуты ничего не создаёт
      if (n) o.log(`scheduled ${n} flow run(s)`);
    }
    // биллинг договоров обслуживания: раз в час проверяем, не наступил ли день выставления (по часовому поясу арендатора)
    const hour = new Date().toISOString().slice(0, 13);
    if (hour !== lastBillingHour) {
      lastBillingHour = hour;
      const n = await runBillingOnce(sql);
      if (n) o.log(`issued ${n} billing invoice(s)`);
      // следующий контакт с клиентом (повторные продажи): дела на сегодня по часовому поясу арендатора, повтор в тот же день ничего не создаёт
      const calls = await runNextContactsOnce(sql);
      if (calls) o.log(`created ${calls} next-contact task(s)`);
      // запись на приём: напоминания накануне и контроль незакрытых дней
      const appts = await runAppointmentsOnce(sql);
      if (appts.reminders || appts.alerts) o.log(`appointments: ${appts.reminders} reminder(s), ${appts.alerts} unclosed-day alert(s)`);
    }
    const events = await processEventsOnce(sql, o);
    const jobs = await processJobsOnce(sql, o);
    if (events + jobs > 0) continue; // есть работа — сразу следующий проход
  } catch (e) {
    o.log(`loop error: ${e instanceof Error ? e.message : e}`);
  }
  await sleep();
}

