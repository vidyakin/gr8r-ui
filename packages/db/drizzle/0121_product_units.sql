-- Упаковки товара (единицы с коэффициентом, docs/plans/2026-11-14-product-packages.md): «ящик = 100 шт».
-- Строка документа хранит коэффициент своей единицы, количество — в базовых единицах; цена вида цен и строка прайса — за свою единицу.
CREATE TABLE "product_units" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"factor" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_units_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "product_units_product_unit_uq" UNIQUE("workspace_id","product_id","unit_code"),
	CONSTRAINT "product_units_factor_chk" CHECK ("factor" > 0)
);--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "unit_factor" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_unit_factor_chk" CHECK ("unit_factor" > 0);--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "unit_code" text;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "unit_factor" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_unit_factor_chk" CHECK ("unit_factor" > 0);--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD COLUMN "factor_col" integer;--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" DROP CONSTRAINT "supplier_price_profiles_cols_chk";--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD CONSTRAINT "supplier_price_profiles_cols_chk" CHECK ("first_row" >= 1 and "article_col" >= 1 and ("price_net_col" is not null or "price_gross_col" is not null) and ("price_net_col" is null or "price_net_col" >= 1) and ("price_gross_col" is null or "price_gross_col" >= 1) and ("name_col" is null or "name_col" >= 1) and ("unit_col" is null or "unit_col" >= 1) and ("factor_col" is null or "factor_col" >= 1));--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD COLUMN "unit_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD CONSTRAINT "supplier_price_lines_unit_factor_chk" CHECK ("unit_factor" is null or "unit_factor" > 0);--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_units'::regclass);
