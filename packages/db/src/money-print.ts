/* Печатные формы денег (задача 1174ж): данные КО-1/КО-2, поступления на счёт, платёжного поручения 0401060, АО-1 и ввода остатков,
   акт сверки и единая точка «документ + форма → HTML» для предпросмотра в браузере и PDF в воркере (одна и та же страница). */
import { eq } from 'drizzle-orm';
import {
  dec,
  DOCUMENT_LABELS_RU,
  DOCUMENT_META,
  fmt,
  isMoneyForm,
  PAYMENT_OPERATION_LABELS_RU,
  renderMoneyForm,
  renderPrintForm,
  renderSettlementAct,
  type AdvanceReportData,
  type BankReceiptData,
  type DocumentType,
  type MoneyFormData,
  type OpeningBalanceData,
  type PaymentOrderData,
  type PrintBankRef,
  type PrintForm,
  type PrintPartyRef,
} from '@gr8r/shared';
import type { Db } from './client';
import { buildPrintData, defaultBank } from './documents';
import { renderQuoteHtml } from './quotes';
import { DomainError } from './errors';
import { openingDetail } from './opening-balances';
import { cashOrderData, paymentDetail, printOrg, settlementActData } from './payments';
import { bankAccounts, companies, documents } from './schema';

type PaymentView = Awaited<ReturnType<typeof paymentDetail>>;

const LINE_LABEL = (l: PaymentView['lines'][number]) =>
  l.settlementDocument ? `${DOCUMENT_LABELS_RU[l.settlementDocument.type as DocumentType] ?? l.settlementDocument.type}${l.settlementDocument.number ? ` ${l.settlementDocument.number}` : ''}` : l.comment || l.cashFlowItemName;

async function bankRef(db: Db, id: string | null): Promise<PrintBankRef | null> {
  if (!id) return null;
  const [b] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  return b ? { bankName: b.bankName, bik: b.bik, corrAccount: b.corrAccount, account: b.account } : null;
}

async function companyRef(db: Db, id: string | null | undefined): Promise<PrintPartyRef | null> {
  if (!id) return null;
  const [c] = await db.select({ name: companies.name, inn: companies.inn, kpp: companies.kpp }).from(companies).where(eq(companies.id, id)).limit(1);
  return c ?? null;
}

async function bankReceiptData(db: Db, id: string): Promise<BankReceiptData> {
  const d = await paymentDetail(db, id);
  const payer = (await companyRef(db, d.counterparty?.id)) ?? (d.accountable ? { name: d.accountable.name, inn: '', kpp: '' } : null);
  return {
    form: 'bank_receipt',
    number: d.number,
    date: d.date,
    organization: await printOrg(db, d.organizationId),
    account: await bankRef(db, d.bankAccountId),
    operation: d.operation ? (PAYMENT_OPERATION_LABELS_RU[d.operation as keyof typeof PAYMENT_OPERATION_LABELS_RU] ?? d.operation) : '',
    payer,
    rows: d.lines.map((l, i) => ({ n: i + 1, label: LINE_LABEL(l), flowItem: l.cashFlowItemName, amount: l.amount })),
    amount: d.total,
    comment: d.comment,
  };
}

async function paymentOrderData(db: Db, id: string): Promise<PaymentOrderData> {
  const d = await paymentDetail(db, id);
  const org = await printOrg(db, d.organizationId);
  const operation = d.operation ? (PAYMENT_OPERATION_LABELS_RU[d.operation as keyof typeof PAYMENT_OPERATION_LABELS_RU] ?? d.operation) : '';
  let payee: PrintPartyRef;
  let payeeBank: PrintBankRef | null;
  if (d.operation === 'money_transfer') {
    // перевод между своими счетами: получатель — мы же, счёт — целевой
    payee = { name: org.fullName || org.name, inn: org.inn, kpp: org.kpp };
    payeeBank = await bankRef(db, d.targetBankAccountId);
  } else if (d.counterparty) {
    payee = (await companyRef(db, d.counterparty.id)) ?? { name: d.counterparty.name, inn: '', kpp: '' };
    payeeBank = await defaultBank(db, { companyId: d.counterparty.id });
  } else {
    payee = { name: d.accountable?.name ?? d.lines.find(l => l.counterpartyName)?.counterpartyName ?? '', inn: '', kpp: '' };
    payeeBank = null;
  }
  const docs = [...new Set(d.lines.map(LINE_LABEL).filter(Boolean))];
  const purpose = [operation, docs.length ? `по документам: ${docs.join(', ')}` : '', d.comment].filter(Boolean).join('. ');
  return {
    form: 'payment_order',
    number: d.number,
    date: d.date,
    organization: org,
    payer: { name: org.fullName || org.name, inn: org.inn, kpp: org.kpp },
    payerBank: await bankRef(db, d.bankAccountId),
    payee,
    payeeBank,
    amount: d.total,
    purpose,
  };
}

