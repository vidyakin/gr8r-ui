CREATE TABLE "production_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"is_semi" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_plan_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_plan_lines_qty_chk" CHECK ("production_plan_lines"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"step" text DEFAULT 'week' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"work_center_id" uuid,
	"semi_dirty" boolean DEFAULT false NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "production_plans_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_plans_dates_chk" CHECK ("production_plans"."period_to" >= "production_plans"."period_from"),
	CONSTRAINT "production_plans_step_chk" CHECK ("production_plans"."step" in ('week','month')),
	CONSTRAINT "production_plans_status_chk" CHECK ("production_plans"."status" in ('draft','approved'))
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"min_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"max_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"replenishment" text DEFAULT 'purchase' NOT NULL,
	"source_warehouse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "stock_levels_qty_chk" CHECK ("stock_levels"."min_qty" >= 0 and "stock_levels"."max_qty" >= "stock_levels"."min_qty"),
	CONSTRAINT "stock_levels_replenishment_chk" CHECK ("stock_levels"."replenishment" in ('purchase','production','transfer')),
	CONSTRAINT "stock_levels_transfer_chk" CHECK ("stock_levels"."replenishment" <> 'transfer' or ("stock_levels"."warehouse_id" is not null and "stock_levels"."source_warehouse_id" is not null and "stock_levels"."source_warehouse_id" <> "stock_levels"."warehouse_id"))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "lead_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD COLUMN "lead_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "plan_line_id" uuid;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_plan_fk" FOREIGN KEY ("workspace_id","plan_id") REFERENCES "public"."production_plans"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_source_fk" FOREIGN KEY ("workspace_id","source_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_plan_lines_plan_idx" ON "production_plan_lines" USING btree ("plan_id","sort_order");--> statement-breakpoint
CREATE INDEX "production_plan_lines_item_idx" ON "production_plan_lines" USING btree ("item_id","period_start");--> statement-breakpoint
CREATE INDEX "production_plans_period_idx" ON "production_plans" USING btree ("workspace_id","period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_wh_uq" ON "stock_levels" USING btree ("workspace_id","product_id","warehouse_id") WHERE "stock_levels"."warehouse_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_company_uq" ON "stock_levels" USING btree ("workspace_id","product_id") WHERE "stock_levels"."warehouse_id" is null;--> statement-breakpoint
CREATE INDEX "stock_levels_product_idx" ON "stock_levels" USING btree ("workspace_id","product_id");--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_plan_line_fk" FOREIGN KEY ("workspace_id","plan_line_id") REFERENCES "public"."production_plan_lines"("workspace_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_items_plan_line_idx" ON "production_items" USING btree ("plan_line_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_lead_chk" CHECK ("products"."lead_days" >= 0);--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_lead_chk" CHECK ("manufactured_items"."lead_days" >= 0);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_plans'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_plan_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.stock_levels'::regclass);
