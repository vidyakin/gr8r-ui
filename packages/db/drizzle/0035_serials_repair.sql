CREATE TABLE "document_line_serials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"material_id" uuid,
	"serial" text NOT NULL,
	"serial_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_line_serials_slot_chk" CHECK (("document_line_serials"."document_line_id" is not null) <> ("document_line_serials"."material_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "serial_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "serial_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"serial_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"phase" integer DEFAULT 1 NOT NULL,
	"doc_type" text NOT NULL,
	"direction" text NOT NULL,
	"warehouse_id" uuid,
	"counterparty_id" uuid,
	"status_after" text NOT NULL,
	"moved_at" date NOT NULL,
	"warranty_months" integer,
	"warranty_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_numbers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"warehouse_id" uuid,
	"sold_at" date,
	"sold_document_id" uuid,
	"sold_line_id" uuid,
	"owner_company_id" uuid,
	"warranty_months" integer,
	"warranty_until" date,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_numbers_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "serial_numbers_status_chk" CHECK ("serial_numbers"."status" in ('in_stock','sold','written_off','in_transit'))
);
--> statement-breakpoint
CREATE TABLE "work_order_customer_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '1' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_repair_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"serial_id" uuid,
	"serial_text" text DEFAULT '' NOT NULL,
	"defect" text DEFAULT '' NOT NULL,
	"completeness" text DEFAULT '' NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"received_at" date,
	"returned_at" date,
	"outsource_company_id" uuid,
	"outsourced_at" date,
	"outsource_returned_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_repair_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "work_order_repair_items_document_uq" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "track_serials" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "warranty_months" integer;--> statement-breakpoint
ALTER TABLE "work_order_kinds" ADD COLUMN "kind_type" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_material_fk" FOREIGN KEY ("workspace_id","material_id") REFERENCES "public"."work_order_materials"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_serial_fk" FOREIGN KEY ("workspace_id","serial_id") REFERENCES "public"."serial_numbers"("workspace_id","id") ON DELETE SET NULL ("serial_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_serial_fk" FOREIGN KEY ("workspace_id","serial_id") REFERENCES "public"."serial_numbers"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_events" ADD CONSTRAINT "serial_events_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_owner_fk" FOREIGN KEY ("workspace_id","owner_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_sold_document_fk" FOREIGN KEY ("workspace_id","sold_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_customer_materials" ADD CONSTRAINT "work_order_customer_materials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_customer_materials" ADD CONSTRAINT "work_order_customer_materials_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_customer_materials" ADD CONSTRAINT "work_order_customer_materials_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_repair_items" ADD CONSTRAINT "work_order_repair_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_repair_items" ADD CONSTRAINT "work_order_repair_items_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_repair_items" ADD CONSTRAINT "work_order_repair_items_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_repair_items" ADD CONSTRAINT "work_order_repair_items_serial_fk" FOREIGN KEY ("workspace_id","serial_id") REFERENCES "public"."serial_numbers"("workspace_id","id") ON DELETE SET NULL ("serial_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_repair_items" ADD CONSTRAINT "work_order_repair_items_outsource_fk" FOREIGN KEY ("workspace_id","outsource_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_line_serials_document_idx" ON "document_line_serials" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_line_serials_line_idx" ON "document_line_serials" USING btree ("document_line_id");--> statement-breakpoint
CREATE INDEX "document_line_serials_material_idx" ON "document_line_serials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "document_line_serials_serial_idx" ON "document_line_serials" USING btree ("serial_id");--> statement-breakpoint
CREATE INDEX "serial_events_serial_idx" ON "serial_events" USING btree ("serial_id","seq");--> statement-breakpoint
CREATE INDEX "serial_events_document_idx" ON "serial_events" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_numbers_product_serial_uq" ON "serial_numbers" USING btree ("workspace_id","product_id",lower("serial"));--> statement-breakpoint
CREATE INDEX "serial_numbers_serial_idx" ON "serial_numbers" USING btree ("workspace_id",lower("serial"));--> statement-breakpoint
CREATE INDEX "serial_numbers_product_status_idx" ON "serial_numbers" USING btree ("workspace_id","product_id","status");--> statement-breakpoint
CREATE INDEX "work_order_customer_materials_document_idx" ON "work_order_customer_materials" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "work_order_repair_items_serial_idx" ON "work_order_repair_items" USING btree ("serial_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_warranty_chk" CHECK ("products"."warranty_months" is null or "products"."warranty_months" between 0 and 600);--> statement-breakpoint
ALTER TABLE "work_order_kinds" ADD CONSTRAINT "work_order_kinds_type_chk" CHECK ("work_order_kinds"."kind_type" in ('regular','repair','warranty'));--> statement-breakpoint
-- Системная статья затрат «Гарантийный ремонт» для существующих воркспейсов (новым её создаёт ensureCostItems)
INSERT INTO "cost_items" ("workspace_id", "name", "kind", "system_key")
SELECT w.id, 'Гарантийный ремонт', 'expense', 'garantiynyy_remont'
FROM "workspaces" w
ON CONFLICT DO NOTHING;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.serial_numbers'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.serial_events'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_line_serials'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.work_order_repair_items'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.work_order_customer_materials'::regclass);
