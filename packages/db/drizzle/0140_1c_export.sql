-- Задача 1226: соответствие наших объектов объектам 1С — основа всех обменов.
-- GUID хранится с конфигурацией-источником (buh3/ut): базы разные, GUID не совпадают.
CREATE TABLE "integrations_1c_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"ref_uuid" text NOT NULL,
	"ref_name" text NOT NULL DEFAULT '',
	"matched_by" text NOT NULL DEFAULT 'manual',
	"matched_rule" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_1c_links_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "integrations_1c_links_entity_uq" UNIQUE("workspace_id","source","entity_type","entity_id"),
	CONSTRAINT "integrations_1c_links_ref_uq" UNIQUE("workspace_id","source","entity_type","ref_uuid"),
	CONSTRAINT "integrations_1c_links_source_chk" CHECK ("integrations_1c_links"."source" in ('buh3','ut')),
	CONSTRAINT "integrations_1c_links_entity_type_chk" CHECK ("integrations_1c_links"."entity_type" in ('organization','company','product','bank_account','document','contract','warehouse'))
);
--> statement-breakpoint
ALTER TABLE "integrations_1c_links" ADD CONSTRAINT "integrations_1c_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrations_1c_links_entity_idx" ON "integrations_1c_links" USING btree ("workspace_id","source","entity_type");--> statement-breakpoint
CREATE INDEX "integrations_1c_links_ref_idx" ON "integrations_1c_links" USING btree ("workspace_id","ref_uuid");--> statement-breakpoint

-- Таблица арендатора: RLS по workspace_id
SELECT app_secure_tenant_table('public.integrations_1c_links');
--> statement-breakpoint
CREATE TABLE "integrations_1c_schedules" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "options" jsonb NOT NULL,
  "exported_date" date,
  "xml" text,
  "failed_at" timestamptz
);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.integrations_1c_schedules'::regclass);
