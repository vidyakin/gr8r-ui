-- Отгрузка по дату и источник привлечения в документах продаж (docs/architecture/documents.md).
-- Срок отгрузки строки (заказ покупателя; переходит в реализацию).
ALTER TABLE "document_lines" ADD COLUMN "ship_by" date;--> statement-breakpoint
-- Источник привлечения документа: рекламный источник и кампания (справочники 0053) + метки utm_*.
ALTER TABLE "documents" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "utm_source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "utm_medium" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "utm_campaign" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "utm_content" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE SET NULL ("source_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE SET NULL ("campaign_id");--> statement-breakpoint
CREATE INDEX "documents_source_idx" ON "documents" ("workspace_id","source_id") WHERE "source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_campaign_idx" ON "documents" ("workspace_id","campaign_id") WHERE "campaign_id" IS NOT NULL;
