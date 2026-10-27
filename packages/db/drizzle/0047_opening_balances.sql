CREATE TABLE "opening_balance_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"cash_register_id" uuid,
	"bank_account_id" uuid,
	"counterparty_id" uuid,
	"contract_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balance_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "opening_balance_lines_amount_chk" CHECK ("opening_balance_lines"."amount" > 0),
	CONSTRAINT "opening_balance_lines_kind_chk" CHECK ("opening_balance_lines"."kind" in ('cash','bank','customer_debt','customer_advance','supplier_debt','supplier_advance'))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_cash_register_fk" FOREIGN KEY ("workspace_id","cash_register_id") REFERENCES "public"."cash_registers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_bank_account_fk" FOREIGN KEY ("workspace_id","bank_account_id") REFERENCES "public"."bank_accounts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_balance_lines_doc_idx" ON "opening_balance_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day','cash_receipt','cash_payment','bank_receipt','bank_payment','advance_report','payment_request','opening_balance'));--> statement-breakpoint
SELECT app_secure_tenant_table('public.opening_balance_lines'::regclass);
