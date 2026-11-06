-- Задача 1186: контроль качества (ОТК).
-- Справочник причин брака defect_reasons и анализы партий batch_analyses (входной контроль сырья).
-- Позиции выпуска получают причину брака, виновного и примечание ОТК (production_items).
-- Склад получает вид «карантин» (входной контроль): расход с него запрещён, перемещение разрешено.
ALTER TABLE "production_items" ADD COLUMN "defect_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "defect_member_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "qc_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_status_chk" CHECK ("stock_batches"."status" in ('ok','quarantine','rejected'));--> statement-breakpoint
CREATE TABLE "defect_reasons" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "defect_reasons_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "batch_analyses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"indicator" text NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"norm" text DEFAULT '' NOT NULL,
	"passed" boolean,
	"analyzed_at" date NOT NULL,
	"created_by" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_analyses_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "batch_analyses_indicator_chk" CHECK ("batch_analyses"."indicator" <> '')
);
--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_defect_reason_fk" FOREIGN KEY ("workspace_id","defect_reason_id") REFERENCES "public"."defect_reasons"("workspace_id","id") ON DELETE SET NULL ("defect_reason_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_defect_member_fk" FOREIGN KEY ("workspace_id","defect_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("defect_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_analyses" ADD CONSTRAINT "batch_analyses_batch_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "public"."stock_batches"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_analyses" ADD CONSTRAINT "batch_analyses_member_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("created_by") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "defect_reasons_ws_name_uq" ON "defect_reasons" USING btree ("workspace_id", lower("name")) WHERE "defect_reasons"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "batch_analyses_batch_idx" ON "batch_analyses" USING btree ("workspace_id","batch_id","analyzed_at");--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_kind_chk" CHECK ("warehouses"."kind" in ('warehouse','workshop','transit','quarantine'));--> statement-breakpoint
SELECT app_secure_tenant_table('public.defect_reasons'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.batch_analyses'::regclass);
