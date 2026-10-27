/* Демо записи на приём (задача 1171): два специалиста с графиками (слот 30 и 60 мин), услуги «Массаж спины 30 мин» и «Общий массаж 60 мин»,
   записи на текущую неделю во всех статусах и один незакрытый день (визиты «пришёл» без документа дня). Даты — от сегодняшнего дня,
   записи создаёт настоящий сервис (проверка слотов и пересечений). */
import { and, asc, eq, ne } from 'drizzle-orm';
import { addDaysIso, weekStartOf, weekdayOf, type AppointmentStatus } from '@gr8r/shared';
import type { Db } from './client';
import { createAppointment, saveSchedule, setAppointmentStatus } from './appointments';
import type { DocCtx } from './documents';
import { contacts, members, products } from './schema';

export async function seedAppointments(db: Db, ctx: DocCtx): Promise<void> {
  const ws = ctx.workspaceId;
  const [ref] = await db.select({ categoryId: products.categoryId }).from(products).where(and(eq(products.workspaceId, ws), eq(products.sku, 'SV-ASM'))).limit(1);
  const service = async (name: string, sku: string, price: string, minutes: number) => {
    const [p] = await db.insert(products).values({ workspaceId: ws, kind: 'service', sku, name, unitCode: '876', vatRate: 'none', price, purchasePrice: '0', categoryId: ref?.categoryId ?? null, appointmentMinutes: minutes }).returning({ id: products.id });
    return p!.id;
  };
  const back = await service('Массаж спины 30 мин', 'SV-MSG30', '1500.00', 30);
  const full = await service('Общий массаж 60 мин', 'SV-MSG60', '2800.00', 60);

  const people = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'), ne(members.id, ctx.memberId ?? ''))).orderBy(asc(members.createdAt), asc(members.id));
  const [s1, s2] = [people[0]?.id ?? ctx.memberId!, people[1]?.id ?? people[0]?.id ?? ctx.memberId!];
  const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => from + i * step);
  const week = (days: number[], slots: number[]) => Object.fromEntries(days.map(d => [String(d), slots]));
  // специалист 1: слот 30 мин, 09:00–18:00, пн–пт; специалист 2: слот 60 мин, 10:00–20:00, пн–сб
  await saveSchedule(db, ctx, s1, { slotMinutes: 30, dayStartMin: 540, dayEndMin: 1080, week: week([1, 2, 3, 4, 5], range(540, 1080, 30)) });
  await saveSchedule(db, ctx, s2, { slotMinutes: 60, dayStartMin: 600, dayEndMin: 1200, week: week([1, 2, 3, 4, 5, 6], range(600, 1200, 60)) });

  const people2 = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.workspaceId, ws)).orderBy(asc(contacts.createdAt), asc(contacts.id)).limit(8);
  if (!people2.length) return;
  let n = 0;
  const client = () => people2[n++ % people2.length]!.id;
  const today = new Date().toISOString().slice(0, 10);
  const book = async (specialistId: string, productId: string, date: string, startMin: number, status: AppointmentStatus, reason?: string) => {
    const id = await createAppointment(db, ctx, { specialistId, productId, date, startMin, contactId: client() });
    if (status === 'confirmed') await setAppointmentStatus(db, ctx, id, 'confirmed');
    else if (status !== 'booked') {
      await setAppointmentStatus(db, ctx, id, status, reason);
    }
  };

  // незакрытый день: ближайший прошедший рабочий день специалиста 1 — два визита «пришёл», документа дня нет
  let unclosed = addDaysIso(today, -1);
  while (weekdayOf(unclosed) > 5) unclosed = addDaysIso(unclosed, -1);
  await book(s1, back, unclosed, 600, 'came');
  await book(s1, full, unclosed, 660, 'came');

  // неделя: прошедшие дни — неявка и отмена, сегодня — подтверждено и записано, будущие — записаны и подтверждены
  const monday = weekStartOf(today);
  for (let i = 0; i < 5; i++) {
    const d = addDaysIso(monday, i);
    if (d === unclosed) continue;
    const past = d < today;
    const a: AppointmentStatus = past ? 'no_show' : d === today ? 'confirmed' : 'booked';
    const b: AppointmentStatus = past ? 'cancelled' : d === today ? 'booked' : 'confirmed';
    await book(s1, back, d, 570, a);
    await book(s1, full, d, 810, b, 'Клиент перенёс визит');
    if (weekdayOf(d) <= 6) await book(s2, full, d, 720, a === 'booked' ? 'booked' : a);
  }
}
