CREATE TABLE "billing_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_breakdowns_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "billing_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_runs_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "billing_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_sources_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "billing_sources_kind_chk" CHECK ("billing_sources"."source_kind" in ('work_order','time_log','realization'))
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"kind" text DEFAULT 'customer' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"is_signed" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"payment_days" integer DEFAULT 0 NOT NULL,
	"price_type" text DEFAULT '' NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"tariff_plan_id" uuid,
	"periodicity" text,
	"billing_day" integer DEFAULT 1 NOT NULL,
	"document_package" text DEFAULT 'invoice' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contracts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "contracts_kind_chk" CHECK ("contracts"."kind" in ('customer','supplier','other')),
	CONSTRAINT "contracts_periodicity_chk" CHECK ("contracts"."periodicity" is null or "contracts"."periodicity" in ('month','quarter','year')),
	CONSTRAINT "contracts_package_chk" CHECK ("contracts"."document_package" in ('invoice','invoice_act')),
	CONSTRAINT "contracts_billing_day_chk" CHECK ("contracts"."billing_day" between 1 and 31),
	CONSTRAINT "contracts_valid_range_chk" CHECK ("contracts"."valid_to" is null or "contracts"."valid_to" >= "contracts"."valid_from"),
	CONSTRAINT "contracts_service_chk" CHECK ((not "contracts"."is_service") or ("contracts"."tariff_plan_id" is not null and "contracts"."periodicity" is not null))
);
--> statement-breakpoint
CREATE TABLE "tariff_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tariff_plan_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 3) DEFAULT '1' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"invoice_as_product_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariff_plan_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "tariff_plan_lines_qty_chk" CHECK ("tariff_plan_lines"."qty" > 0 and "tariff_plan_lines"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tariff_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"extra_product_policy" text DEFAULT 'allow' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tariff_plans_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "tariff_plans_policy_chk" CHECK ("tariff_plans"."extra_product_policy" in ('allow','warn','forbid'))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'Europe/Moscow' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "work_product_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_breakdowns" ADD CONSTRAINT "billing_breakdowns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_breakdowns" ADD CONSTRAINT "billing_breakdowns_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_sources" ADD CONSTRAINT "billing_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_sources" ADD CONSTRAINT "billing_sources_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_sources" ADD CONSTRAINT "billing_sources_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tariff_plan_fk" FOREIGN KEY ("workspace_id","tariff_plan_id") REFERENCES "public"."tariff_plans"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_plan_lines" ADD CONSTRAINT "tariff_plan_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_plan_lines" ADD CONSTRAINT "tariff_plan_lines_plan_fk" FOREIGN KEY ("workspace_id","tariff_plan_id") REFERENCES "public"."tariff_plans"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_plan_lines" ADD CONSTRAINT "tariff_plan_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_plan_lines" ADD CONSTRAINT "tariff_plan_lines_invoice_as_fk" FOREIGN KEY ("workspace_id","invoice_as_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_breakdowns_document_uq" ON "billing_breakdowns" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_runs_contract_period_uq" ON "billing_runs" USING btree ("workspace_id","contract_id","period");--> statement-breakpoint
CREATE INDEX "billing_runs_contract_idx" ON "billing_runs" USING btree ("workspace_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_sources_source_uq" ON "billing_sources" USING btree ("workspace_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "billing_sources_contract_idx" ON "billing_sources" USING btree ("workspace_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_default_uq" ON "contracts" USING btree ("workspace_id","company_id") WHERE "contracts"."is_default" and "contracts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contracts_company_idx" ON "contracts" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "contracts_service_idx" ON "contracts" USING btree ("workspace_id","is_service");--> statement-breakpoint
CREATE INDEX "tariff_plan_lines_plan_idx" ON "tariff_plan_lines" USING btree ("workspace_id","tariff_plan_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_plans_ws_name_uq" ON "tariff_plans" USING btree ("workspace_id",lower("name")) WHERE "tariff_plans"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_work_product_fk" FOREIGN KEY ("workspace_id","work_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_contract_idx" ON "documents" USING btree ("workspace_id","contract_id");--> statement-breakpoint
-- Составной внешний ключ документа на договор: договор чужого арендатора нельзя подставить
ALTER TABLE "documents" ADD CONSTRAINT "documents_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Существующим арендаторам — UTC: их расписания автоматизаций продолжают срабатывать как раньше, пока пояс не сменили
UPDATE "workspaces" SET "timezone" = 'UTC';--> statement-breakpoint
-- Договоры, тарифные планы и биллинг — арендаторские таблицы
SELECT app_secure_tenant_table('public.contracts'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.tariff_plans'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.tariff_plan_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.billing_runs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.billing_sources'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.billing_breakdowns'::regclass);
