-- Роль контрагента: покупатель и/или поставщик (два независимых флажка).
ALTER TABLE "companies" ADD COLUMN "is_customer" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "is_supplier" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Поставщик: встречается в документах закупки (заказ поставщику, поступление, возврат поставщику), в видах цен,
-- поставщиком по умолчанию у товара, в сметах и в артикулах поставщика.
UPDATE "companies" c SET "is_supplier" = true
WHERE EXISTS (SELECT 1 FROM "documents" d WHERE d.workspace_id = c.workspace_id AND d.counterparty_id = c.id AND d.type IN ('supplier_order', 'receipt', 'supplier_return'))
   OR EXISTS (SELECT 1 FROM "price_kinds" k WHERE k.workspace_id = c.workspace_id AND k.supplier_id = c.id)
   OR EXISTS (SELECT 1 FROM "products" p WHERE p.workspace_id = c.workspace_id AND p.default_supplier_id = c.id)
   OR EXISTS (SELECT 1 FROM "object_estimate_items" e WHERE e.workspace_id = c.workspace_id AND e.supplier_id = c.id)
   OR EXISTS (SELECT 1 FROM "product_partner_articles" a WHERE a.workspace_id = c.workspace_id AND a.company_id = c.id);
--> statement-breakpoint
-- Покупателем не считаем тех, кто размечен поставщиком и не встречается в продажах, сделках и заказах покупателя.
UPDATE "companies" c SET "is_customer" = false
WHERE c."is_supplier"
  AND NOT EXISTS (SELECT 1 FROM "documents" d WHERE d.workspace_id = c.workspace_id AND d.counterparty_id = c.id
        AND d.type IN ('quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return', 'work_order', 'tolling_receipt', 'tolling_report', 'tolling_return'))
  AND NOT EXISTS (SELECT 1 FROM "deals" dl WHERE dl.workspace_id = c.workspace_id AND dl.company_id = c.id);
