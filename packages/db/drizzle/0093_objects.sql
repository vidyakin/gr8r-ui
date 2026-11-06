-- Задача 1268: объект — справочник и привязки (docs/architecture/construction.md).
-- Объекты объектного учёта: сам объект, прорабы, договоры; аналитика «объект» у документов, строк платежей,
-- задач и записей времени. Процент накладных по умолчанию — настройка воркспейса.
ALTER TABLE "workspaces" ADD COLUMN "object_overhead_pct" numeric(5,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_object_overhead_chk" CHECK ("workspaces"."object_overhead_pct" >= 0 and "workspaces"."object_overhead_pct" <= 100);--> statement-breakpoint
CREATE TABLE "objects" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "number" text NOT NULL,
  "name" text NOT NULL,
  "customer_id" uuid,
  "address" text DEFAULT '' NOT NULL,
  "start_date" date,
  "due_date" date,
  "status" text DEFAULT 'planning' NOT NULL,
  "manager_id" uuid,
  "revenue_mode" text DEFAULT 'acts' NOT NULL,
  "overhead_pct" numeric(5,2) DEFAULT '0' NOT NULL,
  "project_id" uuid,
  "warehouse_id" uuid,
  "note" text DEFAULT '' NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "objects_status_chk" CHECK ("objects"."status" in ('planning','active','hold','done','closed')),
  CONSTRAINT "objects_revenue_mode_chk" CHECK ("objects"."revenue_mode" in ('acts','milestones','hours')),
  CONSTRAINT "objects_overhead_chk" CHECK ("objects"."overhead_pct" >= 0 and "objects"."overhead_pct" <= 100)
);--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_ws_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "objects_ws_number_uq" ON "objects" USING btree ("workspace_id", lower("number")) WHERE "objects"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "objects_ws_status_idx" ON "objects" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_customer_fk" FOREIGN KEY ("workspace_id","customer_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_manager_fk" FOREIGN KEY ("workspace_id","manager_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE SET NULL ("project_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE SET NULL ("warehouse_id") ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "object_foremen" (
  "workspace_id" uuid NOT NULL,
  "object_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_foremen_ws_id_uq" UNIQUE("workspace_id","object_id","member_id")
);--> statement-breakpoint
ALTER TABLE "object_foremen" ADD CONSTRAINT "object_foremen_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_foremen" ADD CONSTRAINT "object_foremen_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_foremen" ADD CONSTRAINT "object_foremen_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_foremen_object_idx" ON "object_foremen" USING btree ("object_id");--> statement-breakpoint
CREATE TABLE "object_contracts" (
  "workspace_id" uuid NOT NULL,
  "object_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_contracts_ws_id_uq" UNIQUE("workspace_id","object_id","contract_id")
);--> statement-breakpoint
ALTER TABLE "object_contracts" ADD CONSTRAINT "object_contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_contracts" ADD CONSTRAINT "object_contracts_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_contracts" ADD CONSTRAINT "object_contracts_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_contracts_object_idx" ON "object_contracts" USING btree ("object_id");--> statement-breakpoint
-- Аналитика «объект»: документы, строки платежей, задачи и записи времени
ALTER TABLE "documents" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE SET NULL ("object_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_object_idx" ON "documents" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "payment_lines" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE SET NULL ("object_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_lines_object_idx" ON "payment_lines" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE SET NULL ("object_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_object_idx" ON "tasks" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE SET NULL ("object_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_logs_object_idx" ON "time_logs" USING btree ("workspace_id","object_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.objects'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_foremen'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_contracts'::regclass);
