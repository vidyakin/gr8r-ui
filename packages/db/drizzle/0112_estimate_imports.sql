-- Импорт сметы из документа (docx): извлечённая из файла таблица и ИИ-разметка строк.
-- Строку создаёт /estimates/import/document, разметку делает задача воркера estimate.ai_extract.
CREATE TABLE "estimate_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"estimate_id" uuid,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"table" jsonb NOT NULL,
	"ai_result" jsonb,
	"ai_error" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "estimate_imports_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "estimate_imports" ADD CONSTRAINT "estimate_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_imports_ws_created_idx" ON "estimate_imports" USING btree ("workspace_id","created_at");--> statement-breakpoint
SELECT app_secure_tenant_table('public.estimate_imports'::regclass);
