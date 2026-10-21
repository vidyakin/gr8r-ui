CREATE TABLE "product_manufacturing" (
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"replenishment" text DEFAULT 'purchase' NOT NULL,
	"default_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_manufacturing_workspace_id_product_id_pk" PRIMARY KEY("workspace_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "production_components" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" text NOT NULL,
	"product_id" uuid,
	"work_center_id" uuid,
	"operation" text DEFAULT '' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"rate" numeric(18, 2),
	"fixed_cost" numeric(18, 2),
	"planned_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"actual_qty" numeric(18, 3),
	"actual_cost" numeric(18, 4),
	"document_line_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_components_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_components_shape_chk" CHECK (("production_components"."kind" = 'work' and "production_components"."product_id" is null) or ("production_components"."kind" <> 'work' and "production_components"."product_id" is not null)),
	CONSTRAINT "production_components_nonneg_chk" CHECK ("production_components"."qty" >= 0 and "production_components"."hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_headers" (
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"work_center_id" uuid,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"parent_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_headers_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "production_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"planned_unit_cost" numeric(18, 4),
	"customer_order_line_id" uuid,
	"source_item_id" uuid,
	"document_line_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_items_qty_chk" CHECK ("production_items"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_operation_chk";--> statement-breakpoint
ALTER TABLE "stock_reservations" ALTER COLUMN "document_line_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "output_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "waste_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "production_line_id" uuid;--> statement-breakpoint
ALTER TABLE "product_manufacturing" ADD CONSTRAINT "product_manufacturing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_manufacturing" ADD CONSTRAINT "product_manufacturing_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_manufacturing" ADD CONSTRAINT "product_manufacturing_item_fk" FOREIGN KEY ("workspace_id","default_item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_parent_fk" FOREIGN KEY ("workspace_id","parent_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_customer_line_fk" FOREIGN KEY ("workspace_id","customer_order_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_source_fk" FOREIGN KEY ("workspace_id","source_item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_components_document_idx" ON "production_components" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "production_components_item_idx" ON "production_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "production_items_document_idx" ON "production_items" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "production_items_source_idx" ON "production_items" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "production_items_customer_line_idx" ON "production_items" USING btree ("customer_order_line_id");--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_output_warehouse_fk" FOREIGN KEY ("workspace_id","output_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_waste_warehouse_fk" FOREIGN KEY ("workspace_id","waste_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_production_line_fk" FOREIGN KEY ("workspace_id","production_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_production_line_uq" UNIQUE("production_line_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','production_order','production'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation','assembly'));--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_owner_chk" CHECK (("stock_reservations"."document_line_id" is not null) <> ("stock_reservations"."production_line_id" is not null));--> statement-breakpoint

-- Изоляция арендаторов: производственные таблицы — арендаторские
SELECT app_secure_tenant_table('public.product_manufacturing'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_items'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_components'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_headers'::regclass);