-- Передача материалов сверх нормы (docs/architecture/production-materials.md, «Передача материалов»).
-- Строка перемещения ссылается на строку состава заказа на производство: «передано» = сумма проведённых перемещений по ссылке.
ALTER TABLE "document_lines" ADD COLUMN "production_component_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_production_component_fk" FOREIGN KEY ("workspace_id","production_component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE SET NULL ("production_component_id");--> statement-breakpoint
CREATE INDEX "document_lines_component_idx" ON "document_lines" USING btree ("workspace_id","production_component_id") WHERE "production_component_id" is not null;--> statement-breakpoint
-- Допустимое превышение передачи участком, %: пусто — берётся workspaces.settings.materialOvertransferPct (по умолчанию 0)
ALTER TABLE "work_centers" ADD COLUMN "material_overtransfer_pct" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_overtransfer_chk" CHECK ("work_centers"."material_overtransfer_pct" is null or "work_centers"."material_overtransfer_pct" >= 0);
