-- Номенклатура и коды контрагентов (docs/architecture/counterparties.md).
-- counterparty_codes: наш код у контрагента по каждой нашей организации.
-- product_partner_articles: артикул и наименование товара у контрагента (как «Номенклатура поставщиков» в 1С).

CREATE TABLE "counterparty_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparty_codes_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "counterparty_codes_company_org_uq" UNIQUE("workspace_id","company_id","organization_id"),
	CONSTRAINT "counterparty_codes_code_chk" CHECK (char_length("counterparty_codes"."code") between 1 and 64)
);--> statement-breakpoint
CREATE TABLE "product_partner_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_partner_articles_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "product_partner_articles_company_product_uq" UNIQUE("workspace_id","company_id","product_id"),
	CONSTRAINT "product_partner_articles_len_chk" CHECK (char_length("product_partner_articles"."article") <= 100 and char_length("product_partner_articles"."name") <= 300 and ("product_partner_articles"."article" <> '' or "product_partner_articles"."name" <> ''))
);--> statement-breakpoint
ALTER TABLE "counterparty_codes" ADD CONSTRAINT "counterparty_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparty_codes" ADD CONSTRAINT "counterparty_codes_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparty_codes" ADD CONSTRAINT "counterparty_codes_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_partner_articles" ADD CONSTRAINT "product_partner_articles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_partner_articles" ADD CONSTRAINT "product_partner_articles_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_partner_articles" ADD CONSTRAINT "product_partner_articles_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counterparty_codes_org_idx" ON "counterparty_codes" USING btree ("workspace_id","organization_id");--> statement-breakpoint
CREATE INDEX "product_partner_articles_product_idx" ON "product_partner_articles" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "product_partner_articles_article_idx" ON "product_partner_articles" USING btree ("workspace_id","company_id","article");--> statement-breakpoint

SELECT app_secure_tenant_table('public.counterparty_codes'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_partner_articles'::regclass);
