-- Задача 1187: партии и сроки годности.
-- Товар с флагом products.track_batches: приход создаёт партию (номер, дата выработки, годен до),
-- расход списывается по партиям FEFO — каждое движение ссылается на партию через stock_moves.batch_id.
-- Остаток партии — производное от движений (сумма qty по batch_id), отдельной таблицы остатков нет.
ALTER TABLE "products" ADD COLUMN "track_batches" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shelf_life_chk" CHECK ("products"."shelf_life_days" is null or "products"."shelf_life_days" > 0);--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"number" text NOT NULL,
	"produced_at" date,
	"expires_at" date,
	"document_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "stock_batches_number_chk" CHECK ("stock_batches"."number" <> '')
);
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "batch_number" text;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "batch_produced_at" date;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "batch_expires_at" date;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("document_line_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_batch_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "public"."stock_batches"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_key_uq" ON "stock_batches" USING btree ("workspace_id","warehouse_id","product_id","number");--> statement-breakpoint
CREATE INDEX "stock_batches_fefo_idx" ON "stock_batches" USING btree ("workspace_id","warehouse_id","product_id","expires_at");--> statement-breakpoint
CREATE INDEX "stock_batches_product_idx" ON "stock_batches" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_moves_batch_idx" ON "stock_moves" USING btree ("workspace_id","batch_id");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_batches'::regclass);
