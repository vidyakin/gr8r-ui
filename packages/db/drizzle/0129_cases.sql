-- Обращения клиентов (docs/architecture/cases.md): обращения, правила SLA, формы сайта, счётчик номеров, курсор «по кругу».
-- Пишется вручную (снимки meta/ после 0088 не ведутся).
CREATE TABLE "case_forms" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"default_owner_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_forms_ws_id_uq" UNIQUE("workspace_id","id")
);--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"owner_id" uuid,
	"deal_id" uuid,
	"work_order_id" uuid,
	"mailbox_id" uuid,
	"form_id" uuid,
	"first_response_due_at" timestamp with time zone,
	"resolve_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"first_response_breached_at" timestamp with time zone,
	"resolve_breached_at" timestamp with time zone,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "cases_status_chk" CHECK ("status" in ('new','in_progress','waiting','resolved','closed')),
	CONSTRAINT "cases_priority_chk" CHECK ("priority" in ('low','normal','high','urgent')),
	CONSTRAINT "cases_channel_chk" CHECK ("channel" in ('email','manual','web_form'))
);--> statement-breakpoint
CREATE TABLE "case_sla_rules" (
	"workspace_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"first_response_hours" integer NOT NULL,
	"resolve_hours" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_sla_rules_pk" PRIMARY KEY("workspace_id","priority"),
	CONSTRAINT "case_sla_rules_priority_chk" CHECK ("priority" in ('low','normal','high','urgent')),
	CONSTRAINT "case_sla_rules_hours_chk" CHECK ("first_response_hours" > 0 and "resolve_hours" > 0)
);--> statement-breakpoint
CREATE TABLE "case_counters" (
	"workspace_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "case_counters_pk" PRIMARY KEY("workspace_id","year")
);--> statement-breakpoint
CREATE TABLE "case_assign_cursor" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_member_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_rules" ADD CONSTRAINT "case_sla_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_counters" ADD CONSTRAINT "case_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assign_cursor" ADD CONSTRAINT "case_assign_cursor_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_owner_fk" FOREIGN KEY ("workspace_id","default_owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("default_owner_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assign_cursor" ADD CONSTRAINT "case_cursor_member_fk" FOREIGN KEY ("workspace_id","last_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("last_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE SET NULL ("company_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_lead_fk" FOREIGN KEY ("workspace_id","lead_id") REFERENCES "public"."leads"("workspace_id","id") ON DELETE SET NULL ("lead_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_owner_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("owner_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_deal_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE SET NULL ("deal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_work_order_fk" FOREIGN KEY ("workspace_id","work_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("work_order_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mailboxes"("workspace_id","id") ON DELETE SET NULL ("mailbox_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_form_fk" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."case_forms"("workspace_id","id") ON DELETE SET NULL ("form_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_forms_token_uq" ON "case_forms" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_ws_number_uq" ON "cases" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "cases_ws_status_idx" ON "cases" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "cases_ws_company_idx" ON "cases" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "cases_ws_contact_idx" ON "cases" USING btree ("workspace_id","contact_id");--> statement-breakpoint
CREATE INDEX "cases_ws_created_idx" ON "cases" USING btree ("workspace_id","created_at");--> statement-breakpoint
-- Привязка переписки, касаний и заказ-наряда к обращению; ящик принимает письма в обращения
ALTER TABLE "mailboxes" ADD COLUMN "create_cases_from_mail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "case_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_case_owner_fk" FOREIGN KEY ("workspace_id","case_owner_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("case_owner_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."cases"("workspace_id","id") ON DELETE SET NULL ("case_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_case_idx" ON "email_messages" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "ca_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."cases"("workspace_id","id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_case_idx" ON "crm_activities" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_fk" FOREIGN KEY ("workspace_id","case_id") REFERENCES "public"."cases"("workspace_id","id") ON DELETE SET NULL ("case_id") ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.cases'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.case_sla_rules'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.case_forms'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.case_counters'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.case_assign_cursor'::regclass);--> statement-breakpoint
-- Системная сущность конструктора «Обращения» (поле custom) для существующих воркспейсов
INSERT INTO entities (workspace_id, key, name, kind, icon, title_field, sort_order)
SELECT w.id, 'case', 'Cases', 'system', 'life-buoy', 'subject', 7 FROM workspaces w
ON CONFLICT (workspace_id, key) DO NOTHING;
