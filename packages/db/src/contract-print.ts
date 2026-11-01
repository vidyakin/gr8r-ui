/* Печать договоров по шаблонам (docs/architecture/contracts.md): данные сторон и договора, шаблон назначения
   (contract, contract_order, contract_invoice, contract_work_order) или встроенный. Рендер — чистая функция в shared/print/contract.ts. */
import { and, desc, eq, sql } from 'drizzle-orm';
import { renderContract, renderContractDocx, type ContractPrintData, type DocTemplatePurpose, type PrintOrganization, type PrintParty } from '@gr8r/shared';
import type { Db } from './client';
import { buildPrintData, defaultBank } from './documents';
import { DomainError } from './errors';
import { getFileStore } from './file-store';
import { getTemplate } from './quotes';
import { attachmentVersions, companies, contracts, docTemplates, organizations } from './schema';

export type ContractPurpose = Exclude<DocTemplatePurpose, 'quote'>;

/** Данные печати: договор, обе стороны с банком; документ — для составных назначений */
export async function contractPrintData(db: Db, contractId: string, documentId?: string | null): Promise<ContractPrintData> {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!c) throw new DomainError(404, 'not_found', 'contract not found');
  const [org] = await db.select().from(organizations).where(eq(organizations.id, c.organizationId)).limit(1);
  const [co] = await db.select().from(companies).where(eq(companies.id, c.companyId)).limit(1);
  if (!org || !co) throw new DomainError(404, 'not_found', 'contract party not found');
  const organization: PrintOrganization = {
    name: org.name,
    fullName: org.fullName || org.name,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    address: org.legalAddress,
    phone: org.phone,
    bank: await defaultBank(db, { organizationId: org.id }),
    kind: org.kind,
    directorName: org.directorName,
    directorTitle: org.directorTitle,
    accountantName: org.accountantName,
    taxSystem: org.taxSystem,
    stampFile: org.stampFile ?? null,
    directorSignatureFile: org.directorSignatureFile ?? null,
    accountantSignatureFile: org.accountantSignatureFile ?? null,
  };
  const party: PrintParty = { name: co.name, fullName: co.name, inn: co.inn, kpp: co.kpp, ogrn: co.ogrn, address: co.legalAddress || co.city, phone: '', bank: await defaultBank(db, { companyId: co.id }) };
  return {
    contract: {
      number: c.number,
      date: c.date,
      kind: c.kind,
      category: c.category,
      validFrom: c.validFrom,
      validTo: c.validTo,
      paymentDays: c.paymentDays,
      note: c.note,
      orgSignerBasis: c.orgSignerBasis,
      partySignerName: c.partySignerName,
      partySignerTitle: c.partySignerTitle,
      partySignerBasis: c.partySignerBasis,
    },
    organization,
    party,
    doc: documentId ? await buildPrintData(db, documentId) : null,
  };
}

/** Страница договора: шаблон назначения по id или встроенный; чужой шаблон «только автор» и шаблон другого назначения — 404 */
export async function renderContractHtml(db: Db, p: { contractId: string; documentId?: string | null; purpose: ContractPurpose; templateId?: string | null; memberId: string | null }): Promise<string> {
  let body: string | undefined;
  if (p.templateId) {
    const t = await getTemplate(db, { workspaceId: '', memberId: p.memberId }, p.templateId);
    if (t.purpose !== p.purpose || t.archivedAt) throw new DomainError(404, 'not_found', 'template not found');
    body = t.body;
  }
  return renderContract(await contractPrintData(db, p.contractId, p.documentId), p.purpose, body);
}

/** Заполняет .docx шаблона данными договора (с документом или без) и возвращает байты готового файла.
    Рендер — чистая функция в shared/print/contract-docx.ts. Ошибка разбора шаблона — 422 template_invalid */
export async function renderContractDocxFile(db: Db, p: { contractId: string; documentId?: string | null; templateId: string }): Promise<Uint8Array> {
  const [t] = await db.select().from(docTemplates).where(and(eq(docTemplates.id, p.templateId), eq(docTemplates.workspaceId, sql`(select app_workspace_id())`))).limit(1);
  if (!t || t.archivedAt) throw new DomainError(404, 'not_found', 'template not found');
  if (t.source !== 'docx' || !t.docxAttachmentId) throw new DomainError(422, 'not_docx_template', 'Template is not a DOCX template');
  const tpl = await docxContentById(db, t.docxAttachmentId);
  try {
    return renderContractDocx(tpl, await contractPrintData(db, p.contractId, p.documentId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new DomainError(422, 'template_invalid', `DOCX render failed: ${msg.slice(0, 300)}`);
  }
}

/** Содержимое .docx вложения по id вложения (вызывается для шаблона своего воркспейса, RLS уже проверен) */
async function docxContentById(db: Db, attachmentId: string): Promise<Uint8Array> {
  const store = getFileStore();
  if (!store) throw new DomainError(503, 'storage_unavailable', 'File storage is not configured');
  const [v] = await db
    .select({ version: attachmentVersions.version, storageKey: attachmentVersions.storageKey })
    .from(attachmentVersions)
    .where(eq(attachmentVersions.attachmentId, attachmentId))
    .orderBy(desc(attachmentVersions.version))
    .limit(1);
  if (!v?.storageKey) throw new DomainError(404, 'file_content_missing', 'DOCX template content is not available');
  const data = await store.get(v.storageKey);
  if (!data) throw new DomainError(404, 'file_content_missing', 'DOCX template content is not available');
  return data;
}
