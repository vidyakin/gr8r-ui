import type { BankParty } from '../../bank-statement';
import { isValidSwiftBic } from '../bank';

type Fields = ReadonlyMap<string, string>;
type PartyPrefix = 'Плательщик' | 'Получатель';

const kzBankName = /\b(?:halyk|kaspi|jusan|bcc|alatau\s+city)\b|халык|каспи|жусан|центр\s*кредит|народный банк казахстана|банк бцк/iu;
const kzAccountField = /^(?:(?:Плательщик|Получатель)?(?:ИИК|IBAN|РасчСч[её]т|Сч[её]т))$/iu;

export function normalizeKzAccount(value: string): string {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return /^KZ\d{2}[A-Z0-9]{16}$/.test(compact) ? compact : '';
}

export function isKzStatement(lines: readonly string[]): boolean {
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator < 0) {
      if (line.trim() === 'КонецФайла') break;
      continue;
    }
    const field = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;
    if (/^(?:Отправитель|Банк)$/.test(field) && kzBankName.test(value)) return true;
    if (kzAccountField.test(field) && normalizeKzAccount(value)) return true;
    if (/^(?:(?:Плательщик|Получатель)(?:БИН|ИИН|БИНИИН|БИН\/ИИН|КБе)|КНП|КБе)$/iu.test(field)) return true;
    if (/^(?:Валюта|КодВалюты)$/.test(field) && /^(?:KZT|398|тенге)$/iu.test(value)) return true;
  }
  return false;
}

export function kzStatementAccount(fields: Fields): string {
  return normalizeKzAccount(fields.get('ИИК') || fields.get('IBAN') || fields.get('РасчСчет') || fields.get('РасчСчёт') || '');
}

export function kzBankParty(fields: Fields, prefix: PartyPrefix): BankParty {
  const get = (key: string) => fields.get(prefix + key) ?? '';
  const name = get('1') || get('');
  const head = /^(?:БИН\/ИИН|БИН|ИИН|ИНН)\s*:?\s*(\d{12})\b[\s,;]*/iu.exec(name);
  const id = [get('БИН'), get('ИИН'), get('БИНИИН'), get('БИН/ИИН'), get('ИНН'), head?.[1] ?? '']
    .map(v => v.replace(/\s/g, '')).find(v => /^\d{12}$/.test(v)) ?? '';
  const bik = (get('БИК') || get('SWIFT')).toUpperCase();
  const kbe = get('КБе') || get('КБЕ') ||
    (prefix === 'Получатель' ? fields.get('КБе') || fields.get('КБЕ') : get('КОд') || fields.get('КОд')) || '';
  return {
    name: head ? name.slice(head[0].length) : name,
    inn: id,
    kpp: '',
    account: normalizeKzAccount(get('ИИК') || get('IBAN') || get('Счет') || get('РасчСчет') || get('Счёт') || get('РасчСчёт')),
    bik: isValidSwiftBic(bik) ? bik : '',
    bank: get('Банк1') || get('Банк'),
    corrAccount: '',
    kbe: /^\d{2}$/.test(kbe) ? kbe : '',
  };
}

export function kzStatementCurrency(fields: Fields): string | undefined {
  const currency = (fields.get('Валюта') || fields.get('КодВалюты'))?.toUpperCase();
  return currency && /^(?:398|ТЕНГЕ)$/.test(currency) ? 'KZT' : currency;
}

export function kzPaymentCode(fields: Fields): string {
  const code = fields.get('КНП') || fields.get('КодНазначенияПлатежа') || '';
  return /^\d{3}$/.test(code) ? code : '';
}
