/* Российская специфика: реквизиты (ИНН, КПП, ОГРН/ОГРНИП, БИК, счета) и сумма прописью.
   Чистые функции без зависимостей — одни и те же на сервере, в интерфейсе и в печатных формах. */

export const COMPANY_KINDS = ['legal', 'sole_proprietor', 'individual'] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];
export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = { legal: 'Legal entity', sole_proprietor: 'Sole proprietor', individual: 'Individual' };

export const TAX_SYSTEMS = ['osn', 'usn'] as const;
export type TaxSystem = (typeof TAX_SYSTEMS)[number];
export const TAX_SYSTEM_LABELS: Record<TaxSystem, string> = { osn: 'General (OSN)', usn: 'Simplified (USN)' };

const digits = (s: string) => [...s].map(Number);

/** Контрольная цифра по весам: (Σ d·w mod 11) mod 10 */
function innDigit(d: number[], w: number[]): number {
  return (d.reduce((s, x, i) => s + x * w[i]!, 0) % 11) % 10;
}

const INN10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

/** ИНН: 10 цифр (юрлицо) или 12 (ИП, физлицо) с проверкой контрольных цифр */
export function isValidInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const d = digits(inn);
  if (d.length === 10) return innDigit(d.slice(0, 9), INN10) === d[9];
  return innDigit(d.slice(0, 10), INN12_1) === d[10] && innDigit(d.slice(0, 11), INN12_2) === d[11];
}

/** Достраивает ИНН контрольными цифрами: 9 цифр → ИНН юрлица, 10 цифр → ИНН физлица/ИП */
export function makeInn(base: string): string {
  if (/^\d{9}$/.test(base)) return base + innDigit(digits(base), INN10);
  if (/^\d{10}$/.test(base)) {
    const a = base + innDigit(digits(base), INN12_1);
    return a + innDigit(digits(a), INN12_2);
  }
  throw new RangeError('INN base must be 9 or 10 digits');
}

/** КПП: 4 цифры кода налогового органа, 2 символа причины постановки (цифры или латинские буквы), 3 цифры номера */
export const isValidKpp = (kpp: string) => /^\d{4}[0-9A-Z]{2}\d{3}$/.test(kpp);

/** ОГРН (13 цифр) и ОГРНИП (15 цифр): последняя цифра — остаток от деления предыдущих на 11 / 13 */
export function isValidOgrn(ogrn: string): boolean {
  if (!/^(\d{13}|\d{15})$/.test(ogrn)) return false;
  const mod = BigInt(ogrn.length === 13 ? 11 : 13);
  return Number(BigInt(ogrn.slice(0, -1)) % mod % 10n) === Number(ogrn.slice(-1));
}

/** Достраивает ОГРН (12 цифр) или ОГРНИП (14 цифр) контрольной цифрой */
export function makeOgrn(base: string): string {
  if (!/^(\d{12}|\d{14})$/.test(base)) throw new RangeError('OGRN base must be 12 or 14 digits');
  const mod = BigInt(base.length === 12 ? 11 : 13);
  return base + String(Number(BigInt(base) % mod % 10n));
}

/** БИК банка: 9 цифр, начинается с 04 (код страны) */
export const isValidBik = (bik: string) => /^04\d{7}$/.test(bik);
/** Расчётный и корреспондентский счёт: 20 цифр */
export const isValidAccount = (acc: string) => /^\d{20}$/.test(acc);

/** Контрольный ключ счёта по БИК (веса 7-1-3): для р/с берутся 3 последние цифры БИК, для к/с — «0» и 5–6 цифры БИК */
export function accountKeyOk(bik: string, account: string, corr = false): boolean {
  if (!isValidBik(bik) || !isValidAccount(account)) return false;
  const s = (corr ? '0' + bik.slice(4, 6) : bik.slice(6, 9)) + account;
  const w = [7, 1, 3];
  return digits(s).reduce((sum, x, i) => sum + ((x * w[i % 3]!) % 10), 0) % 10 === 0;
}

export interface RequisitesInput {
  kind: CompanyKind;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
}

/** Проверка реквизитов контрагента или организации по типу. Пустые значения допустимы (реквизиты заполняют по мере появления);
    возвращает ошибки по полям, пустой объект — всё в порядке */
