/* Проверка отправителя вебхука ЮКассы по официальному списку адресов (документация ЮKassa, «Уведомления»).
   Список держим в коде: меняется редко; перед боевым запуском сверить с документацией. */
import { BlockList, isIP } from 'node:net';

const V4: [string, number][] = [
  ['185.71.76.0', 27],
  ['185.71.77.0', 27],
  ['77.75.153.0', 25],
  ['77.75.156.11', 32],
  ['77.75.156.35', 32],
  ['77.75.154.128', 25],
];
const V6: [string, number][] = [['2a02:5180::', 32]];

const list = new BlockList();
for (const [net, prefix] of V4) list.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) list.addSubnet(net, prefix, 'ipv6');

/** Адрес входит в список ЮКассы. IPv4, пришедший как `::ffff:a.b.c.d`, приводится к IPv4; мусор и `unknown` — нет */
export function isYooKassaIp(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let ip = raw.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  const family = isIP(ip);
  if (!family) return false;
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
