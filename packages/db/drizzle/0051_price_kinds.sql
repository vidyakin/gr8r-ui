CREATE TABLE "price_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"system_key" text,
	"base_kind_id" uuid,
	"markup_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"cost_basis" text,
	"rounding_step" numeric(10, 2) DEFAULT '0.01' NOT NULL,
	"rounding_mode" text DEFAULT 'math' NOT NULL,
	"round_to_nine" boolean DEFAULT false NOT NULL,
	"includes_vat" boolean DEFAULT true NOT NULL,
	"supplier_id" uuid,
	"update_from_receipts" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "price_kinds_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "price_kinds_method_chk" CHECK ("price_kinds"."method" in ('manual','derived','cost_based')),
	CONSTRAINT "price_kinds_basis_chk" CHECK ("price_kinds"."cost_basis" is null or "price_kinds"."cost_basis" in ('avg_cost','last_purchase')),
	CONSTRAINT "price_kinds_rounding_chk" CHECK ("price_kinds"."rounding_step" in (0.01, 1, 10, 100) and "price_kinds"."rounding_mode" in ('math','up')),
	CONSTRAINT "price_kinds_rule_chk" CHECK (("price_kinds"."method" <> 'derived' or "price_kinds"."base_kind_id" is not null) and ("price_kinds"."method" <> 'cost_based' or "price_kinds"."cost_basis" is not null)),
	CONSTRAINT "price_kinds_base_self_chk" CHECK ("price_kinds"."base_kind_id" is null or "price_kinds"."base_kind_id" <> "price_kinds"."id")
);
--> statement-breakpoint
CREATE TABLE "price_list_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"price_kind_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_stock_only" boolean DEFAULT false NOT NULL,
	"expires_at" date,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_links_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "price_setting_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"product_id" uuid NOT NULL,
	"price_kind_id" uuid NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"old_price" numeric(18, 2),
	CONSTRAINT "price_setting_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "price_setting_lines_price_chk" CHECK ("price_setting_lines"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"price_kind_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"document_id" uuid,
	"line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_price_chk" CHECK ("product_prices"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "price_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "price_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_kinds" ADD COLUMN "price_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "price_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "price_kinds" ADD CONSTRAINT "price_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_kinds" ADD CONSTRAINT "price_kinds_base_fk" FOREIGN KEY ("workspace_id","base_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_kinds" ADD CONSTRAINT "price_kinds_supplier_fk" FOREIGN KEY ("workspace_id","supplier_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_links" ADD CONSTRAINT "price_list_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_setting_lines" ADD CONSTRAINT "price_setting_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_setting_lines" ADD CONSTRAINT "price_setting_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_setting_lines" ADD CONSTRAINT "price_setting_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_setting_lines" ADD CONSTRAINT "price_setting_lines_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_kinds_ws_name_uq" ON "price_kinds" USING btree ("workspace_id",lower("name")) WHERE "price_kinds"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_kinds_system_uq" ON "price_kinds" USING btree ("workspace_id","system_key") WHERE "price_kinds"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_links_hash_uq" ON "price_list_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "price_list_links_ws_idx" ON "price_list_links" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_setting_lines_uq" ON "price_setting_lines" USING btree ("document_id","product_id","price_kind_id");--> statement-breakpoint
CREATE INDEX "price_setting_lines_document_idx" ON "price_setting_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_prices_lookup_idx" ON "product_prices" USING btree ("workspace_id","price_kind_id","product_id","date");--> statement-breakpoint
CREATE INDEX "product_prices_product_idx" ON "product_prices" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "product_prices_document_idx" ON "product_prices" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day','cash_receipt','cash_payment','bank_receipt','bank_payment','advance_report','payment_request','opening_balance','payroll','payroll_statement','price_setting'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_price_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_price_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_price_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_kinds" ADD CONSTRAINT "work_order_kinds_price_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "price_kinds" ("workspace_id","name","method","system_key","update_from_receipts","sort_order") SELECT "id",'Розничная','manual','retail',false,0 FROM "workspaces";--> statement-breakpoint
INSERT INTO "price_kinds" ("workspace_id","name","method","system_key","update_from_receipts","sort_order") SELECT "id",'Закупочная','manual','purchase',false,1 FROM "workspaces";--> statement-breakpoint
INSERT INTO "product_prices" ("workspace_id","price_kind_id","product_id","date","price") SELECT p."workspace_id", k."id", p."id", p."created_at"::date, p."price" FROM "products" p JOIN "price_kinds" k ON k."workspace_id" = p."workspace_id" AND k."system_key" = 'retail' WHERE p."price" > 0;--> statement-breakpoint
INSERT INTO "product_prices" ("workspace_id","price_kind_id","product_id","date","price") SELECT p."workspace_id", k."id", p."id", p."created_at"::date, p."purchase_price" FROM "products" p JOIN "price_kinds" k ON k."workspace_id" = p."workspace_id" AND k."system_key" = 'purchase' WHERE p."purchase_price" > 0;--> statement-breakpoint
UPDATE "contracts" c SET "price_kind_id" = k."id" FROM "price_kinds" k WHERE k."workspace_id" = c."workspace_id" AND lower(k."name") = lower(trim(c."price_type")) AND c."price_type" <> '';--> statement-breakpoint
SELECT app_secure_tenant_table('public.price_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.price_list_links'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.price_setting_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_prices'::regclass);--> statement-breakpoint
