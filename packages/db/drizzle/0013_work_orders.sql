CREATE TABLE "work_order_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_kinds_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_states" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_type" text DEFAULT 'work_order' NOT NULL,
	"kind_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_states_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "document_states_category_chk" CHECK ("document_states"."category" in ('new','scheduled','in_progress','done','delivered','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "work_order_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"line_id" uuid,
	"work_center_id" uuid,
	"planned_hours" numeric(10, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_assignments_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "work_order_assignments_task_uq" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "work_order_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"warehouse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_materials_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "work_order_materials_qty_chk" CHECK ("work_order_materials"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_kind_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "work_order_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "work_order_kinds" ADD CONSTRAINT "work_order_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_kind_fk" FOREIGN KEY ("workspace_id","kind_id") REFERENCES "public"."work_order_kinds"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_kinds_ws_name_uq" ON "work_order_kinds" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_kinds_default_uq" ON "work_order_kinds" USING btree ("workspace_id") WHERE "work_order_kinds"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "document_states_kind_key_uq" ON "document_states" USING btree ("workspace_id","kind_id","key");--> statement-breakpoint
CREATE INDEX "document_states_kind_idx" ON "document_states" USING btree ("workspace_id","kind_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_order_assignments_document_idx" ON "work_order_assignments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "work_order_materials_document_idx" ON "work_order_materials" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_work_order_kind_fk" FOREIGN KEY ("workspace_id","work_order_kind_id") REFERENCES "public"."work_order_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_kind_chk" CHECK ("products"."kind" in ('goods','service','work'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order'));--> statement-breakpoint
-- Новые таблицы — арендаторские: владелец, ENABLE+FORCE RLS, политика по workspace_id и права
SELECT app_secure_tenant_table('public.work_order_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_states'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.work_order_materials'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.work_order_assignments'::regclass);--> statement-breakpoint
ALTER TABLE "document_states" ADD CONSTRAINT "document_states_type_chk" CHECK ("document_states"."document_type" = 'work_order');--> statement-breakpoint
-- Вид заказ-нарядов по умолчанию и его состояния (по одному на категорию) для воркспейсов, созданных до этой миграции:
-- новым их создаёт ensureWorkOrderKind. Ключ состояния хранится в documents.state, поэтому набор должен быть полным.
INSERT INTO "work_order_kinds" ("id", "workspace_id", "name", "is_default", "sort_order", "created_at", "updated_at")
SELECT uuid_generate_v7(), w.id, 'Default', true, 0, now(), now()
FROM "workspaces" w
WHERE NOT EXISTS (SELECT 1 FROM "work_order_kinds" k WHERE k.workspace_id = w.id AND k.is_default);
--> statement-breakpoint
INSERT INTO "document_states" ("id", "workspace_id", "document_type", "kind_id", "key", "label", "color", "category", "sort_order", "created_at", "updated_at")
SELECT uuid_generate_v7(), k.workspace_id, 'work_order', k.id, v.key, v.label, v.color, v.category, v.ord, now(), now()
FROM "work_order_kinds" k
CROSS JOIN (VALUES
  ('new', 'New', 'gray', 'new', 0),
  ('scheduled', 'Scheduled', 'blue', 'scheduled', 1),
  ('in_progress', 'In progress', 'amber', 'in_progress', 2),
  ('done', 'Done', 'green', 'done', 3),
  ('delivered', 'Delivered', 'teal', 'delivered', 4),
  ('cancelled', 'Cancelled', 'red', 'cancelled', 5)
) AS v(key, label, color, category, ord)
WHERE k.is_default
  AND NOT EXISTS (SELECT 1 FROM "document_states" s WHERE s.kind_id = k.id);
