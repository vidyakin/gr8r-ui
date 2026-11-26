-- Прослеживаемость партий (задача 1253): отдельная сущность связей партий — граф «партия-источник → партия-результат».
-- Не переиспользует serial_numbers. Ребро порождает документ: выпуск продукции (production), перемещение (transfer),
-- переработка давальческого сырья (processing). Остатки/себестоимость не меняет — только прослеживаемость.
CREATE TABLE "stock_batch_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"input_batch_id" uuid,
	"output_batch_id" uuid,
	"input_line_id" uuid,
	"output_line_id" uuid,
	"input_product_id" uuid,
	"output_product_id" uuid,
	"owner_kind" text DEFAULT 'own' NOT NULL,
	"owner_company_id" uuid,
	"processing_order_id" uuid,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batch_links_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "stock_batch_links_kind_chk" CHECK ("kind" in ('production','transfer','processing')),
	CONSTRAINT "stock_batch_links_owner_chk" CHECK ("owner_kind" in ('own','customer')),
	CONSTRAINT "stock_batch_links_qty_chk" CHECK ("qty" >= 0),
	CONSTRAINT "stock_batch_links_endpoint_chk" CHECK ("input_batch_id" is not null or "output_batch_id" is not null or "owner_kind" = 'customer')
);--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_input_batch_fk" FOREIGN KEY ("workspace_id","input_batch_id") REFERENCES "public"."stock_batches"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_output_batch_fk" FOREIGN KEY ("workspace_id","output_batch_id") REFERENCES "public"."stock_batches"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_input_line_fk" FOREIGN KEY ("workspace_id","input_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_output_line_fk" FOREIGN KEY ("workspace_id","output_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_input_product_fk" FOREIGN KEY ("workspace_id","input_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_output_product_fk" FOREIGN KEY ("workspace_id","output_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_owner_fk" FOREIGN KEY ("workspace_id","owner_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batch_links" ADD CONSTRAINT "stock_batch_links_order_fk" FOREIGN KEY ("workspace_id","processing_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_batch_links_output_idx" ON "stock_batch_links" USING btree ("workspace_id","output_batch_id") WHERE "output_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_batch_links_input_idx" ON "stock_batch_links" USING btree ("workspace_id","input_batch_id") WHERE "input_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_batch_links_document_idx" ON "stock_batch_links" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "stock_batch_links_order_idx" ON "stock_batch_links" USING btree ("workspace_id","processing_order_id") WHERE "processing_order_id" is not null;--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_batch_links'::regclass);
