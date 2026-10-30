/* Печать договора-заявки наёмному перевозчику (задача 1223, docs/architecture/transport-orders.md, п. 8 «Экспедирование»):
   страница с сервера открывается в новой вкладке и сразу печатается, как маршрутный лист рейса (../trips/data.ts). */
import { API_BASE } from '../data/api';

export async function openCarrierContract(ws: string, tripId: string): Promise<void> {
  const r = await fetch(`${API_BASE()}/transport-orders/trips/${tripId}/contract/print`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  }
  const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (w) w.addEventListener('load', () => w.print());
}
