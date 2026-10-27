/* Банковская выписка (задача 1174в): разбор и выгрузка формата 1CClientBankExchange.
   Чистые функции без обращений к БД и среде (работают и в браузере): их же использует импорт по API банков (1174д) —
   адаптер банка отдаёт тот же `BankTransaction`. Правила — docs/architecture/payments.md, «Банковская выписка». */

export type BankDirection = 'in' | 'out';

/** Сторона платежа: плательщик или получатель */
export interface BankParty {
  name: string;
  inn: string;
  kpp: string;
  /** Расчётный счёт */
  account: string;
  bik: string;
  bank: string;
  corrAccount: string;
}

/** Одна операция выписки в нормализованном виде (не зависит от банка и способа получения) */
export interface BankTransaction {
  /** Вид документа в выписке: «Платежное поручение» и т. п. */
  docType: string;
  /** Номер документа в банке */
  number: string;
  /** Дата документа, ISO */
  date: string;
  /** Дата списания со счёта плательщика, ISO */
  debitDate: string | null;
  /** Дата поступления на счёт получателя, ISO */
  creditDate: string | null;
  /** Сумма, «1234.56» */
  amount: string;
  payer: BankParty;
  receiver: BankParty;
  purpose: string;
  /** Уникальный идентификатор платежа (УИН/код), если есть */
  uin: string;
}

export interface BankAccountBalance {
  account: string;
  dateFrom: string | null;
  dateTo: string | null;
  opening: string | null;
  incoming: string | null;
  outgoing: string | null;
  closing: string | null;
}

export type BankWarningCode = 'bad_amount' | 'bad_date' | 'missing_field' | 'unterminated' | 'unknown_line';

export interface BankParseWarning {
  code: BankWarningCode;
  /** Номер строки файла (с 1) */
  line: number;
  message: string;
}

export interface BankStatement {
  version: string;
  /** Кодировка, заявленная в заголовке (Windows | DOS | UTF-8) */
  declaredEncoding: string;
  sender: string;
  receiver: string;
  createdAt: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Расчётные счета, по которым выписка (заголовок и секции остатков) */
  accounts: string[];
  balances: BankAccountBalance[];
  transactions: BankTransaction[];
  warnings: BankParseWarning[];
}

export class BankStatementFormatError extends Error {
  constructor(
    public readonly code: 'not_a_statement' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'BankStatementFormatError';
  }
}

/* ---------------- кодировки ---------------- */

export type StatementEncoding = 'utf-8' | 'windows-1251' | 'ibm866';

/** Определяет кодировку и декодирует байты файла: UTF-8 (в том числе с BOM), иначе windows-1251, иначе DOS (cp866).
    Решает содержимое, а не заголовок `Кодировка=`: заголовок в реальных выгрузках часто врёт */
export function decodeBankStatement(bytes: Uint8Array): { text: string; encoding: StatementEncoding } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    // не UTF-8
  }
  const win = new TextDecoder('windows-1251').decode(bytes);
  if (win.includes('Кодировка=') || win.includes('СекцияДокумент') || win.includes('СекцияРасчСчет')) return { text: win, encoding: 'windows-1251' };
  try {
    const dos = new TextDecoder('ibm866').decode(bytes);
    if (dos.includes('Кодировка=') || dos.includes('СекцияДокумент') || dos.includes('СекцияРасчСчет')) return { text: dos, encoding: 'ibm866' };
  } catch {
    // cp866 недоступна в этой среде
  }
  return { text: win, encoding: 'windows-1251' };
}

const CP1251_EXTRA: Record<string, number> = {
  Ё: 0xa8, ё: 0xb8, '№': 0xb9, '«': 0xab, '»': 0xbb, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '°': 0xb0, '±': 0xb1, '·': 0xb7, ' ': 0xa0, '€': 0x88,
};

/** Кодирует текст выгрузки: windows-1251 (то, что ждут банки и 1С) или UTF-8. Незнакомые символы → «?» */
export function encodeBankStatement(text: string, encoding: 'windows-1251' | 'utf-8' = 'windows-1251'): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else out.push(CP1251_EXTRA[ch] ?? 0x3f);
  }
  return Uint8Array.from(out);
}

/* ---------------- значения ---------------- */

const digits = (v: string) => v.replace(/\D+/g, '');

/** «27.10.2026» → «2026-10-27»; пустое и неверное → null */
export function parseBankDate(v: string): string | null {
  const m = /^\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s*$/.exec(v);
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(v);
  const [y, mo, d] = m ? [m[3]!, m[2]!, m[1]!] : iso ? [iso[1]!, iso[2]!, iso[3]!] : [];
  if (!y || !mo || !d) return null;
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date ? null : date;
}

