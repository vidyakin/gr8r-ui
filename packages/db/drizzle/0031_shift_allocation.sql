CREATE TABLE "material_allocation_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"release_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"document_line_id" uuid,
	"qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_allocation_rows_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "material_allocations" (
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_allocations_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id"),
	CONSTRAINT "material_allocations_period_chk" CHECK ("material_allocations"."period_from" <= "material_allocations"."period_to")
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "material_mode" text DEFAULT 'on_release' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "alloc_cost" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "material_mode" text DEFAULT 'on_release' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_item_fk" FOREIGN KEY ("workspace_id","release_item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("document_line_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocations" ADD CONSTRAINT "material_allocations_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_allocation_rows_document_idx" ON "material_allocation_rows" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "material_allocation_rows_release_idx" ON "material_allocation_rows" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "material_allocation_rows_item_idx" ON "material_allocation_rows" USING btree ("release_item_id");--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_material_mode_chk" CHECK ("production_headers"."material_mode" in ('on_release','shift'));--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_material_mode_chk" CHECK ("work_centers"."material_mode" in ('on_release','shift'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return'));
--> statement-breakpoint
SELECT app_secure_tenant_table('public.material_allocations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.material_allocation_rows'::regclass);
