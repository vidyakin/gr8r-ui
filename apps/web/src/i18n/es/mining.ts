/* Добыча (модуль mining): журнал взвешиваний (весовая). Английский словарь — источник ключей */
import type { Widen } from '../types';
import type { mining as M } from '../en/mining';

export const mining: Widen<typeof M> = {
  title: 'Báscula',
  lead: 'Pesaje de camiones: bruto, tara, neto y volumen por densidad aparente',
  new: 'Nuevo pesaje',
  edit: 'Pesaje',
  delete: 'Eliminar',
  search: 'Buscar',
  filter: { all: 'Todos', out: 'Envío', in: 'Recepción' },
  kpi: { count: 'Pesajes', net: 'Neto total, t', volume: 'Volumen total, m³' },
  col: { number: 'Número', date: 'Fecha', direction: 'Dirección', vehicle: 'Vehículo', counterparty: 'Contraparte', product: 'Producto', gross: 'Bruto, kg', tare: 'Tara, kg', net: 'Neto, kg', volume: 'Volumen, m³', waybill: 'Hoja de ruta', source: 'Origen' },
  direction: { out: 'Envío', in: 'Recepción' },
  source: { manual: 'Manual', scale_api: 'Scale API' },
  form: { plate: 'Matrícula', driver: 'Conductor', density: 'Densidad aparente, t/m³', notes: 'Notas', none: '—', calcNet: 'Neto, kg, t', calcVolume: 'Volumen, m³', noDensity: 'indique la densidad aparente del producto para calcular el volumen' },
  api: { title: 'Scale API', hint: 'El puente de la báscula (COM/TCP) envía el pesaje con POST /weighings y un token de agente:' },
  empty: 'Aún no hay pesajes',
  emptyHint: 'Añada un pesaje manualmente o conecte el puente de la báscula',
  unit: { t: 't', kg: 'kg', m3: 'm³' },
};
