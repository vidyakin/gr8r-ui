CREATE TABLE "processing_service_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"processing_order_id" uuid NOT NULL,
	"amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"closing_id" uuid,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_service_costs_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_company_id" uuid NOT NULL,
	"processing_order_id" uuid,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_stock_balances_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "customer_stock_moves_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_company_id" uuid NOT NULL,
	"processing_order_id" uuid,
	"qty" numeric(18, 3) NOT NULL,
	"moved_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_stock_moves_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "customer_stock_moves_qty_chk" CHECK ("customer_stock_moves"."qty" <> 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_operation_chk";--> statement-breakpoint
ALTER TABLE "production_components" ADD COLUMN "owner_kind" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "processing_order_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "tolling_role" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tolling_order_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "counterparty_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_order_fk" FOREIGN KEY ("workspace_id","processing_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_report_fk" FOREIGN KEY ("workspace_id","report_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("report_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_closing_fk" FOREIGN KEY ("workspace_id","closing_id") REFERENCES "public"."production_cost_closings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_balances" ADD CONSTRAINT "customer_stock_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_balances" ADD CONSTRAINT "customer_stock_balances_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_balances" ADD CONSTRAINT "customer_stock_balances_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_balances" ADD CONSTRAINT "customer_stock_balances_owner_fk" FOREIGN KEY ("workspace_id","owner_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_balances" ADD CONSTRAINT "customer_stock_balances_order_fk" FOREIGN KEY ("workspace_id","processing_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_owner_fk" FOREIGN KEY ("workspace_id","owner_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_stock_moves" ADD CONSTRAINT "customer_stock_moves_order_fk" FOREIGN KEY ("workspace_id","processing_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processing_service_costs_document_uq" ON "processing_service_costs" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "processing_service_costs_order_idx" ON "processing_service_costs" USING btree ("workspace_id","processing_order_id");--> statement-breakpoint
CREATE INDEX "processing_service_costs_closing_idx" ON "processing_service_costs" USING btree ("workspace_id","closing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_stock_balances_order_uq" ON "customer_stock_balances" USING btree ("workspace_id","warehouse_id","product_id","owner_company_id","processing_order_id") WHERE "customer_stock_balances"."processing_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_stock_balances_owner_uq" ON "customer_stock_balances" USING btree ("workspace_id","warehouse_id","product_id","owner_company_id") WHERE "customer_stock_balances"."processing_order_id" is null;--> statement-breakpoint
CREATE INDEX "customer_stock_balances_owner_idx" ON "customer_stock_balances" USING btree ("workspace_id","owner_company_id");--> statement-breakpoint
CREATE INDEX "customer_stock_balances_product_idx" ON "customer_stock_balances" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "customer_stock_moves_card_idx" ON "customer_stock_moves" USING btree ("workspace_id","warehouse_id","product_id","owner_company_id","processing_order_id","seq");--> statement-breakpoint
CREATE INDEX "customer_stock_moves_document_idx" ON "customer_stock_moves" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_processing_order_fk" FOREIGN KEY ("workspace_id","processing_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tolling_order_fk" FOREIGN KEY ("workspace_id","tolling_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("tolling_order_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_owner_chk" CHECK ("production_components"."owner_kind" in ('own','customer'));--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tolling_role_chk" CHECK ("document_lines"."tolling_role" is null or "document_lines"."tolling_role" in ('product','material','waste'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','tolling_receipt','tolling_report','tolling_return'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation','assembly','disassembly','processing'));--> statement-breakpoint
-- составной FK с ON DELETE SET NULL обнулил бы и workspace_id (NOT NULL): выше обнуляется только сама ссылка
SELECT app_secure_tenant_table('public.customer_stock_balances'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.customer_stock_moves'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.processing_service_costs'::regclass);
