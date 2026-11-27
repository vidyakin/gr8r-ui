-- Комплекты товаров (набор как в УНФ, задача #1183): флаг is_kit у товара, состав product_kit_items и снимок распределения цены/себестоимости при проведении.
ALTER TABLE "products" ADD COLUMN "is_kit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_kit_kind_chk" CHECK (not "is_kit" or "kind" = 'goods');--> statement-breakpoint
CREATE TABLE "product_kit_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kit_product_id" uuid NOT NULL,
	"component_product_id" uuid NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"price_share" numeric(18, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_kit_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "product_kit_items_pair_uq" UNIQUE("workspace_id","kit_product_id","component_product_id"),
	CONSTRAINT "product_kit_items_self_chk" CHECK ("kit_product_id" <> "component_product_id"),
	CONSTRAINT "product_kit_items_qty_chk" CHECK ("qty" > 0),
	CONSTRAINT "product_kit_items_share_chk" CHECK ("price_share" is null or "price_share" >= 0)
);--> statement-breakpoint
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_kit_fk" FOREIGN KEY ("workspace_id","kit_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_component_fk" FOREIGN KEY ("workspace_id","component_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_kit_items_kit_idx" ON "product_kit_items" USING btree ("workspace_id","kit_product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_kit_items_comp_idx" ON "product_kit_items" USING btree ("workspace_id","component_product_id");--> statement-breakpoint
CREATE TABLE "document_line_kit_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid NOT NULL,
	"component_product_id" uuid NOT NULL,
	"qty_per_kit" numeric(18, 3) NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"price_share" numeric(18, 4),
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cogs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_line_kit_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "document_line_kit_items_line_comp_uq" UNIQUE("workspace_id","document_line_id","component_product_id"),
	CONSTRAINT "document_line_kit_items_qty_chk" CHECK ("qty_per_kit" > 0 and "qty" > 0)
);--> statement-breakpoint
ALTER TABLE "document_line_kit_items" ADD CONSTRAINT "document_line_kit_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_kit_items" ADD CONSTRAINT "document_line_kit_items_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_kit_items" ADD CONSTRAINT "document_line_kit_items_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_kit_items" ADD CONSTRAINT "document_line_kit_items_component_fk" FOREIGN KEY ("workspace_id","component_product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_line_kit_items_doc_idx" ON "document_line_kit_items" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "document_line_kit_items_line_idx" ON "document_line_kit_items" USING btree ("workspace_id","document_line_id","sort_order");--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_kit_items'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_line_kit_items'::regclass);
