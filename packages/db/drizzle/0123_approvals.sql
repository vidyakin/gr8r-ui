-- Согласование по маршрутам (задача 1199, docs/plans/2026-11-16-approvals.md). Миграция написана вручную: снимки meta/ не ведутся.
CREATE TABLE "approval_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_kind" text DEFAULT 'document' NOT NULL,
	"document_type" text,
	"organization_id" uuid,
	"amount_from" numeric(18, 2),
	"amount_to" numeric(18, 2),
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "approval_routes_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "approval_routes_kind_chk" CHECK ("target_kind" in ('document','contract')),
	CONSTRAINT "approval_routes_type_chk" CHECK ("target_kind" = 'document' or "document_type" is null),
	CONSTRAINT "approval_routes_amount_chk" CHECK ("amount_from" is null or "amount_to" is null or "amount_to" >= "amount_from")
);--> statement-breakpoint
CREATE TABLE "approval_route_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'sequential' NOT NULL,
	"due_hours" integer,
	CONSTRAINT "approval_route_steps_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "approval_route_steps_mode_chk" CHECK ("mode" in ('sequential','parallel')),
	CONSTRAINT "approval_route_steps_due_chk" CHECK ("due_hours" is null or "due_hours" > 0)
);--> statement-breakpoint
CREATE TABLE "approval_route_participants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"member_id" uuid,
	"position_id" uuid,
	CONSTRAINT "approval_route_participants_one_chk" CHECK (("member_id" is not null) <> ("position_id" is not null))
);--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"document_id" uuid,
	"contract_id" uuid,
	"route_id" uuid,
	"route_name" text DEFAULT '' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"approved_fingerprint" text,
	"author_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "approvals_kind_chk" CHECK ("target_kind" in ('document','contract')),
	CONSTRAINT "approvals_object_chk" CHECK (("document_id" is not null) <> ("contract_id" is not null)),
	CONSTRAINT "approvals_state_chk" CHECK ("state" in ('in_progress','approved','rejected','cancelled'))
);--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"group_key" text NOT NULL,
	"member_id" uuid NOT NULL,
	"position_name" text,
	"state" text DEFAULT 'waiting' NOT NULL,
	"decision" text,
	"comment" text DEFAULT '' NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"overdue_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_tasks_state_chk" CHECK ("state" in ('waiting','pending','done','skipped')),
	CONSTRAINT "approval_tasks_decision_chk" CHECK ("decision" is null or "decision" in ('approve','reject','comment'))
);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_routes" ADD CONSTRAINT "approval_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_participants" ADD CONSTRAINT "approval_route_participants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_routes" ADD CONSTRAINT "approval_routes_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_route_fk" FOREIGN KEY ("workspace_id","route_id") REFERENCES "public"."approval_routes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_participants" ADD CONSTRAINT "approval_route_participants_step_fk" FOREIGN KEY ("workspace_id","step_id") REFERENCES "public"."approval_route_steps"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_participants" ADD CONSTRAINT "approval_route_participants_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_route_participants" ADD CONSTRAINT "approval_route_participants_position_fk" FOREIGN KEY ("workspace_id","position_id") REFERENCES "public"."positions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_route_fk" FOREIGN KEY ("workspace_id","route_id") REFERENCES "public"."approval_routes"("workspace_id","id") ON DELETE SET NULL ("route_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_author_fk" FOREIGN KEY ("workspace_id","author_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("author_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notif_approval_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_routes_ws_idx" ON "approval_routes" USING btree ("workspace_id","sort_order");--> statement-breakpoint
CREATE INDEX "approval_route_steps_route_idx" ON "approval_route_steps" USING btree ("workspace_id","route_id");--> statement-breakpoint
CREATE INDEX "approval_route_participants_step_idx" ON "approval_route_participants" USING btree ("workspace_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_doc_active_uq" ON "approvals" USING btree ("workspace_id","document_id") WHERE "state" = 'in_progress' and "document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_contract_active_uq" ON "approvals" USING btree ("workspace_id","contract_id") WHERE "state" = 'in_progress' and "contract_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_round_uq" ON "approvals" USING btree ("workspace_id",coalesce("document_id","contract_id"),"round");--> statement-breakpoint
CREATE INDEX "approvals_state_idx" ON "approvals" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "approval_tasks_approval_idx" ON "approval_tasks" USING btree ("workspace_id","approval_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_member_idx" ON "approval_tasks" USING btree ("workspace_id","member_id","state");--> statement-breakpoint
CREATE INDEX "approval_tasks_due_idx" ON "approval_tasks" USING btree ("due_at") WHERE "state" = 'pending' and "overdue_notified_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_approval_idx" ON "notifications" USING btree ("workspace_id","approval_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.approval_routes'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.approval_route_steps'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.approval_route_participants'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.approvals'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.approval_tasks'::regclass);
