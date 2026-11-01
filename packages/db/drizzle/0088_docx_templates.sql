-- Задача 1195: шаблоны договоров DOCX — загруженный .docx вместо текста body.
-- Содержимое файла — вложение (attachments, entity_type 'doc_template'), в шаблоне — ссылка на него.
ALTER TABLE "doc_templates" ADD COLUMN "source" text DEFAULT 'body' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD COLUMN "docx_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_source_chk" CHECK ("doc_templates"."source" in ('body','docx'));--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_docx_attachment_fk" FOREIGN KEY ("workspace_id","docx_attachment_id") REFERENCES "public"."attachments"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_templates_docx_attachment_idx" ON "doc_templates" USING btree ("docx_attachment_id");--> statement-breakpoint