export function validateRequisites(r: RequisitesInput): Record<string, string> {
  const errs: Record<string, string> = {};
  const inn = (r.inn ?? '').trim();
  const kpp = (r.kpp ?? '').trim();
  const ogrn = (r.ogrn ?? '').trim();
  if (inn) {
    const want = r.kind === 'legal' ? 10 : 12;
    if (!/^\d+$/.test(inn) || inn.length !== want) errs.inn = `INN must be ${want} digits for ${r.kind === 'legal' ? 'a legal entity' : r.kind === 'sole_proprietor' ? 'a sole proprietor' : 'an individual'}`;
    else if (!isValidInn(inn)) errs.inn = 'INN checksum is wrong';
  }
  if (kpp) {
    if (r.kind !== 'legal') errs.kpp = 'KPP applies to legal entities only';
    else if (!isValidKpp(kpp)) errs.kpp = 'KPP must be 9 characters: 4 digits, 2 digits or capital letters, 3 digits';
  }
  if (ogrn) {
    if (r.kind === 'individual') errs.ogrn = 'OGRN does not apply to individuals';
    else {
      const want = r.kind === 'legal' ? 13 : 15;
      if (!/^\d+$/.test(ogrn) || ogrn.length !== want) errs.ogrn = `${r.kind === 'legal' ? 'OGRN' : 'OGRNIP'} must be ${want} digits`;
      else if (!isValidOgrn(ogrn)) errs.ogrn = `${r.kind === 'legal' ? 'OGRN' : 'OGRNIP'} checksum is wrong`;
    }
  }
  return errs;
}

/* ---------------- сумма прописью ---------------- */

type Gender = 'm' | 'f';
const ONES: Record<Gender, string[]> = {
  m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
};
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
/** Разряды: [1, 2–4, 5+] и род */
const SCALES: { forms: [string, string, string]; gender: Gender }[] = [
  { forms: ['тысяча', 'тысячи', 'тысяч'], gender: 'f' },
  { forms: ['миллион', 'миллиона', 'миллионов'], gender: 'm' },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 'm' },
  { forms: ['триллион', 'триллиона', 'триллионов'], gender: 'm' },
];

/** Склонение по числу: 1 рубль, 2 рубля, 5 рублей, 11 рублей, 21 рубль */
export function pluralRu(n: number | bigint, forms: readonly [string, string, string]): string {
  const x = BigInt(n) < 0n ? -BigInt(n) : BigInt(n);
  const m100 = Number(x % 100n);
  if (m100 >= 11 && m100 <= 14) return forms[2];
  const m10 = Number(x % 10n);
  return m10 === 1 ? forms[0] : m10 >= 2 && m10 <= 4 ? forms[1] : forms[2];
}

function triple(n: number, gender: Gender): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]!);
  if (t === 1) out.push(TEENS[o]!);
  else {
    if (t) out.push(TENS[t]!);
    if (o) out.push(ONES[gender][o]!);
  }
  return out;
}

/** Целое число словами: 21 → «двадцать один», 2000 (f/m) → «две тысячи». Отрицательные — со словом «минус» */
export function numberToWordsRu(value: number | bigint, gender: Gender = 'm'): string {
  let n = BigInt(value);
  if (n === 0n) return 'ноль';
  const neg = n < 0n;
  if (neg) n = -n;
  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  if (groups.length > SCALES.length + 1) throw new RangeError('Number is too large');
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    if (i === 0) words.push(...triple(g, gender));
    else {
      const s = SCALES[i - 1]!;
      words.push(...triple(g, s.gender), pluralRu(g, s.forms));
    }
  }
  return (neg ? 'минус ' : '') + words.join(' ');
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Сумма прописью для документов: «Сто двадцать три рубля 45 копеек». Копейки — цифрами, как принято в счетах и накладных.
    amount — десятичная строка («1234.5», «-10», «0.07»); лишние знаки после копеек округляются */
export function amountInWordsRu(amount: string | number): string {
  const s = String(amount).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) throw new RangeError(`Not a decimal amount: "${s}"`);
  const frac = (m[3] ?? '').padEnd(3, '0');
  let kop = BigInt(frac.slice(0, 2));
  let rub = BigInt(m[2] || '0');
  if (Number(frac[2]) >= 5) kop += 1n;
  if (kop >= 100n) {
    kop -= 100n;
    rub += 1n;
  }
  const neg = m[1] === '-' && (rub > 0n || kop > 0n);
  const text = `${numberToWordsRu(rub, 'm')} ${pluralRu(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} ${pluralRu(kop, ['копейка', 'копейки', 'копеек'])}`;
  return capitalize(neg ? `минус ${text}` : text);
}
