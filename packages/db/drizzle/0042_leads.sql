CREATE TABLE "lead_assign_cursor" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_member_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"default_owner_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_forms_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_statuses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'in_progress' NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_statuses_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "lead_statuses_category_chk" CHECK ("lead_statuses"."category" in ('new','in_progress','converted','rejected'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"phone_norm" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"email_norm" text DEFAULT '' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"status_id" uuid NOT NULL,
	"reject_reason" text DEFAULT '' NOT NULL,
	"form_id" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"converted_at" timestamp with time zone,
	"company_id" uuid,
	"contact_id" uuid,
	"deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "leads_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_assign_cursor" ADD CONSTRAINT "lead_assign_cursor_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assign_cursor" ADD CONSTRAINT "lead_cursor_member_fk" FOREIGN KEY ("workspace_id","last_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_owner_fk" FOREIGN KEY ("workspace_id","default_owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_statuses" ADD CONSTRAINT "lead_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_fk" FOREIGN KEY ("workspace_id","status_id") REFERENCES "public"."lead_statuses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_form_fk" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."lead_forms"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_deal_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_token_uq" ON "lead_forms" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_statuses_ws_name_uq" ON "lead_statuses" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "leads_ws_status_idx" ON "leads" USING btree ("workspace_id","status_id");--> statement-breakpoint
CREATE INDEX "leads_ws_phone_idx" ON "leads" USING btree ("workspace_id","phone_norm");--> statement-breakpoint
CREATE INDEX "leads_ws_email_idx" ON "leads" USING btree ("workspace_id","email_norm");--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "ca_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_lead_idx" ON "crm_activities" USING btree ("lead_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.lead_statuses'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.lead_forms'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.leads'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.lead_assign_cursor'::regclass);--> statement-breakpoint
-- Системная сущность конструктора «Лиды» (поле custom) для существующих воркспейсов
INSERT INTO entities (workspace_id, key, name, kind, icon, title_field, sort_order)
SELECT w.id, 'lead', 'Leads', 'system', 'user-plus', 'name', 6 FROM workspaces w
ON CONFLICT (workspace_id, key) DO NOTHING;--> statement-breakpoint
-- Статусы по умолчанию (категории new / in_progress / converted / rejected)
INSERT INTO lead_statuses (workspace_id, name, category, color, sort_order)
SELECT w.id, s.name, s.category, s.color, s.ord
FROM workspaces w
CROSS JOIN (VALUES
  ('New', 'new', 'blue', 0),
  ('Contacted', 'in_progress', 'amber', 1),
  ('Qualified', 'in_progress', 'violet', 2),
  ('Converted', 'converted', 'green', 3),
  ('Rejected', 'rejected', 'red', 4)
) AS s(name, category, color, ord)
ON CONFLICT DO NOTHING;