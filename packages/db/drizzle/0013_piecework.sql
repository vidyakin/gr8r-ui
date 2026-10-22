CREATE TABLE "operation_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'per_unit' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_rates_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "operation_rates_rate_chk" CHECK ("operation_rates"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"norm_hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"work_center_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_workspace_id_product_id_pk" PRIMARY KEY("workspace_id","product_id"),
	CONSTRAINT "operations_norm_chk" CHECK ("operations"."norm_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "piecework_headers" (
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"work_center_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "piecework_headers_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "piecework_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"product_id" uuid,
	"order_document_id" uuid,
	"release_document_id" uuid,
	"assignment_id" uuid,
	"component_id" uuid,
	"plan_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'per_unit' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "piecework_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "piecework_lines_qty_chk" CHECK ("piecework_lines"."qty" > 0 and "piecework_lines"."rate" >= 0 and "piecework_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"operation_id" uuid,
	"member_id" uuid NOT NULL,
	"task_id" uuid,
	"stage_id" uuid,
	"work_center_id" uuid,
	"planned_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"planned_hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"done_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operations_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_operations_qty_chk" CHECK ("production_operations"."planned_qty" > 0 and "production_operations"."done_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_kind_chk";--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_shape_chk";--> statement-breakpoint
ALTER TABLE "production_components" DROP CONSTRAINT "production_components_shape_chk";--> statement-breakpoint
ALTER TABLE "operation_rates" ADD CONSTRAINT "operation_rates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_rates" ADD CONSTRAINT "operation_rates_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_headers" ADD CONSTRAINT "piecework_headers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_headers" ADD CONSTRAINT "piecework_headers_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_headers" ADD CONSTRAINT "piecework_headers_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_headers" ADD CONSTRAINT "piecework_headers_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_operation_fk" FOREIGN KEY ("workspace_id","operation_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_order_fk" FOREIGN KEY ("workspace_id","order_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_release_fk" FOREIGN KEY ("workspace_id","release_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_assignment_fk" FOREIGN KEY ("workspace_id","assignment_id") REFERENCES "public"."production_operations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piecework_lines" ADD CONSTRAINT "piecework_lines_component_fk" FOREIGN KEY ("workspace_id","component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_component_fk" FOREIGN KEY ("workspace_id","component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_operation_fk" FOREIGN KEY ("workspace_id","operation_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_stage_fk" FOREIGN KEY ("workspace_id","stage_id") REFERENCES "public"."production_stages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_rates_product_idx" ON "operation_rates" USING btree ("product_id","valid_from");--> statement-breakpoint
CREATE INDEX "piecework_lines_document_idx" ON "piecework_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "piecework_lines_assignment_idx" ON "piecework_lines" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "piecework_lines_release_idx" ON "piecework_lines" USING btree ("release_document_id");--> statement-breakpoint
CREATE INDEX "production_operations_document_idx" ON "production_operations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "production_operations_item_idx" ON "production_operations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "production_operations_member_idx" ON "production_operations" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_kind_chk" CHECK ("products"."kind" in ('goods','service','operation'));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_shape_chk" CHECK (("bom_lines"."kind" = 'material' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'semi' and "bom_lines"."child_item_id" is not null and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" <> "bom_lines"."item_id")
        or ("bom_lines"."kind" = 'work' and "bom_lines"."child_item_id" is null));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_shape_chk" CHECK ("production_components"."kind" = 'work' or ("production_components"."kind" <> 'work' and "production_components"."product_id" is not null));--> statement-breakpoint
-- Сдельный наряд — новый тип документа
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','piecework_order'));--> statement-breakpoint
-- Операции, исполнители и сдельные наряды — арендаторские таблицы
SELECT app_secure_tenant_table('public.operations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.operation_rates'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_operations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.piecework_headers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.piecework_lines'::regclass);
