CREATE TABLE "accountable_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accountable_moves_amount_chk" CHECK ("accountable_moves"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "cash_flow_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"flow_group" text DEFAULT 'operating' NOT NULL,
	"system_key" text,
	"investment_project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cash_flow_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "cash_flow_items_kind_chk" CHECK ("cash_flow_items"."kind" in ('income','expense')),
	CONSTRAINT "cash_flow_items_group_chk" CHECK ("cash_flow_items"."flow_group" in ('operating','investing','financing'))
);
--> statement-breakpoint
CREATE TABLE "cash_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_id" uuid,
	"date" date NOT NULL,
	"account_kind" text NOT NULL,
	"cash_register_id" uuid,
	"bank_account_id" uuid,
	"member_id" uuid,
	"cash_flow_item_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"investment_project_id" uuid,
	"cost_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_moves_amount_chk" CHECK ("cash_moves"."amount" > 0),
	CONSTRAINT "cash_moves_kind_chk" CHECK ("cash_moves"."account_kind" in ('cash','bank','accountable')),
	CONSTRAINT "cash_moves_dir_chk" CHECK ("cash_moves"."direction" in ('in','out')),
	CONSTRAINT "cash_moves_account_chk" CHECK (("cash_moves"."account_kind" = 'cash' and "cash_moves"."cash_register_id" is not null and "cash_moves"."bank_account_id" is null and "cash_moves"."member_id" is null)
      or ("cash_moves"."account_kind" = 'bank' and "cash_moves"."bank_account_id" is not null and "cash_moves"."cash_register_id" is null and "cash_moves"."member_id" is null)
      or ("cash_moves"."account_kind" = 'accountable' and "cash_moves"."member_id" is not null and "cash_moves"."cash_register_id" is null and "cash_moves"."bank_account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"responsible_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cash_registers_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"counterparty_id" uuid,
	"settlement_document_id" uuid,
	"contract_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"cash_flow_item_id" uuid NOT NULL,
	"cost_item_id" uuid,
	"investment_project_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payment_lines_amount_chk" CHECK ("payment_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"side" text NOT NULL,
	"contract_id" uuid,
	"settlement_document_id" uuid,
	"document_id" uuid NOT NULL,
	"line_id" uuid,
	"advance_document_id" uuid,
	"advance_line_id" uuid,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_moves_side_chk" CHECK ("settlement_moves"."side" in ('customer','supplier')),
	CONSTRAINT "settlement_moves_kind_chk" CHECK ("settlement_moves"."kind" in ('accrual','payment','offset')),
	CONSTRAINT "settlement_moves_amount_chk" CHECK ("settlement_moves"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_operation_chk";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "settlement_mode" text DEFAULT 'by_documents' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "cash_register_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "target_cash_register_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "target_bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "accountable_member_id" uuid;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD COLUMN "fact_basis" text DEFAULT 'accrual' NOT NULL;--> statement-breakpoint
ALTER TABLE "accountable_moves" ADD CONSTRAINT "accountable_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountable_moves" ADD CONSTRAINT "accountable_moves_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountable_moves" ADD CONSTRAINT "accountable_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_items" ADD CONSTRAINT "cash_flow_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_items" ADD CONSTRAINT "cash_flow_items_investment_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_cash_register_fk" FOREIGN KEY ("workspace_id","cash_register_id") REFERENCES "public"."cash_registers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_bank_account_fk" FOREIGN KEY ("workspace_id","bank_account_id") REFERENCES "public"."bank_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_cash_flow_item_fk" FOREIGN KEY ("workspace_id","cash_flow_item_id") REFERENCES "public"."cash_flow_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_investment_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_moves" ADD CONSTRAINT "cash_moves_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_responsible_fk" FOREIGN KEY ("workspace_id","responsible_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_settlement_fk" FOREIGN KEY ("workspace_id","settlement_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_cash_flow_item_fk" FOREIGN KEY ("workspace_id","cash_flow_item_id") REFERENCES "public"."cash_flow_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_investment_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_settlement_fk" FOREIGN KEY ("workspace_id","settlement_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_moves" ADD CONSTRAINT "settlement_moves_advance_fk" FOREIGN KEY ("workspace_id","advance_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accountable_moves_member_idx" ON "accountable_moves" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "accountable_moves_document_idx" ON "accountable_moves" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_items_system_uq" ON "cash_flow_items" USING btree ("workspace_id","system_key") WHERE "cash_flow_items"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_items_ws_name_uq" ON "cash_flow_items" USING btree ("workspace_id","kind",lower("name")) WHERE "cash_flow_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "cash_moves_document_idx" ON "cash_moves" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "cash_moves_cash_idx" ON "cash_moves" USING btree ("workspace_id","cash_register_id","date");--> statement-breakpoint
CREATE INDEX "cash_moves_bank_idx" ON "cash_moves" USING btree ("workspace_id","bank_account_id","date");--> statement-breakpoint
CREATE INDEX "cash_moves_date_idx" ON "cash_moves" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_registers_ws_name_uq" ON "cash_registers" USING btree ("workspace_id",lower("name")) WHERE "cash_registers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "payment_lines_doc_idx" ON "payment_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "payment_lines_settlement_idx" ON "payment_lines" USING btree ("settlement_document_id");--> statement-breakpoint
CREATE INDEX "settlement_moves_company_idx" ON "settlement_moves" USING btree ("workspace_id","company_id","side");--> statement-breakpoint
CREATE INDEX "settlement_moves_settlement_idx" ON "settlement_moves" USING btree ("settlement_document_id");--> statement-breakpoint
CREATE INDEX "settlement_moves_document_idx" ON "settlement_moves" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "settlement_moves_advance_idx" ON "settlement_moves" USING btree ("advance_document_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_settlement_mode_chk" CHECK ("companies"."settlement_mode" in ('by_documents','by_counterparty'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day','cash_receipt','cash_payment','bank_receipt','bank_payment','advance_report'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation','assembly','disassembly','processing','from_customer','supplier_refund','from_accountable','other_income','to_supplier','customer_refund','to_accountable','other_expense','money_transfer'));--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_fact_basis_chk" CHECK ("investment_projects"."fact_basis" in ('accrual','payments'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_cash_register_fk" FOREIGN KEY ("workspace_id","cash_register_id") REFERENCES "public"."cash_registers"("workspace_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_target_cash_register_fk" FOREIGN KEY ("workspace_id","target_cash_register_id") REFERENCES "public"."cash_registers"("workspace_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_bank_account_fk" FOREIGN KEY ("workspace_id","bank_account_id") REFERENCES "public"."bank_accounts"("workspace_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_target_bank_account_fk" FOREIGN KEY ("workspace_id","target_bank_account_id") REFERENCES "public"."bank_accounts"("workspace_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_accountable_member_fk" FOREIGN KEY ("workspace_id","accountable_member_id") REFERENCES "public"."members"("workspace_id","id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.cash_registers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.cash_flow_items'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payment_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.cash_moves'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.settlement_moves'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.accountable_moves'::regclass);
