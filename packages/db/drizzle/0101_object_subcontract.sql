-- Задача 1274: субподряд на объекте (docs/architecture/construction.md). Заказ субподрядчику — документ supplier_order
-- с object_id (создаётся из сметы, задача 1269), отдельной таблицы нет. Акт субподрядчика — документ подрядчика
-- с приёмкой: draft → accepted | rejected. Строки акта — предъявлено и принято (accepted_qty ≤ qty), причина отклонения —
-- справочник причин брака defect_reasons. Материалы акта списываются со склада объекта при приёмке.
CREATE TABLE "object_sub_acts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"order_id" uuid,
	"number" text DEFAULT '' NOT NULL,
	"doc_number" text DEFAULT '' NOT NULL,
	"doc_date" date NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"reject_reason" text DEFAULT '' NOT NULL,
	"receipt_document_id" uuid,
	"write_off_document_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_sub_acts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_sub_acts_status_chk" CHECK ("object_sub_acts"."status" in ('draft','accepted','rejected')),
	CONSTRAINT "object_sub_acts_period_chk" CHECK ("object_sub_acts"."period_from" <= "object_sub_acts"."period_to"),
	CONSTRAINT "object_sub_acts_state_chk" CHECK (("object_sub_acts"."status" = 'draft' and "object_sub_acts"."accepted_at" is null and "object_sub_acts"."rejected_at" is null) or ("object_sub_acts"."status" = 'accepted' and "object_sub_acts"."accepted_at" is not null) or ("object_sub_acts"."status" = 'rejected' and "object_sub_acts"."rejected_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_sub_acts_ws_number_uq" ON "object_sub_acts" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "object_sub_acts_object_idx" ON "object_sub_acts" USING btree ("workspace_id","object_id","doc_date");--> statement-breakpoint
CREATE INDEX "object_sub_acts_order_idx" ON "object_sub_acts" USING btree ("workspace_id","order_id");--> statement-breakpoint
CREATE INDEX "object_sub_acts_counterparty_idx" ON "object_sub_acts" USING btree ("workspace_id","counterparty_id");--> statement-breakpoint
CREATE TABLE "object_sub_act_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"act_id" uuid NOT NULL,
	"estimate_item_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"qty" numeric(18,3) NOT NULL,
	"price" numeric(18,2) DEFAULT '0' NOT NULL,
	"accepted_qty" numeric(18,3) DEFAULT '0' NOT NULL,
	"defect_reason_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_sub_act_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_sub_act_lines_qty_chk" CHECK ("object_sub_act_lines"."qty" > 0 and "object_sub_act_lines"."price" >= 0 and "object_sub_act_lines"."accepted_qty" >= 0 and "object_sub_act_lines"."accepted_qty" <= "object_sub_act_lines"."qty")
);
--> statement-breakpoint
CREATE INDEX "object_sub_act_lines_act_idx" ON "object_sub_act_lines" USING btree ("act_id","sort_order");--> statement-breakpoint
CREATE INDEX "object_sub_act_lines_item_idx" ON "object_sub_act_lines" USING btree ("workspace_id","estimate_item_id");--> statement-breakpoint
CREATE TABLE "object_sub_act_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"act_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18,3) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_sub_act_materials_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_sub_act_materials_qty_chk" CHECK ("object_sub_act_materials"."qty" > 0)
);
--> statement-breakpoint
CREATE INDEX "object_sub_act_materials_act_idx" ON "object_sub_act_materials" USING btree ("act_id");--> statement-breakpoint
CREATE INDEX "object_sub_act_materials_product_idx" ON "object_sub_act_materials" USING btree ("workspace_id","product_id");--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_order_fk" FOREIGN KEY ("workspace_id","order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("order_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_accepted_by_fk" FOREIGN KEY ("workspace_id","accepted_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("accepted_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_rejected_by_fk" FOREIGN KEY ("workspace_id","rejected_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("rejected_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_created_by_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("created_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_receipt_document_fk" FOREIGN KEY ("workspace_id","receipt_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("receipt_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_acts" ADD CONSTRAINT "object_sub_acts_write_off_document_fk" FOREIGN KEY ("workspace_id","write_off_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("write_off_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_lines" ADD CONSTRAINT "object_sub_act_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_lines" ADD CONSTRAINT "object_sub_act_lines_act_fk" FOREIGN KEY ("workspace_id","act_id") REFERENCES "public"."object_sub_acts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_lines" ADD CONSTRAINT "object_sub_act_lines_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE SET NULL ("estimate_item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_lines" ADD CONSTRAINT "object_sub_act_lines_reason_fk" FOREIGN KEY ("workspace_id","defect_reason_id") REFERENCES "public"."defect_reasons"("workspace_id","id") ON DELETE SET NULL ("defect_reason_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_lines" ADD CONSTRAINT "object_sub_act_lines_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_materials" ADD CONSTRAINT "object_sub_act_materials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_materials" ADD CONSTRAINT "object_sub_act_materials_act_fk" FOREIGN KEY ("workspace_id","act_id") REFERENCES "public"."object_sub_acts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sub_act_materials" ADD CONSTRAINT "object_sub_act_materials_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_sub_acts'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_sub_act_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_sub_act_materials'::regclass);