/** «1 234,5» → «1234.50»; неверное → null. Отрицательные суммы в выписке не бывают — отвергаются */
export function parseBankAmount(v: string): string | null {
  const s = v.replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) return null;
  return `${m[1]!.replace(/^0+(?=\d)/, '')}.${(m[2] ?? '').padEnd(2, '0')}`;
}

/* ---------------- разбор ---------------- */

/** «ИНН 7701234567 ООО Ромашка» → { inn, name } (так пишут часть банков в поле «Плательщик») */
function splitNameInn(raw: string): { name: string; inn: string; kpp: string } {
  let name = raw.trim();
  let inn = '';
  let kpp = '';
  const mi = /^ИНН\s*(\d{10,12})\b[\s,;]*/i.exec(name);
  if (mi) {
    inn = mi[1]!;
    name = name.slice(mi[0].length);
    const mk = /^КПП\s*(\d{9})\b[\s,;]*/i.exec(name);
    if (mk) {
      kpp = mk[1]!;
      name = name.slice(mk[0].length);
    }
  }
  return { name: name.trim(), inn, kpp };
}

function partyOf(fields: Map<string, string>, prefix: 'Плательщик' | 'Получатель'): BankParty {
  const get = (k: string) => (fields.get(`${prefix}${k}`) ?? '').trim();
  const head = splitNameInn(get('1') || get(''));
  return {
    name: head.name,
    inn: digits(get('ИНН')) || head.inn,
    kpp: digits(get('КПП')) || head.kpp,
    account: digits(get('Счет') || get('РасчСчет')),
    bik: digits(get('БИК')),
    bank: get('Банк1') || get('Банк'),
    corrAccount: digits(get('Корсчет') || get('КоррСчет')),
  };
}

