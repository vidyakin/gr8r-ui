/* Realtime: WebSocket /ws + рассылка событий из outbox.
 *
 * Выбор: PostgreSQL LISTEN/NOTIFY, а не опрос таблицы events.
 *   - recordEvent() делает pg_notify в той же транзакции, что и запись в events → уведомление уходит ТОЛЬКО после коммита
 *     (откат отменяет и событие, и рассылку), задержка — миллисекунды, без нагрузки от периодических запросов;
 *   - каждый экземпляр API держит одно выделенное соединение LISTEN (postgres.js переподключается и подписывается заново)
 *     и рассылает сообщения своим сокетам по комнатам воркспейсов — горизонтальное масштабирование работает из коробки;
 *   - NOTIFY теряется, если слушателя не было (обрыв, рестарт). Поэтому клиент при подключении передаёт `?since=<id последнего
 *     события>` и получает пропущенное из таблицы events (id — uuid v7, сортируется по времени); также есть GET /events?since=.
 *   Полезная нагрузка NOTIFY — конверт без payload (лимит 8000 байт); клиент перечитывает изменённую запись или патчит кэш.
 *
 * Сжатие пачек: массовая операция пишет событие на каждую запись (например, «Создать товары» по прайсу — десятки тысяч
 * product.created; на них подписаны автоматизации, поэтому журнал не трогаем). Клиенту нужна только сущность, чтобы перечитать
 * списки, поэтому по сокету первое событие воркспейса уходит сразу, а пришедшие следом в окне WINDOW_MS сворачиваются — одно на
 * пару «сущность + тип» (последнее, с наибольшим id, и `coalesced` — сколько событий в нём). Пока поток идёт, окно продлевается.
 * Полный поток по записям — в таблице events (GET /events?since=).
 */
import { EVENTS_CHANNEL, listenChannel, type EventEnvelope } from '@gr8r/db';

interface Socket {
  send(data: string): void;
}

const WINDOW_MS = 100;

type Folded<E> = Map<string, { event: E; count: number }>;

/** Добавляет событие в свёртку по паре «сущность + тип», оставляя событие с наибольшим id (uuid v7 растёт со временем) */
function fold<E extends Pick<EventEnvelope, 'id' | 'entity' | 'type'>>(byKey: Folded<E>, e: E) {
  const key = `${e.entity}\u0000${e.type}`;
  const cur = byKey.get(key);
  if (!cur) byKey.set(key, { event: e, count: 1 });
  else {
    cur.count++;
    if (e.id > cur.event.id) cur.event = e;
  }
}

const ordered = <E extends Pick<EventEnvelope, 'id'>>(byKey: Folded<E>) => [...byKey.values()].sort((a, b) => (a.event.id < b.event.id ? -1 : 1));

/** Сворачивает список событий по паре «сущность + тип» (досылка пропущенного) */
export function coalesceEvents<E extends Pick<EventEnvelope, 'id' | 'entity' | 'type'>>(list: Iterable<E>): { event: E; count: number }[] {
  const byKey: Folded<E> = new Map();
  for (const e of list) fold(byKey, e);
  return ordered(byKey);
}

export const eventMessage = (c: { event: EventEnvelope; count: number }, extra?: Record<string, unknown>) =>
  JSON.stringify({ type: 'event', event: c.event, ...(c.count > 1 ? { coalesced: c.count } : {}), ...extra });

export class Hub {
  private rooms = new Map<string, Set<Socket>>();
  private stopListening: (() => Promise<void>) | null = null;
  /** Открытые окна сжатия по воркспейсам: события, пришедшие после первого, ждут конца окна */
  private windows = new Map<string, { timer: ReturnType<typeof setTimeout>; events: Folded<EventEnvelope> }>();

  constructor(
    private url: string,
    private windowMs = WINDOW_MS,
  ) {}

  /** Подписывается на канал событий (вызывается один раз при старте процесса) */
  async start() {
    if (this.stopListening) return;
    this.stopListening = await listenChannel(this.url, EVENTS_CHANNEL, raw => {
      try {
        this.dispatch(JSON.parse(raw) as EventEnvelope);
      } catch (e) {
        console.error('[realtime] bad notification payload', e);
      }
    });
  }

  async stop() {
    for (const w of this.windows.values()) clearTimeout(w.timer);
    this.windows.clear();
    for (const room of this.rooms.values()) for (const s of room) (s as { close?: () => void }).close?.();
    this.rooms.clear();
    await this.stopListening?.();
    this.stopListening = null;
  }

  join(workspaceId: string, socket: Socket) {
    let room = this.rooms.get(workspaceId);
    if (!room) this.rooms.set(workspaceId, (room = new Set()));
    room.add(socket);
  }

  leave(workspaceId: string, socket: Socket) {
    const room = this.rooms.get(workspaceId);
    room?.delete(socket);
    if (room && room.size === 0) this.rooms.delete(workspaceId);
  }

  /** Рассылает событие только сокетам его воркспейса. Первое уходит сразу, следующие в окне — свёрнутыми в его конце */
  dispatch(event: EventEnvelope) {
    if (!this.rooms.has(event.workspaceId)) return;
    const w = this.windows.get(event.workspaceId);
    if (w) {
      fold(w.events, event); // память окна — по записи на пару «сущность + тип», а не на событие
      return;
    }
    this.broadcast(event.workspaceId, eventMessage({ event, count: 1 }));
    this.openWindow(event.workspaceId);
  }

  private openWindow(workspaceId: string) {
    const w = { events: new Map() as Folded<EventEnvelope>, timer: setTimeout(() => this.closeWindow(workspaceId), this.windowMs) };
    this.windows.set(workspaceId, w);
  }

  private closeWindow(workspaceId: string) {
    const w = this.windows.get(workspaceId);
    this.windows.delete(workspaceId);
    if (!w?.events.size) return;
    for (const c of ordered(w.events)) this.broadcast(workspaceId, eventMessage(c));
    // поток ещё идёт — следующее окно, чтобы и его хвост свернуть
    this.openWindow(workspaceId);
  }

  private broadcast(workspaceId: string, msg: string) {
    const room = this.rooms.get(workspaceId);
    if (!room) return;
    for (const s of room) {
      try {
        s.send(msg);
      } catch {
        /* закрытый сокет уберёт onClose */
      }
    }
  }

  get connections() {
    let n = 0;
    for (const r of this.rooms.values()) n += r.size;
    return n;
  }
}
