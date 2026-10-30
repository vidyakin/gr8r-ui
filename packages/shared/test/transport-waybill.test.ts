import { describe, expect, test } from 'bun:test';
import { renderTransportWaybill, type TransportWaybillPrintData } from '../src';

const party = (name: string) => ({ name, inn: '7701234567', kpp: '770101001', address: 'Москва, ул. Ленина, 1', phone: '+7 495 000-00-00', contact: '' });
const base = (over: Partial<TransportWaybillPrintData> = {}): TransportWaybillPrintData => ({
  number: 'ТН-00007',
  date: '2026-10-30',
  consignor: party('ООО «Отправитель»'),
  loadingPlace: 'Основной склад, Москва',
  consignee: party('ООО «Получатель»'),
  unloadingPlace: 'Тверь, ул. Мира, 5',
  cargo: [{ name: 'Стол <дуб>, 2 шт', places: '2', weightKg: '40.000', volumeM3: '', consignee: '' }],
  totals: { places: '2', weightKg: '40.000', volumeM3: '' },
  documents: ['Реализация (УПД) № РТ-1 от 30.10.2026'],
  loadingDate: '2026-10-30',
  carrier: party('ООО «Перевозчик»'),
  vehicle: { plate: 'Т111ТТ77', model: 'ГАЗ Газель', capacityKg: '1500' },
  drivers: [{ name: 'Иванов И.И.', licenseNumber: '77 01 123456' }],
  price: '1500',
  reference: 'рейс РС-2026-00001',
  etrnStatus: 'none',
  ...over,
});

describe('транспортная накладная: печатная форма', () => {
  test('заполняет разделы данными и показывает номер, дату, водителя и машину', () => {
    const h = renderTransportWaybill(base());
    for (const s of ['ТН-00007', '30.10.2026', 'ООО «Отправитель»', 'ООО «Получатель»', 'Тверь, ул. Мира, 5', 'Т111ТТ77', 'Иванов И.И.', '77 01 123456', 'РТ-1', 'не оформлена', 'Основной склад']) expect(h).toContain(s);
    for (let n = 1; n <= 14; n++) expect(h).toContain(`>${n}. `);
  });
  test('экранирует данные', () => {
    const h = renderTransportWaybill(base({ consignor: { ...party('<script>alert(1)</script>'), address: 'a&b' } }));
    expect(h).not.toContain('<script>alert');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('Стол &lt;дуб&gt;');
    expect(h).toContain('a&amp;b');
  });
  test('пустые данные — пустые поля, а не undefined', () => {
    const empty = { name: '', inn: '', kpp: '', address: '', phone: '', contact: '' };
    const h = renderTransportWaybill(base({ consignor: empty, consignee: empty, carrier: empty, cargo: [], documents: [], drivers: [], vehicle: { plate: '', model: '', capacityKg: '' }, price: '', totals: { places: '', weightKg: '', volumeM3: '' }, loadingPlace: '', unloadingPlace: '', reference: '' }));
    expect(h).not.toContain('undefined');
    expect(h).toContain('class="line"');
    expect(h).toContain('<td class="center">1</td><td>&nbsp;</td>');
  });
  test('несколько получателей — колонка «Получатель» в таблице груза', () => {
    const h = renderTransportWaybill(base({ consignee: null, cargo: [{ name: 'Товар', places: '', weightKg: '1', volumeM3: '', consignee: 'ООО «А», Тверь' }] }));
    expect(h).toContain('Получатель, адрес');
    expect(h).toContain('ООО «А», Тверь');
    expect(h).toContain('по точкам');
  });
  test('статус ЭТрН выводится', () => {
    expect(renderTransportWaybill(base({ etrnStatus: 'signed' }))).toContain('подписана');
  });
});