/** Разбирает текст выписки 1CClientBankExchange. Битые документы пропускаются с предупреждением, формат целиком неверный — исключение */
export function parseBankStatement(text: string): BankStatement {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const first = lines.findIndex(l => l.trim() !== '');
  if (first < 0) throw new BankStatementFormatError('empty', 'The file is empty');
  if (lines[first]!.trim() !== '1CClientBankExchange') throw new BankStatementFormatError('not_a_statement', 'The file is not a 1CClientBankExchange statement');

  const st: BankStatement = {
    version: '',
    declaredEncoding: '',
    sender: '',
    receiver: '',
    createdAt: null,
    dateFrom: null,
    dateTo: null,
    accounts: [],
    balances: [],
    transactions: [],
    warnings: [],
  };
  const warn = (code: BankWarningCode, line: number, message: string) => st.warnings.push({ code, line, message });
  const addAccount = (a: string) => {
    const d = digits(a);
    if (d && !st.accounts.includes(d)) st.accounts.push(d);
  };

  type Section = { kind: 'balance' | 'doc'; docType: string; start: number; fields: Map<string, string> };
  let section: Section | null = null;

  const finishDoc = (s: Section) => {
    const f = s.fields;
    const at = s.start;
    const amount = parseBankAmount(f.get('Сумма') ?? '');
    if (amount === null) return warn('bad_amount', at, `Document ${f.get('Номер') ?? ''}: wrong amount «${f.get('Сумма') ?? ''}»`);
    const date = parseBankDate(f.get('Дата') ?? '') ?? parseBankDate(f.get('ДатаПоступило') ?? '') ?? parseBankDate(f.get('ДатаСписано') ?? '');
    if (!date) return warn('bad_date', at, `Document ${f.get('Номер') ?? ''}: wrong date «${f.get('Дата') ?? ''}»`);
    if (!(f.get('Номер') ?? '').trim()) warn('missing_field', at, 'Document without a number');
    st.transactions.push({
      docType: s.docType,
      number: (f.get('Номер') ?? '').trim(),
      date,
      debitDate: parseBankDate(f.get('ДатаСписано') ?? ''),
      creditDate: parseBankDate(f.get('ДатаПоступило') ?? ''),
      amount,
      payer: partyOf(f, 'Плательщик'),
      receiver: partyOf(f, 'Получатель'),
      purpose: (f.get('НазначениеПлатежа') ?? f.get('НазначениеПлатежа1') ?? '').replace(/\s+/g, ' ').trim(),
      uin: (f.get('Код') ?? f.get('УИН') ?? '').trim(),
    });
  };
  const finishBalance = (s: Section) => {
    const f = s.fields;
    const account = digits(f.get('РасчСчет') ?? '');
    if (!account) return warn('missing_field', s.start, 'Balance section without an account');
    addAccount(account);
    const amt = (k: string) => (f.has(k) ? parseBankAmount(f.get(k)!) : null);
    st.balances.push({
      account,
      dateFrom: parseBankDate(f.get('ДатаНачала') ?? ''),
      dateTo: parseBankDate(f.get('ДатаКонца') ?? ''),
      opening: amt('НачальныйОстаток'),
      incoming: amt('ВсегоПоступило') ?? amt('ВсеПоступило'),
      outgoing: amt('ВсегоСписано') ?? amt('ВсеСписано'),
      closing: amt('КонечныйОстаток'),
    });
  };

  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    const no = i + 1;
    if (!line) continue;
    if (line === 'КонецФайла') break;
    const eq = line.indexOf('=');
    const key = eq < 0 ? line : line.slice(0, eq).trim();
    const value = eq < 0 ? '' : line.slice(eq + 1).trim();

    if (key === 'СекцияДокумент') {
      if (section) warn('unterminated', section.start, 'A section was not closed');
      section = { kind: 'doc', docType: value, start: no, fields: new Map() };
    } else if (key === 'СекцияРасчСчет') {
      if (section) warn('unterminated', section.start, 'A section was not closed');
      section = { kind: 'balance', docType: '', start: no, fields: new Map() };
    } else if (key === 'КонецДокумента' || key === 'КонецРасчСчет') {
      if (section) (section.kind === 'doc' ? finishDoc : finishBalance)(section);
      section = null;
    } else if (eq < 0) {
      warn('unknown_line', no, `Unexpected line «${line.slice(0, 40)}»`);
    } else if (section) {
      // повтор поля внутри документа (многострочное назначение) склеиваем
      const prev = section.fields.get(key);
      section.fields.set(key, prev && key.startsWith('НазначениеПлатежа') ? `${prev} ${value}` : value);
    } else {
      switch (key) {
        case 'ВерсияФормата':
          st.version = value;
          break;
        case 'Кодировка':
          st.declaredEncoding = value;
          break;
        case 'Отправитель':
          st.sender = value;
          break;
        case 'Получатель':
          st.receiver = value;
          break;
        case 'ДатаСоздания':
          st.createdAt = parseBankDate(value);
          break;
        case 'ДатаНачала':
          st.dateFrom = parseBankDate(value);
          break;
        case 'ДатаКонца':
          st.dateTo = parseBankDate(value);
          break;
        case 'РасчСчет':
          addAccount(value);
          break;
        default:
          break;
      }
    }
  }
  if (section) {
    warn('unterminated', section.start, 'The file ended inside a section');
    (section.kind === 'doc' ? finishDoc : finishBalance)(section);
  }
  return st;
}

/* ---------------- направление, дата, ключ ---------------- */

/** Приход или расход относительно своего счёта; null — счёт операции не совпал ни с одним своим (не та выписка) */
export function bankDirection(tx: BankTransaction, ownAccounts: readonly string[]): BankDirection | 'internal' | null {
  const own = new Set(ownAccounts.map(digits));
  const p = !!tx.payer.account && own.has(tx.payer.account);
  const r = !!tx.receiver.account && own.has(tx.receiver.account);
  if (p && r) return 'internal';
  if (r) return 'in';
  if (p) return 'out';
  return null;
}

/** Дата проведения по счёту: поступило — для прихода, списано — для расхода, иначе дата документа */
export function bankBookedDate(tx: BankTransaction, dir: BankDirection): string {
  return (dir === 'in' ? tx.creditDate : tx.debitDate) ?? tx.date;
}

/** Контрагент операции — противоположная сторона */
export function bankCounterparty(tx: BankTransaction, dir: BankDirection): BankParty {
  return dir === 'in' ? tx.payer : tx.receiver;
}

/** Ключ повторного импорта: счёт + дата + номер + сумма (+ направление, чтобы вход и выход с одним номером не склеились) */
export function bankImportKey(account: string, dir: BankDirection, tx: Pick<BankTransaction, 'date' | 'number' | 'amount'>): string {
  return [digits(account), dir, tx.date, tx.number.trim(), tx.amount].join('|');
}

/** Номера документов из назначения платежа: «Оплата по счету № 45 от 01.10.2026» → ['45'].
    Номера договоров (после слова «договор») отделены: по ним документ не ищем */
