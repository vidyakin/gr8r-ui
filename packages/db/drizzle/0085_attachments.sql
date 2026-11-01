-- Задача 1191: вложения к любым объектам с версиями (S3), квота воркспейса, перенос файлов задач и проектов (таблица files удалена)
CREATE TABLE "attachment_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"mime" text,
	"sha256" text,
	"comment" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attver_attachment_version_uq" UNIQUE("attachment_id","version"),
	CONSTRAINT "attver_size_chk" CHECK ("attachment_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "attachments_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "storage_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attver_attachment_fk" FOREIGN KEY ("workspace_id","attachment_id") REFERENCES "public"."attachments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("workspace_id","entity_type","entity_id");

-- Перенос файлов задач и проектов: метаданные становятся вложениями с версией 1 (содержимого у них нет — загрузки не было).
-- Файл задачи привязывается к задаче, файл проекта без задачи — к проекту. id вложения = id старой записи, поэтому ссылки на файл живы.
INSERT INTO "attachments" ("id", "workspace_id", "entity_type", "entity_id", "name", "kind", "current_version", "created_by", "created_at", "archived_at")
SELECT f.id, f.workspace_id, CASE WHEN f.task_id IS NOT NULL THEN 'task' ELSE 'project' END, coalesce(f.task_id, f.project_id),
       f.name, f.kind, 1, f.uploaded_by, f.created_at, f.archived_at
FROM "files" f WHERE f.task_id IS NOT NULL OR f.project_id IS NOT NULL;--> statement-breakpoint
INSERT INTO "attachment_versions" ("workspace_id", "attachment_id", "version", "storage_key", "size_bytes", "mime", "created_by", "created_at")
SELECT f.workspace_id, f.id, 1, f.storage_key, f.size_bytes, f.mime, f.uploaded_by, f.created_at
FROM "files" f WHERE f.task_id IS NOT NULL OR f.project_id IS NOT NULL;--> statement-breakpoint

-- Занятый объём: размеры всех версий неархивных вложений + PDF документов + архивы выгрузки (вместо files.size_bytes)
CREATE OR REPLACE FUNCTION app_usage_of(ws uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'members',
      (SELECT count(*) FROM memberships ms WHERE ms.workspace_id = ws
         AND NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = ws AND m.user_id = ms.user_id AND m.status = 'deactivated'))
      + (SELECT count(*) FROM invites i WHERE i.workspace_id = ws AND i.accepted_at IS NULL AND i.expires_at > now()),
    'organizations', (SELECT count(*) FROM organizations o WHERE o.workspace_id = ws AND o.archived_at IS NULL),
    'warehouses', (SELECT count(*) FROM warehouses w WHERE w.workspace_id = ws AND w.archived_at IS NULL),
    'storageBytes',
      (SELECT coalesce(sum(v.size_bytes), 0) FROM attachment_versions v JOIN attachments a ON a.workspace_id = v.workspace_id AND a.id = v.attachment_id
         WHERE v.workspace_id = ws AND a.archived_at IS NULL)
      + (SELECT coalesce(sum(d.size), 0) FROM document_files d WHERE d.workspace_id = ws)
      + (SELECT coalesce(sum(e.size), 0) FROM document_exports e WHERE e.workspace_id = ws))
$$;--> statement-breakpoint

DROP TABLE "files";--> statement-breakpoint

SELECT app_secure_tenant_table('public.attachments'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.attachment_versions'::regclass);
