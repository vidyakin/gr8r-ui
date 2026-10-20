CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid,
	"organization_id" uuid,
	"bik" text NOT NULL,
	"account" text NOT NULL,
	"corr_account" text DEFAULT '' NOT NULL,
	"bank_name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "bank_accounts_owner_chk" CHECK (("bank_accounts"."company_id" is null) <> ("bank_accounts"."organization_id" is null))
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"workspace_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_organization_id_type_year_pk" PRIMARY KEY("organization_id","type","year")
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"form" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"data" "bytea",
	"storage_key" text,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "document_files_status_chk" CHECK ("document_files"."status" in ('pending','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"vat_rate" text DEFAULT '20' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"source_line_id" uuid,
	"origin_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "document_lines_qty_chk" CHECK ("document_lines"."qty" > 0 and "document_lines"."price" >= 0 and "document_lines"."discount_pct" >= 0 and "document_lines"."discount_pct" <= 100),
	CONSTRAINT "document_lines_vat_chk" CHECK ("document_lines"."vat_rate" in ('none','0','5','7','10','20'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text,
	"number_year" integer,
	"number_seq" integer,
	"date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"organization_id" uuid NOT NULL,
	"counterparty_id" uuid,
	"warehouse_id" uuid,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"price_includes_vat" boolean DEFAULT true NOT NULL,
	"amount_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"based_on_id" uuid,
	"responsible_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return')),
	CONSTRAINT "documents_status_chk" CHECK ("documents"."status" in ('draft','posted','cancelled')),
	CONSTRAINT "documents_number_chk" CHECK (("documents"."number" is null) = ("documents"."number_seq" is null) and ("documents"."number_seq" is null) = ("documents"."number_year" is null))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'legal' NOT NULL,
	"inn" text DEFAULT '' NOT NULL,
	"kpp" text DEFAULT '' NOT NULL,
	"ogrn" text DEFAULT '' NOT NULL,
	"legal_address" text DEFAULT '' NOT NULL,
	"actual_address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"director_name" text DEFAULT '' NOT NULL,
	"director_title" text DEFAULT 'Генеральный директор' NOT NULL,
	"accountant_name" text DEFAULT '' NOT NULL,
	"tax_system" text DEFAULT 'osn' NOT NULL,
	"default_vat_rate" text DEFAULT '20' NOT NULL,
	"stamp_file" jsonb,
	"director_signature_file" jsonb,
	"accountant_signature_file" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organizations_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "organizations_kind_chk" CHECK ("organizations"."kind" in ('legal','sole_proprietor','individual')),
	CONSTRAINT "organizations_tax_chk" CHECK ("organizations"."tax_system" in ('osn','usn')),
	CONSTRAINT "organizations_vat_chk" CHECK ("organizations"."default_vat_rate" in ('none','0','5','7','10','20'))
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"workspace_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_warehouse_id_product_id_pk" PRIMARY KEY("warehouse_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"qty" numeric(18, 3) NOT NULL,
	"cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"moved_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_qty_chk" CHECK ("stock_moves"."qty" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_line_uq" UNIQUE("document_line_id"),
	CONSTRAINT "stock_reservations_qty_chk" CHECK ("stock_reservations"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "warehouses_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kind" text DEFAULT 'legal' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "inn" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kpp" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ogrn" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "actual_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_source_fk" FOREIGN KEY ("workspace_id","source_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_origin_fk" FOREIGN KEY ("workspace_id","origin_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_based_on_fk" FOREIGN KEY ("workspace_id","based_on_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_responsible_fk" FOREIGN KEY ("workspace_id","responsible_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_company_idx" ON "bank_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_org_idx" ON "bank_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_files_document_idx" ON "document_files" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_lines_doc_idx" ON "document_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "document_lines_origin_idx" ON "document_lines" USING btree ("origin_line_id");--> statement-breakpoint
CREATE INDEX "document_lines_source_idx" ON "document_lines" USING btree ("source_line_id");--> statement-breakpoint
CREATE INDEX "document_lines_product_idx" ON "document_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_uq" ON "documents" USING btree ("workspace_id","organization_id","type","number_year","number_seq") WHERE "documents"."number_seq" is not null;--> statement-breakpoint
CREATE INDEX "documents_ws_type_date_idx" ON "documents" USING btree ("workspace_id","type","date");--> statement-breakpoint
CREATE INDEX "documents_counterparty_idx" ON "documents" USING btree ("counterparty_id");--> statement-breakpoint
CREATE INDEX "documents_based_on_idx" ON "documents" USING btree ("based_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_default_uq" ON "organizations" USING btree ("workspace_id") WHERE "organizations"."is_default" and "organizations"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "stock_balances_product_idx" ON "stock_balances" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_moves_card_idx" ON "stock_moves" USING btree ("workspace_id","warehouse_id","product_id","seq");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_moves" USING btree ("workspace_id","product_id","seq");--> statement-breakpoint
CREATE INDEX "stock_moves_document_idx" ON "stock_moves" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_stock_idx" ON "stock_reservations" USING btree ("workspace_id","warehouse_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_default_uq" ON "warehouses" USING btree ("workspace_id") WHERE "warehouses"."is_default" and "warehouses"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_ws_name_uq" ON "warehouses" USING btree ("workspace_id",lower("name")) WHERE "warehouses"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_kind_chk" CHECK ("companies"."kind" in ('legal','sole_proprietor','individual'));--> statement-breakpoint

-- Изоляция арендаторов: как у остальных таблиц (владелец app_owner, ENABLE + FORCE RLS, политика по workspace_id, права ролям)
SELECT app_secure_tenant_table('public.organizations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.bank_accounts'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.warehouses'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.documents'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_counters'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_moves'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_balances'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_reservations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_files'::regclass);--> statement-breakpoint

-- Для уже существующих воркспейсов: организация по умолчанию (по названию воркспейса) и основной склад
-- (новым воркспейсам их создаёт код при регистрации)
INSERT INTO organizations (workspace_id, name, full_name, is_default)
SELECT w.id, w.name, w.name, true FROM workspaces w
WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.workspace_id = w.id);--> statement-breakpoint
INSERT INTO warehouses (workspace_id, name, code, is_default)
SELECT w.id, 'Основной склад', 'MAIN', true FROM workspaces w
WHERE NOT EXISTS (SELECT 1 FROM warehouses h WHERE h.workspace_id = w.id);