export function extractDocumentRefs(purpose: string): { numbers: string[]; contractNumbers: string[] } {
  const numbers: string[] = [];
  const contractNumbers: string[] = [];
  const re = /(?:(сч[её]т[а-я]*|сч\.?|заказ[а-я]*|реализаци[а-я]*|накладн[а-я]*|акт[а-я]*|упд|договор[а-я]*|дог\.?)\s*)?(?:№|N°|No\.?|N)\s*([0-9A-Za-zА-Яа-я][0-9A-Za-zА-Яа-я\-\/]*)/gi;
  for (const m of purpose.matchAll(re)) {
    const token = m[2]!.replace(/[\/\-]+$/, '');
    if (!/\d/.test(token)) continue;
    const before = purpose.slice(Math.max(0, (m.index ?? 0) - 14), m.index ?? 0).toLowerCase();
    const isContract = /^договор|^дог\./i.test(m[1] ?? '') || /договор\S*\s*$|дог\.?\s*$/.test(before);
    const list = isContract ? contractNumbers : numbers;
    if (!list.includes(token)) list.push(token);
  }
  // «по счету 45» без знака номера
  for (const m of purpose.matchAll(/(?:сч[её]т[а-я]*|сч\.)\s*(\d[0-9A-Za-zА-Яа-я\-\/]*)/gi)) {
    const token = m[1]!.replace(/[\/\-]+$/, '');
    if (!numbers.includes(token) && !contractNumbers.includes(token)) numbers.push(token);
  }
  return { numbers, contractNumbers };
}

/* ---------------- выгрузка платёжных поручений ---------------- */

export interface PaymentOrderExport {
  number: string;
  /** Дата поручения, ISO */
  date: string;
  amount: string;
  payer: BankParty;
  receiver: BankParty;
  purpose: string;
  /** Очередность платежа, по умолчанию 5 */
  priority?: string;
}

const ruDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** Файл платёжных поручений в формате 1CClientBankExchange (то, что банк-клиент загружает на отправку).
    Возвращает текст; в байты — `encodeBankStatement` (windows-1251 для банк-клиентов) */
export function renderPaymentOrders(input: { orders: PaymentOrderExport[]; createdAt: string; encoding?: 'windows-1251' | 'utf-8' }): string {
  const out: string[] = ['1CClientBankExchange', 'ВерсияФормата=1.03', `Кодировка=${input.encoding === 'utf-8' ? 'UTF-8' : 'Windows'}`, 'Отправитель=gr8r', 'Получатель=', `ДатаСоздания=${ruDate(input.createdAt)}`, 'ВремяСоздания=00:00:00'];
  const dates = input.orders.map(o => o.date).sort();
  if (dates.length) out.push(`ДатаНачала=${ruDate(dates[0]!)}`, `ДатаКонца=${ruDate(dates[dates.length - 1]!)}`);
  for (const a of [...new Set(input.orders.map(o => o.payer.account))]) out.push(`РасчСчет=${a}`);
  for (const o of input.orders) {
    const p = o.payer;
    const r = o.receiver;
    out.push(
      'СекцияДокумент=Платежное поручение',
      `Номер=${oneLine(o.number)}`,
      `Дата=${ruDate(o.date)}`,
      `Сумма=${o.amount}`,
      `ПлательщикСчет=${p.account}`,
      `Плательщик=ИНН ${p.inn} ${oneLine(p.name)}`,
      `ПлательщикИНН=${p.inn}`,
      `ПлательщикКПП=${p.kpp}`,
      `Плательщик1=${oneLine(p.name)}`,
      `ПлательщикРасчСчет=${p.account}`,
      `ПлательщикБанк1=${oneLine(p.bank)}`,
      `ПлательщикБИК=${p.bik}`,
      `ПлательщикКорсчет=${p.corrAccount}`,
      `ПолучательСчет=${r.account}`,
      `Получатель=ИНН ${r.inn} ${oneLine(r.name)}`,
      `ПолучательИНН=${r.inn}`,
      `ПолучательКПП=${r.kpp}`,
      `Получатель1=${oneLine(r.name)}`,
      `ПолучательРасчСчет=${r.account}`,
      `ПолучательБанк1=${oneLine(r.bank)}`,
      `ПолучательБИК=${r.bik}`,
      `ПолучательКорсчет=${r.corrAccount}`,
      'ВидПлатежа=Электронно',
      'ВидОплаты=01',
      `Очередность=${o.priority ?? '5'}`,
      `НазначениеПлатежа=${oneLine(o.purpose)}`,
      'КонецДокумента',
    );
  }
  out.push('КонецФайла');
  return out.join('\r\n') + '\r\n';
}
