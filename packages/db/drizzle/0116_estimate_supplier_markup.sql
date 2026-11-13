-- Смета: поставщик и замок строки, единая наценка сметы. Поставщик строки задаёт вид цен для себестоимости;
-- замок не даёт пересчитывать строку автоматически; наценка (null — не задана) считает цену из себестоимости.
ALTER TABLE "object_estimates" ADD COLUMN "markup_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_supplier_fk" FOREIGN KEY ("workspace_id","supplier_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE set null ("supplier_id") ON UPDATE no action;
