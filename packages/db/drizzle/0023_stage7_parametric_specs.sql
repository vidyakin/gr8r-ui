CREATE TABLE "order_calculation_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"calculation_id" uuid NOT NULL,
	"document_line_id" uuid,
	"kind" text NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 2),
	"note" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_calculation_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "order_calculation_lines_kind_chk" CHECK ("order_calculation_lines"."kind" in ('material','semi','work','expense','extra')),
	CONSTRAINT "order_calculation_lines_qty_chk" CHECK ("order_calculation_lines"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_calculations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"price_source" text DEFAULT 'avg' NOT NULL,
	"markup_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"cost_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_cost_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"price_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_calculations_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "order_calculations_source_chk" CHECK ("order_calculations"."price_source" in ('avg','last_purchase','purchase_price')),
	CONSTRAINT "order_calculations_markup_chk" CHECK ("order_calculations"."markup_pct" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_kind_chk";--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_shape_chk";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "parent_product_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "qty_expr" text;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD COLUMN "params" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD COLUMN "is_invalid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "product_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order_calculation_lines" ADD CONSTRAINT "order_calculation_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_calculation_lines" ADD CONSTRAINT "order_calculation_lines_calculation_fk" FOREIGN KEY ("workspace_id","calculation_id") REFERENCES "public"."order_calculations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_calculation_lines" ADD CONSTRAINT "order_calculation_lines_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_calculation_lines" ADD CONSTRAINT "order_calculation_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_calculations" ADD CONSTRAINT "order_calculations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_calculations" ADD CONSTRAINT "order_calculations_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_calculation_lines_calculation_idx" ON "order_calculation_lines" USING btree ("calculation_id","sort_order");--> statement-breakpoint
CREATE INDEX "order_calculation_lines_line_idx" ON "order_calculation_lines" USING btree ("document_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_calculations_document_uq" ON "order_calculations" USING btree ("workspace_id","document_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_parent_fk" FOREIGN KEY ("workspace_id","parent_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_variant_fk" FOREIGN KEY ("workspace_id","product_variant_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_variant_uq" ON "products" USING btree ("workspace_id","parent_product_id","variant_values") WHERE "products"."parent_product_id" is not null;--> statement-breakpoint
CREATE INDEX "products_parent_idx" ON "products" USING btree ("workspace_id","parent_product_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_parent_chk" CHECK ("products"."parent_product_id" is null or "products"."parent_product_id" <> "products"."id");--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_expr_chk" CHECK (length(coalesce("bom_lines"."qty_expr", '')) <= 500 and length(coalesce("bom_lines"."condition", '')) <= 500);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_kind_chk" CHECK ("bom_lines"."kind" in ('material','semi','work','expense'));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_shape_chk" CHECK (("bom_lines"."kind" = 'material' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'expense' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'semi' and "bom_lines"."child_item_id" is not null and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" <> "bom_lines"."item_id")
        or ("bom_lines"."kind" = 'work' and "bom_lines"."child_item_id" is null));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_kind_chk" CHECK ("production_components"."kind" in ('material','semi','work','expense'));--> statement-breakpoint
SELECT app_secure_tenant_table('public.order_calculations'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.order_calculation_lines'::regclass);