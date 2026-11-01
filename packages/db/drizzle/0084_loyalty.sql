CREATE TABLE "discount_rule_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "discount_rule_categories_rule_category_uq" UNIQUE("rule_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "discount_rule_customers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	CONSTRAINT "discount_rule_customers_rule_customer_uq" UNIQUE("rule_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "discount_rule_price_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"price_kind_id" uuid NOT NULL,
	CONSTRAINT "discount_rule_price_kinds_rule_kind_uq" UNIQUE("rule_id","price_kind_id")
);
--> statement-breakpoint
CREATE TABLE "discount_rule_products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "discount_rule_products_rule_product_uq" UNIQUE("rule_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"discount_pct" numeric(7, 2) NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"promo_only" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"weekdays" integer[] DEFAULT '{}' NOT NULL,
	"time_from" time,
	"time_to" time,
	"min_document_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"min_line_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "discount_rules_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "discount_rules_pct_chk" CHECK ("discount_rules"."discount_pct" >= 0 and "discount_rules"."discount_pct" <= 100),
	CONSTRAINT "discount_rules_amount_chk" CHECK ("discount_rules"."min_document_amount" >= 0 and "discount_rules"."min_line_qty" >= 0),
	CONSTRAINT "discount_rules_period_chk" CHECK ("discount_rules"."valid_from" is null or "discount_rules"."valid_to" is null or "discount_rules"."valid_from" <= "discount_rules"."valid_to"),
	CONSTRAINT "discount_rules_time_chk" CHECK (("discount_rules"."time_from" is null) = ("discount_rules"."time_to" is null))
);
--> statement-breakpoint
CREATE TABLE "document_line_discounts" (
	"line_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"rule_id" uuid,
	"card_id" uuid,
	CONSTRAINT "document_line_discounts_ws_line_uq" UNIQUE("workspace_id","line_id"),
	CONSTRAINT "document_line_discounts_source_chk" CHECK ("document_line_discounts"."source" in ('manual','rule','card')),
	CONSTRAINT "document_line_discounts_rule_src_chk" CHECK ("document_line_discounts"."source" = 'rule' or "document_line_discounts"."rule_id" is null),
	CONSTRAINT "document_line_discounts_card_src_chk" CHECK ("document_line_discounts"."source" = 'card' or "document_line_discounts"."card_id" is null)
);
--> statement-breakpoint
CREATE TABLE "document_loyalty" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"promo_code_id" uuid,
	"loyalty_card_id" uuid,
	"points_redeemed" numeric(18, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "document_loyalty_ws_doc_uq" UNIQUE("workspace_id","document_id"),
	CONSTRAINT "document_loyalty_points_chk" CHECK ("document_loyalty"."points_redeemed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"discount_pct" numeric(7, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "loyalty_cards_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "loyalty_cards_kind_chk" CHECK ("loyalty_cards"."kind" in ('discount','bonus','cumulative')),
	CONSTRAINT "loyalty_cards_discount_pct_chk" CHECK (("loyalty_cards"."kind" = 'discount') = ("loyalty_cards"."discount_pct" is not null)),
	CONSTRAINT "loyalty_cards_discount_pct_range_chk" CHECK ("loyalty_cards"."discount_pct" is null or ("loyalty_cards"."discount_pct" >= 0 and "loyalty_cards"."discount_pct" <= 100))
);
--> statement-breakpoint
CREATE TABLE "loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"accrual_pct" numeric(7, 2) DEFAULT '0' NOT NULL,
	"redemption_limit_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"expiration_days" integer,
	"cumulative_scale" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_programs_ws_uq" UNIQUE("workspace_id"),
	CONSTRAINT "loyalty_programs_pct_chk" CHECK ("loyalty_programs"."accrual_pct" >= 0 and "loyalty_programs"."accrual_pct" <= 100),
	CONSTRAINT "loyalty_programs_limit_chk" CHECK ("loyalty_programs"."redemption_limit_pct" >= 0 and "loyalty_programs"."redemption_limit_pct" <= 100),
	CONSTRAINT "loyalty_programs_expiration_chk" CHECK ("loyalty_programs"."expiration_days" is null or "loyalty_programs"."expiration_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"document_id" uuid,
	"kind" text NOT NULL,
	"points" numeric(18, 2) NOT NULL,
	"expires_at" timestamp with time zone,
	"reverses_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_transactions_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "loyalty_transactions_kind_chk" CHECK ("loyalty_transactions"."kind" in ('accrual','redemption','expiration','reversal'))
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "promo_codes_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "promo_codes_usage_chk" CHECK ("promo_codes"."usage_count" >= 0 and ("promo_codes"."usage_limit" is null or "promo_codes"."usage_limit" >= 0)),
	CONSTRAINT "promo_codes_period_chk" CHECK ("promo_codes"."valid_from" is null or "promo_codes"."valid_to" is null or "promo_codes"."valid_from" <= "promo_codes"."valid_to")
);
--> statement-breakpoint
ALTER TABLE "discount_rule_categories" ADD CONSTRAINT "discount_rule_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_categories" ADD CONSTRAINT "discount_rule_categories_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_categories" ADD CONSTRAINT "discount_rule_categories_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."product_categories"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_customers" ADD CONSTRAINT "discount_rule_customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_customers" ADD CONSTRAINT "discount_rule_customers_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_customers" ADD CONSTRAINT "discount_rule_customers_customer_fk" FOREIGN KEY ("workspace_id","customer_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_price_kinds" ADD CONSTRAINT "discount_rule_price_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_price_kinds" ADD CONSTRAINT "discount_rule_price_kinds_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_price_kinds" ADD CONSTRAINT "discount_rule_price_kinds_kind_fk" FOREIGN KEY ("workspace_id","price_kind_id") REFERENCES "public"."price_kinds"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_products" ADD CONSTRAINT "discount_rule_products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_products" ADD CONSTRAINT "discount_rule_products_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule_products" ADD CONSTRAINT "discount_rule_products_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_discounts" ADD CONSTRAINT "document_line_discounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_discounts" ADD CONSTRAINT "document_line_discounts_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_discounts" ADD CONSTRAINT "document_line_discounts_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE set null ("rule_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line_discounts" ADD CONSTRAINT "document_line_discounts_card_fk" FOREIGN KEY ("workspace_id","card_id") REFERENCES "public"."loyalty_cards"("workspace_id","id") ON DELETE set null ("card_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_loyalty" ADD CONSTRAINT "document_loyalty_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_loyalty" ADD CONSTRAINT "document_loyalty_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_loyalty" ADD CONSTRAINT "document_loyalty_promo_fk" FOREIGN KEY ("workspace_id","promo_code_id") REFERENCES "public"."promo_codes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_loyalty" ADD CONSTRAINT "document_loyalty_card_fk" FOREIGN KEY ("workspace_id","loyalty_card_id") REFERENCES "public"."loyalty_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_customer_fk" FOREIGN KEY ("workspace_id","customer_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_card_fk" FOREIGN KEY ("workspace_id","card_id") REFERENCES "public"."loyalty_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE set null ("document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_reverses_fk" FOREIGN KEY ("workspace_id","reverses_id") REFERENCES "public"."loyalty_transactions"("workspace_id","id") ON DELETE set null ("reverses_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_rule_fk" FOREIGN KEY ("workspace_id","rule_id") REFERENCES "public"."discount_rules"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_rule_categories_rule_idx" ON "discount_rule_categories" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "discount_rule_customers_rule_idx" ON "discount_rule_customers" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "discount_rule_price_kinds_rule_idx" ON "discount_rule_price_kinds" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "discount_rule_products_rule_idx" ON "discount_rule_products" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_rules_ws_name_uq" ON "discount_rules" USING btree ("workspace_id",lower("name")) WHERE "discount_rules"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_cards_ws_number_uq" ON "loyalty_cards" USING btree ("workspace_id",lower("number"));--> statement-breakpoint
CREATE INDEX "loyalty_cards_customer_idx" ON "loyalty_cards" USING btree ("workspace_id","customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_transactions_card_idx" ON "loyalty_transactions" USING btree ("workspace_id","card_id","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_transactions_document_idx" ON "loyalty_transactions" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE INDEX "loyalty_transactions_expires_idx" ON "loyalty_transactions" USING btree ("workspace_id","kind","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_ws_code_uq" ON "promo_codes" USING btree ("workspace_id",lower("code"));--> statement-breakpoint
SELECT app_secure_tenant_table('public.discount_rules'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.discount_rule_customers'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.discount_rule_price_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.discount_rule_products'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.discount_rule_categories'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.promo_codes'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.loyalty_programs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.loyalty_cards'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.loyalty_transactions'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_loyalty'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_line_discounts'::regclass);
