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
 */
import { EVENTS_CHANNEL, listenChannel, type EventEnvelope } from '@gr8r/db';

interface Socket {
  send(data: string): void;
}

export class Hub {
  private rooms = new Map<string, Set<Socket>>();
  private stopListening: (() => Promise<void>) | null = null;

  constructor(private url: string) {}

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

  /** Рассылает событие только сокетам его воркспейса */
  dispatch(event: EventEnvelope) {
    const room = this.rooms.get(event.workspaceId);
    if (!room) return;
    const msg = JSON.stringify({ type: 'event', event });
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
