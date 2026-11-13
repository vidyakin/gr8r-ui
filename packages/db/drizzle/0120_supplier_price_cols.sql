-- Прайсы поставщиков: две колонки цены (без НДС и с НДС) в профиле, две цены в строках.
-- Прежняя price_col → price_gross_col, если последний прайс профиля загружен с НДС или прайсов не было, иначе → price_net_col.
ALTER TABLE "supplier_price_profiles" ADD COLUMN "price_net_col" integer;--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD COLUMN "price_gross_col" integer;--> statement-breakpoint
UPDATE "supplier_price_profiles" p SET
	"price_gross_col" = CASE WHEN coalesce((SELECT sp."prices_include_vat" FROM "supplier_prices" sp WHERE sp."workspace_id" = p."workspace_id" AND sp."profile_id" = p."id" ORDER BY sp."created_at" DESC, sp."id" DESC LIMIT 1), true) THEN p."price_col" END,
	"price_net_col" = CASE WHEN coalesce((SELECT sp."prices_include_vat" FROM "supplier_prices" sp WHERE sp."workspace_id" = p."workspace_id" AND sp."profile_id" = p."id" ORDER BY sp."created_at" DESC, sp."id" DESC LIMIT 1), true) THEN NULL ELSE p."price_col" END;--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" DROP CONSTRAINT "supplier_price_profiles_cols_chk";--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" DROP COLUMN "price_col";--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD CONSTRAINT "supplier_price_profiles_cols_chk" CHECK ("first_row" >= 1 and "article_col" >= 1 and ("price_net_col" is not null or "price_gross_col" is not null) and ("price_net_col" is null or "price_net_col" >= 1) and ("price_gross_col" is null or "price_gross_col" >= 1) and ("name_col" is null or "name_col" >= 1) and ("unit_col" is null or "unit_col" >= 1));--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD COLUMN "price_net" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD COLUMN "price_gross" numeric(18, 2);--> statement-breakpoint
UPDATE "supplier_price_lines" l SET
	"price_gross" = CASE WHEN sp."prices_include_vat" THEN l."price" END,
	"price_net" = CASE WHEN sp."prices_include_vat" THEN NULL ELSE l."price" END
FROM "supplier_prices" sp WHERE sp."workspace_id" = l."workspace_id" AND sp."id" = l."price_id";--> statement-breakpoint
ALTER TABLE "supplier_price_lines" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "supplier_prices" DROP COLUMN "prices_include_vat";
