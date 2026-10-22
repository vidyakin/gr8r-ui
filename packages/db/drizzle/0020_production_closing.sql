CREATE TABLE "other_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"work_center_id" uuid,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_cost_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "other_cost_lines_amount_chk" CHECK ("other_cost_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "period_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period" date NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"work_center_id" uuid,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"source" text NOT NULL,
	"document_id" uuid,
	"document_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_costs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "period_costs_amount_chk" CHECK ("period_costs"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_cost_closings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_cost_closings_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_cost_closings_status_chk" CHECK ("production_cost_closings"."status" in ('running','done','reopened','failed'))
);
--> statement-breakpoint
CREATE TABLE "stock_cost_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"move_id" uuid NOT NULL,
	"delta_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"own_delta" numeric(18, 4) DEFAULT '0' NOT NULL,
	"closing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_cost_adjustments_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "stock_cost_adjustments_delta_chk" CHECK ("stock_cost_adjustments"."delta_cost" <> 0 or "stock_cost_adjustments"."own_delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "closed_through" date;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "close_moves_lock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_items" ADD COLUMN "distribution_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "cost_item_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "work_center_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "work_center_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_ws_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "other_cost_lines" ADD CONSTRAINT "other_cost_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_cost_lines" ADD CONSTRAINT "other_cost_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_cost_lines" ADD CONSTRAINT "other_cost_lines_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_cost_lines" ADD CONSTRAINT "other_cost_lines_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_costs" ADD CONSTRAINT "period_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_costs" ADD CONSTRAINT "period_costs_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_costs" ADD CONSTRAINT "period_costs_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_costs" ADD CONSTRAINT "period_costs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_costs" ADD CONSTRAINT "period_costs_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cost_closings" ADD CONSTRAINT "production_cost_closings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_adjustments" ADD CONSTRAINT "stock_cost_adjustments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_adjustments" ADD CONSTRAINT "stock_cost_adjustments_move_fk" FOREIGN KEY ("workspace_id","move_id") REFERENCES "public"."stock_moves"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_cost_adjustments" ADD CONSTRAINT "stock_cost_adjustments_closing_fk" FOREIGN KEY ("workspace_id","closing_id") REFERENCES "public"."production_cost_closings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_cost_lines_document_idx" ON "other_cost_lines" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "period_costs_line_uq" ON "period_costs" USING btree ("workspace_id","document_line_id") WHERE "period_costs"."document_line_id" is not null;--> statement-breakpoint
CREATE INDEX "period_costs_period_idx" ON "period_costs" USING btree ("workspace_id","period");--> statement-breakpoint
CREATE INDEX "period_costs_document_idx" ON "period_costs" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_cost_closings_period_uq" ON "production_cost_closings" USING btree ("workspace_id","period");--> statement-breakpoint
CREATE INDEX "production_cost_closings_period_idx" ON "production_cost_closings" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_cost_adjustments_move_uq" ON "stock_cost_adjustments" USING btree ("workspace_id","move_id");--> statement-breakpoint
CREATE INDEX "stock_cost_adjustments_closing_idx" ON "stock_cost_adjustments" USING btree ("closing_id");--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_lines_cost_item_idx" ON "document_lines" USING btree ("cost_item_id");--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_distribution_chk" CHECK ("cost_items"."distribution_method" in ('none','output_qty','direct_costs','work_hours'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs'));--> statement-breakpoint
-- Заполнение существующих данных: способ распределения у уже заведённых статей = 'none' (задаёт DEFAULT колонки),
-- а строки документов ещё не несут статью затрат (document_lines.cost_item_id только что добавлена), поэтому косвенных
-- затрат у ранее проведённых поступлений и списаний до этой миграции нет — их наберёт следующее проведение.
-- Дата запрета редактирования (workspaces.closed_through) по умолчанию пуста: месяцы остаются открытыми.
-- Участок в шапке (списание на участок) и в строке документа (строка-услуга поступления): составные FK вручную —
-- схема документов не импортирует схему производства (цикл импорта), как и у резервов в 0019.
ALTER TABLE "documents" ADD CONSTRAINT "documents_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.period_costs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_cost_closings'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_cost_adjustments'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.other_cost_lines'::regclass);
