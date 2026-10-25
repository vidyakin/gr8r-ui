-- Возвратные отходы и брак (задача 1136): строки waste в спецификации и снимке выпуска, учётная цена отхода,
-- брак у позиции выпуска, режим стоимости отходов и склады «отходы в» / «брак в» в шапке, четвёртый склад участка.
-- SET NULL со списком колонок (как в 0026) — правка руками: drizzle-kit его не умеет.
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_kind_chk";--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_shape_chk";--> statement-breakpoint
ALTER TABLE "production_components" DROP CONSTRAINT "production_components_kind_chk";--> statement-breakpoint
ALTER TABLE "production_components" ADD COLUMN "price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "waste_valuation" text DEFAULT 'accounting' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "waste_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "defect_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "defect_qty" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "defect_mode" text;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "defect_unit_cost" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "disposal_document_id" uuid;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "defect_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_waste_warehouse_fk" FOREIGN KEY ("workspace_id","waste_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE SET NULL ("waste_warehouse_id");--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_defect_warehouse_fk" FOREIGN KEY ("workspace_id","defect_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE SET NULL ("defect_warehouse_id");--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_disposal_document_fk" FOREIGN KEY ("workspace_id","disposal_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("disposal_document_id");--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_defect_warehouse_fk" FOREIGN KEY ("workspace_id","defect_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE SET NULL ("defect_warehouse_id");--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_kind_chk" CHECK ("bom_lines"."kind" in ('material','semi','work','expense','output','waste'));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_shape_chk" CHECK (("bom_lines"."kind" = 'material' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'expense' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'output' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'waste' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'semi' and "bom_lines"."child_item_id" is not null and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" <> "bom_lines"."item_id")
        or ("bom_lines"."kind" = 'work' and "bom_lines"."child_item_id" is null));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_price_chk" CHECK ("production_components"."price" is null or ("production_components"."kind" = 'waste' and "production_components"."price" >= 0));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_kind_chk" CHECK ("production_components"."kind" in ('material','semi','work','expense','output','waste'));--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_defect_chk" CHECK ("production_items"."defect_qty" >= 0 and "production_items"."defect_qty" <= "production_items"."qty");--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_defect_mode_chk" CHECK ("production_items"."defect_mode" is null or "production_items"."defect_mode" in ('waste','cost','expense'));