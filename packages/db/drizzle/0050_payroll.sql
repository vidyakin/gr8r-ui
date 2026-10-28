CREATE TABLE "employee_accruals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"amount" numeric(18, 2),
	"percent" numeric(5, 2),
	"percent_basis" text DEFAULT 'revenue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_accruals_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "employee_accruals_basis_chk" CHECK ("employee_accruals"."percent_basis" in ('revenue','margin'))
);
--> statement-breakpoint
CREATE TABLE "employee_payroll" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"hired_at" date,
	"fired_at" date,
	"organization_id" uuid,
	"work_center_id" uuid,
	"reflection_id" uuid,
	"ndfl_rate" numeric(5, 2) DEFAULT '13' NOT NULL,
	"card_account" text DEFAULT '' NOT NULL,
	"advance_amount" numeric(18, 2),
	"advance_percent" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_payroll_workspace_id_member_id_pk" PRIMARY KEY("workspace_id","member_id"),
	CONSTRAINT "employee_payroll_ndfl_chk" CHECK ("employee_payroll"."ndfl_rate" >= 0 and "employee_payroll"."ndfl_rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "payroll_headers" (
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"period" date NOT NULL,
	"work_center_id" uuid,
	CONSTRAINT "payroll_headers_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_type" text NOT NULL,
	"system_key" text,
	"insurable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "payroll_kinds_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payroll_kinds_base_chk" CHECK ("payroll_kinds"."base_type" in ('salary','piecework','sales_percent','bonus','one_time','deduction'))
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"member_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"worked_days" integer DEFAULT 0 NOT NULL,
	"norm_days" integer DEFAULT 0 NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"ndfl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"insurance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reflection_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payroll_lines_amount_chk" CHECK ("payroll_lines"."amount" >= 0 and "payroll_lines"."ndfl" >= 0 and "payroll_lines"."insurance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_id" uuid,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_moves_kind_chk" CHECK ("payroll_moves"."kind" in ('accrual','ndfl','deduction','payment'))
);
--> statement-breakpoint
CREATE TABLE "payroll_reflections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"work_center_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "payroll_reflections_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "payroll_statement_headers" (
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"period" date NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	CONSTRAINT "payroll_statement_headers_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id"),
	CONSTRAINT "payroll_statement_headers_kind_chk" CHECK ("payroll_statement_headers"."kind" in ('advance','settlement') and "payroll_statement_headers"."method" in ('cash','bank'))
);
--> statement-breakpoint
CREATE TABLE "payroll_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_statement_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payroll_statement_lines_amount_chk" CHECK ("payroll_statement_lines"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_operation_chk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payroll_insurance_rate" numeric(5, 2) DEFAULT '30' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_accruals" ADD CONSTRAINT "employee_accruals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_accruals" ADD CONSTRAINT "employee_accruals_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_accruals" ADD CONSTRAINT "employee_accruals_kind_fk" FOREIGN KEY ("workspace_id","kind_id") REFERENCES "public"."payroll_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_reflection_fk" FOREIGN KEY ("workspace_id","reflection_id") REFERENCES "public"."payroll_reflections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_headers" ADD CONSTRAINT "payroll_headers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_headers" ADD CONSTRAINT "payroll_headers_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_headers" ADD CONSTRAINT "payroll_headers_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_kinds" ADD CONSTRAINT "payroll_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_kind_fk" FOREIGN KEY ("workspace_id","kind_id") REFERENCES "public"."payroll_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_reflection_fk" FOREIGN KEY ("workspace_id","reflection_id") REFERENCES "public"."payroll_reflections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_moves" ADD CONSTRAINT "payroll_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_moves" ADD CONSTRAINT "payroll_moves_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_moves" ADD CONSTRAINT "payroll_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reflections" ADD CONSTRAINT "payroll_reflections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reflections" ADD CONSTRAINT "payroll_reflections_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reflections" ADD CONSTRAINT "payroll_reflections_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statement_headers" ADD CONSTRAINT "payroll_statement_headers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statement_headers" ADD CONSTRAINT "payroll_statement_headers_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statement_lines" ADD CONSTRAINT "payroll_statement_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statement_lines" ADD CONSTRAINT "payroll_statement_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statement_lines" ADD CONSTRAINT "payroll_statement_lines_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_accruals_uq" ON "employee_accruals" USING btree ("workspace_id","member_id","kind_id","valid_from");--> statement-breakpoint
CREATE INDEX "employee_accruals_member_idx" ON "employee_accruals" USING btree ("member_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_kinds_system_uq" ON "payroll_kinds" USING btree ("workspace_id","system_key") WHERE "payroll_kinds"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "payroll_lines_doc_idx" ON "payroll_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "payroll_lines_member_idx" ON "payroll_lines" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "payroll_moves_member_idx" ON "payroll_moves" USING btree ("workspace_id","member_id","date");--> statement-breakpoint
CREATE INDEX "payroll_moves_document_idx" ON "payroll_moves" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_reflections_ws_name_uq" ON "payroll_reflections" USING btree ("workspace_id",lower("name")) WHERE "payroll_reflections"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payroll_statement_lines_doc_idx" ON "payroll_statement_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day','cash_receipt','cash_payment','bank_receipt','bank_payment','advance_report','payment_request','opening_balance','payroll','payroll_statement'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation','assembly','disassembly','processing','from_customer','supplier_refund','from_accountable','other_income','to_supplier','customer_refund','to_accountable','other_expense','money_transfer','salary_payment'));
--> statement-breakpoint
SELECT app_secure_tenant_table('public.employee_accruals'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.employee_payroll'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_headers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_moves'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_reflections'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_statement_headers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payroll_statement_lines'::regclass);--> statement-breakpoint
