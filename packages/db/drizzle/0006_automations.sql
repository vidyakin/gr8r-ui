CREATE TABLE "flow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "flow_run_steps_status_chk" CHECK ("flow_run_steps"."status" in ('running','waiting','retrying','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger_kind" text NOT NULL,
	"event_id" uuid,
	"dedupe_key" text,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chain" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"error" text,
	"started_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "flow_runs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "flow_runs_status_chk" CHECK ("flow_runs"."status" in ('queued','running','waiting','succeeded','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"trigger_type" text NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_versions_flow_version_uq" UNIQUE("flow_id","version")
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"version_counter" integer DEFAULT 0 NOT NULL,
	"published_version" integer,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flows_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "flows_published_chk" CHECK ("flows"."enabled" = false or "flows"."published_version" is not null)
);
--> statement-breakpoint
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."flow_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_fk" FOREIGN KEY ("workspace_id","flow_id") REFERENCES "public"."flows"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_fk" FOREIGN KEY ("workspace_id","flow_id") REFERENCES "public"."flows"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_run_steps_run_idx" ON "flow_run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_event_uq" ON "flow_runs" USING btree ("flow_id","event_id") WHERE "flow_runs"."event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_dedupe_uq" ON "flow_runs" USING btree ("flow_id","dedupe_key") WHERE "flow_runs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "flow_runs_flow_idx" ON "flow_runs" USING btree ("workspace_id","flow_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_runs_ws_idx" ON "flow_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "flows_ws_enabled_idx" ON "flows" USING btree ("workspace_id","enabled");--> statement-breakpoint

-- Изоляция арендаторов: как у остальных таблиц (владелец app_owner, ENABLE + FORCE RLS, политика по workspace_id, права ролям)
SELECT app_secure_tenant_table('public.flows'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.flow_versions'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.flow_runs'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.flow_run_steps'::regclass);
