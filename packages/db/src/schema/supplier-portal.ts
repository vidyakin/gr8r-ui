import { boolean, foreignKey, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { companies } from './crm';
import { wsCol } from './people';

export const supplierPortalLinks = pgTable('supplier_portal_links', {
  id: pk(),
  workspaceId: wsCol(),
  companyId: uuid('company_id').notNull(),
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  expiresAt: ts('expires_at'),
  lastAccessedAt: ts('last_accessed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, t => [
  foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'supplier_portal_links_company_fk' }).onDelete('cascade'),
  unique('supplier_portal_links_company_uq').on(t.workspaceId, t.companyId),
  unique('supplier_portal_links_secret_uq').on(t.workspaceId, t.secret),
]);