async function advanceReportData(db: Db, id: string): Promise<AdvanceReportData> {
  const d = await paymentDetail(db, id);
  return {
    form: 'advance_report',
    number: d.number,
    date: d.date,
    organization: await printOrg(db, d.organizationId),
    accountableName: d.accountable?.name ?? '',
    rows: d.lines.map((l, i) => ({ n: i + 1, label: l.comment || LINE_LABEL(l), costItem: l.costItemName ?? l.cashFlowItemName, counterparty: l.counterpartyName ?? '', amount: l.amount })),
    total: d.total,
    comment: d.comment,
  };
}

const OPENING_SECTIONS: { kind: string; title: string }[] = [
  { kind: 'cash', title: 'Остатки в кассах' },
  { kind: 'bank', title: 'Остатки на расчётных счетах' },
  { kind: 'customer_debt', title: 'Задолженность покупателей' },
  { kind: 'customer_advance', title: 'Авансы, полученные от покупателей' },
  { kind: 'supplier_debt', title: 'Задолженность перед поставщиками' },
  { kind: 'supplier_advance', title: 'Авансы, выданные поставщикам' },
];

async function openingBalanceData(db: Db, id: string): Promise<OpeningBalanceData> {
  const d = await openingDetail(db, id);
  return {
    form: 'opening_balance',
    number: d.number,
    date: d.date,
    organization: await printOrg(db, d.organizationId),
    sections: OPENING_SECTIONS.map(s => {
      const lines = d.lines.filter(l => l.kind === s.kind);
      return {
        title: s.title,
        rows: lines.map((l, i) => ({ n: i + 1, name: l.accountName ?? l.counterpartyName ?? '', details: [l.counterpartyName && l.accountName ? l.counterpartyName : '', l.contractNumber ? `договор ${l.contractNumber}` : ''].filter(Boolean).join(', '), amount: l.amount })),
        total: fmt(lines.reduce((sum, l) => sum + dec(l.amount), 0n), 2),
      };
    }).filter(s => s.rows.length > 0),
    comment: d.comment,
  };
}

/** Данные денежной печатной формы документа */
export async function moneyPrintData(db: Db, id: string, form: PrintForm): Promise<MoneyFormData> {
  switch (form) {
    case 'ko1':
    case 'ko2':
      return cashOrderData(db, id, form);
    case 'bank_receipt':
      return bankReceiptData(db, id);
    case 'payment_order':
      return paymentOrderData(db, id);
    case 'advance_report':
      return advanceReportData(db, id);
    case 'opening_balance':
      return openingBalanceData(db, id);
    default:
      throw new DomainError(422, 'form_not_available', `The "${form}" form is not a money form`);
  }
}

/** Печатная страница документа любого типа: единая точка для предпросмотра (API) и PDF (воркер). Форма должна быть из DOCUMENT_META типа */
export async function renderDocumentHtml(db: Db, id: string, form: PrintForm, opts: { templateId?: string | null; memberId?: string | null } = {}): Promise<string> {
  const [doc] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (!DOCUMENT_META[doc.type as DocumentType].forms.includes(form)) throw new DomainError(422, 'form_not_available', `The "${form}" form is not available for this document type`);
  if (isMoneyForm(form)) return renderMoneyForm(await moneyPrintData(db, id, form));
  // КП: стандартная форма или шаблон КП (docs/architecture/quotes.md)
  if (form === 'quote') return renderQuoteHtml(db, await buildPrintData(db, id), opts.templateId, opts.memberId ?? null);
  return renderPrintForm(form, await buildPrintData(db, id));
}

/** Акт сверки как готовая страница (для PDF в воркере) */
export async function settlementActHtml(db: Db, workspaceId: string, companyId: string, p: { side: 'customer' | 'supplier'; from?: string; to?: string; contractId?: string | null; organizationId?: string | null }): Promise<string> {
  return renderSettlementAct(await settlementActData(db, workspaceId, companyId, p));
}
