CREATE TABLE "in_use_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"member_id" uuid,
	"work_center_id" uuid,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "in_use_balances_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "in_use_balances_holder_chk" CHECK (("in_use_balances"."member_id" is not null) <> ("in_use_balances"."work_center_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "in_use_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"product_id" uuid NOT NULL,
	"member_id" uuid,
	"work_center_id" uuid,
	"qty" numeric(18, 3) NOT NULL,
	"moved_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "in_use_moves_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "in_use_moves_holder_chk" CHECK (("in_use_moves"."member_id" is not null) <> ("in_use_moves"."work_center_id" is not null)),
	CONSTRAINT "in_use_moves_qty_chk" CHECK ("in_use_moves"."qty" <> 0)
);
--> statement-breakpoint
ALTER TABLE "document_lines" DROP CONSTRAINT "document_lines_qty_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_transfer_chk";--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "book_qty" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "received_qty" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "in_use_member_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "in_use_work_center_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "phase" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "in_use_balances" ADD CONSTRAINT "in_use_balances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_balances" ADD CONSTRAINT "in_use_balances_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_balances" ADD CONSTRAINT "in_use_balances_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_balances" ADD CONSTRAINT "in_use_balances_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_use_moves" ADD CONSTRAINT "in_use_moves_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "in_use_balances_member_uq" ON "in_use_balances" USING btree ("workspace_id","product_id","member_id") WHERE "in_use_balances"."member_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "in_use_balances_work_center_uq" ON "in_use_balances" USING btree ("workspace_id","product_id","work_center_id") WHERE "in_use_balances"."work_center_id" is not null;--> statement-breakpoint
CREATE INDEX "in_use_balances_holder_idx" ON "in_use_balances" USING btree ("workspace_id","member_id","work_center_id");--> statement-breakpoint
CREATE INDEX "in_use_moves_holder_idx" ON "in_use_moves" USING btree ("workspace_id","member_id","work_center_id");--> statement-breakpoint
CREATE INDEX "in_use_moves_document_idx" ON "in_use_moves" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_in_use_member_fk" FOREIGN KEY ("workspace_id","in_use_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Составной FK на участок получателя в эксплуатации: в drizzle-схеме его нет (schema/documents.ts не может импортировать
-- production.ts — цикл), поэтому ключ задан только здесь; изоляцию арендаторов он гарантирует так же, как остальные связи
ALTER TABLE "documents" ADD CONSTRAINT "documents_in_use_work_center_fk" FOREIGN KEY ("workspace_id","in_use_work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_book_qty_chk" CHECK ("document_lines"."book_qty" >= 0 and "document_lines"."received_qty" >= 0);--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_qty_chk" CHECK ("document_lines"."qty" >= 0 and "document_lines"."price" >= 0 and "document_lines"."discount_pct" >= 0 and "document_lines"."discount_pct" <= 100);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_in_use_chk" CHECK ("documents"."operation" not in ('to_operation','from_operation') or (("documents"."in_use_member_id" is not null) <> ("documents"."in_use_work_center_id" is not null)));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transfer_chk" CHECK ("documents"."operation" not in ('transfer','in_transit') or ("documents"."target_warehouse_id" is not null and "documents"."target_warehouse_id" <> "documents"."warehouse_id"));--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_phase_chk" CHECK ("stock_moves"."phase" in (1,2));
-- Изоляция арендаторов: учёт имущества в эксплуатации — арендаторские таблицы
SELECT app_secure_tenant_table('public.in_use_balances'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.in_use_moves'::regclass);
