-- Заказ на производство из строки сметы: позиция заказа помнит строку сметы, из которой создана
-- (в смете у строки показываются ссылки на заказы). Строку сметы удалят — связь станет пустой.
ALTER TABLE "production_items" ADD COLUMN "estimate_item_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_estimate_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE set null ("estimate_item_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_items_estimate_item_idx" ON "production_items" USING btree ("workspace_id","estimate_item_id") WHERE "estimate_item_id" is not null;
