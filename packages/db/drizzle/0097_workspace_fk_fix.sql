-- Внешний ключ на воркспейс с каскадным удалением у таблиц, где миграции 0090 (партии, 1187) и 0091 (ОТК, 1186)
-- его пропустили: без него удаление арендатора (deleteTenant) оставляло строки партий, анализов и причин брака.
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_reasons" ADD CONSTRAINT "defect_reasons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_analyses" ADD CONSTRAINT "batch_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Задача 1195 (0088): SET NULL без списка колонок обнулял бы и workspace_id (NOT NULL) — удаление вложения шаблона падало
ALTER TABLE "doc_templates" DROP CONSTRAINT "doc_templates_docx_attachment_fk";--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_docx_attachment_fk" FOREIGN KEY ("workspace_id","docx_attachment_id") REFERENCES "public"."attachments"("workspace_id","id") ON DELETE SET NULL ("docx_attachment_id") ON UPDATE no action;
