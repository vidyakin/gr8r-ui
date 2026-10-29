CREATE TABLE "ad_campaign_expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaign_expenses_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_id" uuid NOT NULL,
	"utm_campaign" text DEFAULT '' NOT NULL,
	"start_date" date,
	"end_date" date,
	"budget" numeric(18, 2) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ad_campaigns_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "lead_sources_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_campaign_expenses" ADD CONSTRAINT "ad_campaign_expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_expenses" ADD CONSTRAINT "ad_expenses_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_owner_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_expenses_ws_date_idx" ON "ad_campaign_expenses" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_ws_utm_uq" ON "ad_campaigns" USING btree ("workspace_id",lower("utm_campaign")) WHERE "ad_campaigns"."utm_campaign" <> '';--> statement-breakpoint
CREATE INDEX "ad_campaigns_ws_source_idx" ON "ad_campaigns" USING btree ("workspace_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_ws_name_uq" ON "lead_sources" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."lead_sources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_ws_source_idx" ON "leads" USING btree ("workspace_id","source_id","created_at");--> statement-breakpoint
SELECT app_secure_tenant_table('public.lead_sources'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.ad_campaigns'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.ad_campaign_expenses'::regclass);--> statement-breakpoint
-- Справочник источников из текстов лидов и форм (задача 1177); совпадение без учёта регистра, название — первое встреченное
INSERT INTO lead_sources (workspace_id, name, sort_order)
SELECT workspace_id, min(name), (row_number() OVER (PARTITION BY workspace_id ORDER BY lower(name)) - 1)::int
FROM (
  SELECT workspace_id, btrim(source) AS name FROM leads WHERE btrim(source) <> ''
  UNION ALL
  SELECT workspace_id, btrim(source) FROM lead_forms WHERE btrim(source) <> ''
) s
GROUP BY workspace_id, lower(name)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE leads l SET source_id = s.id, source = s.name
FROM lead_sources s WHERE s.workspace_id = l.workspace_id AND lower(s.name) = lower(btrim(l.source)) AND btrim(l.source) <> '';--> statement-breakpoint
UPDATE lead_forms f SET source_id = s.id, source = s.name
FROM lead_sources s WHERE s.workspace_id = f.workspace_id AND lower(s.name) = lower(btrim(f.source)) AND btrim(f.source) <> '';
