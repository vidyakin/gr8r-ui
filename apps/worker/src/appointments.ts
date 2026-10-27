/* Задачи воркера записи на приём (задача 1171): напоминание накануне («Подтвердите запись») и контроль незакрытых дней
   (вечером и утром по часовому поясу воркспейса). Журналы appointment_reminders и appointment_day_alerts делают проходы идемпотентными. */
import { runAppointmentReminders, runUnclosedDayAlerts, withContext, workspaces, type Sql } from '@gr8r/db';
import { dateInTimezone, wallClock } from '@gr8r/shared';

export interface AppointmentsRun {
  reminders: number;
  alerts: number;
}

export async function runAppointmentsOnce(sql: Sql, at: Date = new Date()): Promise<AppointmentsRun> {
  const zones = await withContext(sql, {}, db => db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces), 'app_worker');
  const out: AppointmentsRun = { reminders: 0, alerts: 0 };
  for (const ws of zones) {
    const today = dateInTimezone(ws.timezone, at);
    const hour = wallClock(at, ws.timezone).getUTCHours();
    await withContext(
      sql,
      { workspaceId: ws.id },
      async db => {
        out.reminders += await runAppointmentReminders(db, ws.id, today);
        out.alerts += await runUnclosedDayAlerts(db, ws.id, today, hour);
      },
      'app_worker',
    );
  }
  return out;
}
