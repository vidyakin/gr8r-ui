CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"icon" text DEFAULT 'database' NOT NULL,
	"title_field" text DEFAULT 'name' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "entities_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "entities_ws_key_uq" UNIQUE("workspace_id","key"),
	CONSTRAINT "entities_kind_chk" CHECK ("entities"."kind" in ('system','custom'))
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"unique" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fields_entity_key_uq" UNIQUE("entity_id","key")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "records_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."entities"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_entity_fk" FOREIGN KEY ("workspace_id","entity_id") REFERENCES "public"."entities"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fields_entity_idx" ON "fields" USING btree ("entity_id","sort_order");--> statement-breakpoint
CREATE INDEX "records_entity_created_idx" ON "records" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "records_data_gin" ON "records" USING gin ("data" jsonb_path_ops);
--> statement-breakpoint

-- Индексы полей конструктора строит app_owner (SET ROLE в отдельном соединении): ему нужно право создавать объекты в схеме
GRANT CREATE ON SCHEMA public TO app_owner;--> statement-breakpoint

-- Изоляция арендаторов: как у остальных таблиц (владелец app_owner, ENABLE + FORCE RLS, политика по workspace_id, права ролям)
SELECT app_secure_tenant_table('public.entities'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.fields'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.records'::regclass);--> statement-breakpoint

-- Системные сущности для уже существующих воркспейсов (новым их регистрирует код при создании)
INSERT INTO entities (workspace_id, key, name, kind, icon, title_field, sort_order)
SELECT w.id, e.key, e.name, 'system', e.icon, e.title_field, e.ord
FROM workspaces w
CROSS JOIN (VALUES
  ('task', 'Tasks', 'list-checks', 'title', 0),
  ('project', 'Projects', 'folder-kanban', 'name', 1),
  ('deal', 'Deals', 'handshake', 'name', 2),
  ('company', 'Companies', 'building-2', 'name', 3),
  ('contact', 'Contacts', 'contact-round', 'name', 4)
) AS e(key, name, icon, title_field, ord)
ON CONFLICT (workspace_id, key) DO NOTHING;
