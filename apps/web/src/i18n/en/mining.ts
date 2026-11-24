/* Добыча (модуль mining): журнал взвешиваний (весовая). Английский словарь — источник ключей */
export const mining = {
  title: 'Weighbridge',
  lead: 'Weighings of trucks: gross, tare, net and volume by bulk density',
  new: 'New weighing',
  edit: 'Weighing',
  delete: 'Delete',
  search: 'Search',
  filter: { all: 'All', out: 'Shipment', in: 'Receipt' },
  kpi: { count: 'Weighings', net: 'Net total, t', volume: 'Volume total, m³' },
  col: { number: 'Number', date: 'Date', direction: 'Direction', vehicle: 'Vehicle', counterparty: 'Counterparty', product: 'Product', gross: 'Gross, kg', tare: 'Tare, kg', net: 'Net, kg', volume: 'Volume, m³', waybill: 'Waybill', source: 'Source' },
  direction: { out: 'Shipment', in: 'Receipt' },
  source: { manual: 'Manual', scale_api: 'Scale API' },
  form: { plate: 'Plate number', driver: 'Driver', density: 'Bulk density, t/m³', notes: 'Notes', none: '—', calcNet: 'Net, kg, t', calcVolume: 'Volume, m³', noDensity: 'set the bulk density of the product to get the volume' },
  api: { title: 'Scale API', hint: 'Scale bridge (COM/TCP) sends the weighing with POST /weighings and an agent token:' },
  empty: 'No weighings yet',
  emptyHint: 'Add a weighing manually or connect the scale bridge',
  unit: { t: 't', kg: 'kg', m3: 'm³' },
};
