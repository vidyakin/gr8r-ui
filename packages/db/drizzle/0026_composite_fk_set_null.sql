-- Составные FK (workspace_id, X) с ON DELETE SET NULL обнуляли весь ключ, включая workspace_id (NOT NULL),
-- и удаление родителя падало. Список колонок (Postgres 15+) обнуляет только X. drizzle-kit его не умеет — правка только здесь.
ALTER TABLE "documents" DROP CONSTRAINT "documents_based_on_fk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_based_on_fk" FOREIGN KEY ("workspace_id","based_on_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("based_on_id");--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_source_fk";--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_source_fk" FOREIGN KEY ("workspace_id","source_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("source_line_id");--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_origin_fk";--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_origin_fk" FOREIGN KEY ("workspace_id","origin_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("origin_line_id");--> statement-breakpoint
ALTER TABLE "production_items" DROP CONSTRAINT "production_items_line_fk";--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("document_line_id");--> statement-breakpoint
ALTER TABLE "production_items" DROP CONSTRAINT "production_items_plan_line_fk";--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_plan_line_fk" FOREIGN KEY ("workspace_id","plan_line_id") REFERENCES "public"."production_plan_lines"("workspace_id","id") ON DELETE SET NULL ("plan_line_id");--> statement-breakpoint
ALTER TABLE "production_components" DROP CONSTRAINT "production_components_line_fk";--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("document_line_id");--> statement-breakpoint
ALTER TABLE "production_operations" DROP CONSTRAINT "production_operations_task_fk";--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE SET NULL ("task_id");--> statement-breakpoint
ALTER TABLE "billing_runs" DROP CONSTRAINT "billing_runs_document_fk";--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("document_id");
