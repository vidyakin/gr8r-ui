-- Дополнительные расходы в себестоимость (задача 1385): документ `landed_cost` — сумма расходов
-- (доставка, пошлина, погрузка) распределяется по приходным строкам поступлений и выпусков продукции
-- и добавляется к себестоимости этих приходов (`stock_cost_adjustments.own_delta`).
CREATE TABLE "landed_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"method" text DEFAULT 'by_amount' NOT NULL,
	"supplier_id" uuid,
	"cost_item_id" uuid,
	"supplier_document_id" uuid,
	"supplier_document" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landed_costs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "landed_costs_method_chk" CHECK ("method" in ('by_amount','by_qty','by_weight','manual'))
);--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_supplier_fk" FOREIGN KEY ("workspace_id","supplier_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_supplier_document_fk" FOREIGN KEY ("workspace_id","supplier_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "landed_costs_document_uq" ON "landed_costs" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE TABLE "landed_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"base_document_id" uuid NOT NULL,
	"base_document_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"base_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"weight" numeric(18, 3) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landed_cost_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "landed_cost_lines_qty_chk" CHECK ("qty" >= 0 and "base_amount" >= 0 and "weight" >= 0)
);--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_base_document_fk" FOREIGN KEY ("workspace_id","base_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_base_line_fk" FOREIGN KEY ("workspace_id","base_document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "landed_cost_lines_base_line_uq" ON "landed_cost_lines" USING btree ("workspace_id","document_id","base_document_line_id");--> statement-breakpoint
CREATE INDEX "landed_cost_lines_document_idx" ON "landed_cost_lines" USING btree ("workspace_id","document_id","sort_order");--> statement-breakpoint
CREATE INDEX "landed_cost_lines_base_idx" ON "landed_cost_lines" USING btree ("workspace_id","base_document_id");--> statement-breakpoint
CREATE INDEX "landed_cost_lines_base_line_idx" ON "landed_cost_lines" USING btree ("workspace_id","base_document_line_id");--> statement-breakpoint
-- Новый тип документа: дополнительные расходы
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','opening_stock','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day','cash_receipt','cash_payment','bank_receipt','bank_payment','advance_report','payment_request','opening_balance','payroll','payroll_statement','price_setting','landed_cost'));--> statement-breakpoint
-- Дополнительные расходы и распределение по строкам оснований — арендаторские таблицы
SELECT app_secure_tenant_table('public.landed_costs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.landed_cost_lines'::regclass);
