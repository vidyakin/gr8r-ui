CREATE TABLE "crm_next_contact_runs" (
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_date" date NOT NULL,
	"activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_next_contact_runs_company_id_contact_date_pk" PRIMARY KEY("company_id","contact_date")
);
--> statement-breakpoint
CREATE TABLE "sales_plan_docs" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"period_start" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_plan_figures" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"organization_id" uuid,
	"period_start" date NOT NULL,
	"member_id" uuid,
	"category_id" uuid,
	"product_id" uuid,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"member_id" uuid,
	"category_id" uuid,
	"product_id" uuid,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_plan_lines_amount_chk" CHECK ("sales_plan_lines"."amount" >= 0 and "sales_plan_lines"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_plan_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"periodicity" text DEFAULT 'month' NOT NULL,
	"dimension" text DEFAULT 'manager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sales_plan_scenarios_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "sales_plan_scenarios_periodicity_chk" CHECK ("sales_plan_scenarios"."periodicity" in ('month','quarter','year')),
	CONSTRAINT "sales_plan_scenarios_dimension_chk" CHECK ("sales_plan_scenarios"."dimension" in ('manager','category','product'))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "next_contact_date" date;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "next_contact_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "repeat_sale_days" integer;--> statement-breakpoint
ALTER TABLE "crm_next_contact_runs" ADD CONSTRAINT "crm_next_contact_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_next_contact_runs" ADD CONSTRAINT "cncr_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_docs" ADD CONSTRAINT "sales_plan_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_docs" ADD CONSTRAINT "sales_plan_docs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_docs" ADD CONSTRAINT "sales_plan_docs_scenario_fk" FOREIGN KEY ("workspace_id","scenario_id") REFERENCES "public"."sales_plan_scenarios"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_figures" ADD CONSTRAINT "sales_plan_figures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_figures" ADD CONSTRAINT "sales_plan_figures_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_figures" ADD CONSTRAINT "sales_plan_figures_scenario_fk" FOREIGN KEY ("workspace_id","scenario_id") REFERENCES "public"."sales_plan_scenarios"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_figures" ADD CONSTRAINT "sales_plan_figures_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_figures" ADD CONSTRAINT "sales_plan_figures_organization_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_lines" ADD CONSTRAINT "sales_plan_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_lines" ADD CONSTRAINT "sales_plan_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_lines" ADD CONSTRAINT "sales_plan_lines_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_lines" ADD CONSTRAINT "sales_plan_lines_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."product_categories"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_lines" ADD CONSTRAINT "sales_plan_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_plan_scenarios" ADD CONSTRAINT "sales_plan_scenarios_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_plan_figures_scenario_idx" ON "sales_plan_figures" USING btree ("workspace_id","scenario_id","period_start");--> statement-breakpoint
CREATE INDEX "sales_plan_figures_document_idx" ON "sales_plan_figures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "sales_plan_lines_document_idx" ON "sales_plan_lines" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_plan_scenarios_name_uq" ON "sales_plan_scenarios" USING btree ("workspace_id",lower("name")) WHERE "sales_plan_scenarios"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_repeat_days_chk" CHECK ("products"."repeat_sale_days" is null or "products"."repeat_sale_days" between 1 and 3650);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan'));--> statement-breakpoint
SELECT app_secure_tenant_table('public.crm_next_contact_runs'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.sales_plan_scenarios'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.sales_plan_docs'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.sales_plan_lines'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.sales_plan_figures'::regclass);
