CREATE TABLE "attribute_defs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_defs_cat_key_uq" UNIQUE("category_id","key")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'goods' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"vat_rate" text DEFAULT '20' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"purchase_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"category_id" uuid,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "products_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "products_kind_chk" CHECK ("products"."kind" in ('goods','service')),
	CONSTRAINT "products_vat_chk" CHECK ("products"."vat_rate" in ('none','0','5','7','10','20')),
	CONSTRAINT "products_price_chk" CHECK ("products"."price" >= 0 and "products"."purchase_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_ws_code_uq" UNIQUE("workspace_id","code")
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"child_item_id" uuid,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"unit_code" text,
	"scrap_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"operation" text DEFAULT '' NOT NULL,
	"work_center_id" uuid,
	"hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"rate" numeric(18, 2),
	"fixed_cost" numeric(18, 2),
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_lines_kind_chk" CHECK ("bom_lines"."kind" in ('material','semi','work')),
	CONSTRAINT "bom_lines_shape_chk" CHECK (("bom_lines"."kind" = 'material' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'semi' and "bom_lines"."child_item_id" is not null and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" <> "bom_lines"."item_id")
        or ("bom_lines"."kind" = 'work' and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" is null)),
	CONSTRAINT "bom_lines_nonneg_chk" CHECK ("bom_lines"."qty" >= 0 and "bom_lines"."scrap_pct" >= 0 and "bom_lines"."hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "manufactured_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'product' NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"product_id" uuid,
	"batch_qty" numeric(18, 3) DEFAULT '1' NOT NULL,
	"overhead_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "manufactured_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "manufactured_items_kind_chk" CHECK ("manufactured_items"."kind" in ('product','semi')),
	CONSTRAINT "manufactured_items_batch_chk" CHECK ("manufactured_items"."batch_qty" > 0 and "manufactured_items"."overhead_pct" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"hourly_rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "work_centers_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "work_centers_rate_chk" CHECK ("work_centers"."hourly_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attribute_defs" ADD CONSTRAINT "attribute_defs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_defs" ADD CONSTRAINT "attribute_defs_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."product_categories"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."product_categories"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."product_categories"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_child_fk" FOREIGN KEY ("workspace_id","child_item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_categories_path_idx" ON "product_categories" USING btree ("workspace_id","path" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "products_ws_sku_uq" ON "products" USING btree ("workspace_id",lower("sku")) WHERE "products"."sku" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "products_ws_barcode_uq" ON "products" USING btree ("workspace_id","barcode") WHERE "products"."barcode" <> '';--> statement-breakpoint
CREATE INDEX "products_ws_category_idx" ON "products" USING btree ("workspace_id","category_id");--> statement-breakpoint
CREATE INDEX "bom_lines_item_idx" ON "bom_lines" USING btree ("item_id","sort_order");--> statement-breakpoint
CREATE INDEX "bom_lines_child_idx" ON "bom_lines" USING btree ("child_item_id");--> statement-breakpoint
CREATE INDEX "bom_lines_product_idx" ON "bom_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufactured_items_ws_code_uq" ON "manufactured_items" USING btree ("workspace_id",lower("code")) WHERE "manufactured_items"."code" <> '';--> statement-breakpoint

-- Изоляция арендаторов: как у остальных таблиц (владелец app_owner, ENABLE + FORCE RLS, политика по workspace_id, права ролям)
SELECT app_secure_tenant_table('public.units'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_categories'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.attribute_defs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.products'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.work_centers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.manufactured_items'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.bom_lines'::regclass);--> statement-breakpoint

-- Для уже существующих воркспейсов: базовый набор единиц ОКЕИ и системная сущность «Товары» конструктора
-- (новым воркспейсам их создаёт код при регистрации)
INSERT INTO units (workspace_id, code, name, symbol, is_base)
SELECT w.id, u.code, u.name, u.symbol, true
FROM workspaces w
CROSS JOIN (VALUES
  ('796', 'Штука', 'шт', 0),
  ('778', 'Упаковка', 'упак', 1),
  ('704', 'Набор', 'набор', 2),
  ('625', 'Лист', 'лист', 3),
  ('736', 'Рулон', 'рул', 4),
  ('166', 'Килограмм', 'кг', 5),
  ('163', 'Грамм', 'г', 6),
  ('168', 'Тонна', 'т', 7),
  ('112', 'Литр', 'л', 8),
  ('111', 'Миллилитр', 'мл', 9),
  ('006', 'Метр', 'м', 10),
  ('004', 'Сантиметр', 'см', 11),
  ('003', 'Миллиметр', 'мм', 12),
  ('055', 'Квадратный метр', 'м²', 13),
  ('113', 'Кубический метр', 'м³', 14),
  ('356', 'Час', 'ч', 15),
  ('359', 'Сутки', 'сут', 16),
  ('362', 'Месяц', 'мес', 17),
  ('876', 'Условная единица', 'усл. ед', 18)
) AS u(code, name, symbol, ord)
ON CONFLICT (workspace_id, code) DO NOTHING;--> statement-breakpoint
INSERT INTO entities (workspace_id, key, name, kind, icon, title_field, sort_order)
SELECT w.id, 'product', 'Products', 'system', 'package', 'name', 5 FROM workspaces w
ON CONFLICT (workspace_id, key) DO NOTHING;
