-- Загрузка прайсов поставщиков: профили формата файла, загруженные прайсы и их строки.
CREATE TABLE "supplier_price_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"first_row" integer DEFAULT 1 NOT NULL,
	"article_col" integer NOT NULL,
	"name_col" integer,
	"price_col" integer NOT NULL,
	"unit_col" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "supplier_price_profiles_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "supplier_price_profiles_cols_chk" CHECK ("first_row" >= 1 and "article_col" >= 1 and "price_col" >= 1 and ("name_col" is null or "name_col" >= 1) and ("unit_col" is null or "unit_col" >= 1))
);
--> statement-breakpoint
CREATE TABLE "supplier_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"prices_include_vat" boolean DEFAULT true NOT NULL,
	"attachment_id" uuid,
	"file_name" text DEFAULT '' NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"lines_total" integer DEFAULT 0 NOT NULL,
	"lines_matched" integer DEFAULT 0 NOT NULL,
	"lines_unmatched" integer DEFAULT 0 NOT NULL,
	"lines_conflict" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"applied_at" timestamp with time zone,
	CONSTRAINT "supplier_prices_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "supplier_prices_status_chk" CHECK ("status" in ('draft','applied'))
);
--> statement-breakpoint
CREATE TABLE "supplier_price_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"unit_code" text,
	"price" numeric(18, 2),
	"product_id" uuid,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "supplier_price_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "supplier_price_lines_status_chk" CHECK ("status" in ('matched','unmatched','conflict','skipped'))
);
--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD CONSTRAINT "supplier_price_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD CONSTRAINT "supplier_price_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_profiles" ADD CONSTRAINT "supplier_price_profiles_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."supplier_price_profiles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_kind_fk" FOREIGN KEY ("workspace_id","kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_attachment_fk" FOREIGN KEY ("workspace_id","attachment_id") REFERENCES "public"."attachments"("workspace_id","id") ON DELETE set null ("attachment_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_created_by_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE set null ("created_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD CONSTRAINT "supplier_price_lines_price_fk" FOREIGN KEY ("workspace_id","price_id") REFERENCES "public"."supplier_prices"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_lines" ADD CONSTRAINT "supplier_price_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE set null ("product_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_price_profiles_name_uq" ON "supplier_price_profiles" USING btree ("workspace_id","company_id",lower("name")) WHERE "supplier_price_profiles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "supplier_price_profiles_company_idx" ON "supplier_price_profiles" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "supplier_prices_company_idx" ON "supplier_prices" USING btree ("workspace_id","company_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_price_lines_price_idx" ON "supplier_price_lines" USING btree ("price_id","row_no");--> statement-breakpoint
SELECT app_secure_tenant_table('public.supplier_price_profiles'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.supplier_prices'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.supplier_price_lines'::regclass);
