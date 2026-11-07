-- Шаблоны проектов: проект как заготовка (сроки «день N от старта», исполнители по должностям).
CREATE TABLE "project_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'folder' NOT NULL,
	"color" text DEFAULT 'indigo' NOT NULL,
	"duration_days" integer,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_templates_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "project_templates_duration_chk" CHECK ("project_templates"."duration_days" is null or "project_templates"."duration_days" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_template_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" smallint,
	"start_day" integer,
	"due_day" integer,
	"plan_hours" numeric(10, 2),
	"position_id" uuid,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"subtasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_template_tasks_priority_chk" CHECK ("project_template_tasks"."priority" is null or "project_template_tasks"."priority" between 1 and 10),
	CONSTRAINT "project_template_tasks_days_chk" CHECK (("project_template_tasks"."start_day" is null or "project_template_tasks"."start_day" >= 1) and ("project_template_tasks"."due_day" is null or "project_template_tasks"."due_day" >= 1))
);
--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("created_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_template_fk" FOREIGN KEY ("workspace_id","template_id") REFERENCES "public"."project_templates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_position_fk" FOREIGN KEY ("workspace_id","position_id") REFERENCES "public"."positions"("workspace_id","id") ON DELETE SET NULL ("position_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_templates_ws_name_uq" ON "project_templates" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "project_template_tasks_template_idx" ON "project_template_tasks" USING btree ("workspace_id","template_id","sort_order");--> statement-breakpoint
SELECT app_secure_tenant_table('public.project_templates'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.project_template_tasks'::regclass);
