CREATE TABLE "investment_cost_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"investment_project_id" uuid NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_cost_items_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "investment_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"investment_project_id" uuid NOT NULL,
	"period_index" integer NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plan_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "investment_plan_lines_period_chk" CHECK ("investment_plan_lines"."period_index" >= 0),
	CONSTRAINT "investment_plan_lines_amount_chk" CHECK ("investment_plan_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "investment_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_kind" text DEFAULT 'month' NOT NULL,
	"start_date" date NOT NULL,
	"periods" integer NOT NULL,
	"discount_rate" numeric(9, 4) DEFAULT '0' NOT NULL,
	"project_id" uuid,
	"organization_id" uuid,
	"responsible_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "investment_projects_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "investment_projects_status_chk" CHECK ("investment_projects"."status" in ('draft','approved','closed')),
	CONSTRAINT "investment_projects_period_chk" CHECK ("investment_projects"."period_kind" in ('month','quarter','year')),
	CONSTRAINT "investment_projects_periods_chk" CHECK ("investment_projects"."periods" between 1 and 240),
	CONSTRAINT "investment_projects_rate_chk" CHECK ("investment_projects"."discount_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "investment_project_id" uuid;--> statement-breakpoint
ALTER TABLE "investment_cost_items" ADD CONSTRAINT "investment_cost_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cost_items" ADD CONSTRAINT "investment_cost_items_project_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_cost_items" ADD CONSTRAINT "investment_cost_items_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_lines" ADD CONSTRAINT "investment_plan_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_lines" ADD CONSTRAINT "investment_plan_lines_project_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plan_lines" ADD CONSTRAINT "investment_plan_lines_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE set null ("project_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_responsible_fk" FOREIGN KEY ("workspace_id","responsible_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projects" ADD CONSTRAINT "investment_projects_approved_by_fk" FOREIGN KEY ("workspace_id","approved_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_cost_items_item_uq" ON "investment_cost_items" USING btree ("workspace_id","cost_item_id");--> statement-breakpoint
CREATE INDEX "investment_cost_items_project_idx" ON "investment_cost_items" USING btree ("investment_project_id");--> statement-breakpoint
CREATE INDEX "investment_plan_lines_project_idx" ON "investment_plan_lines" USING btree ("investment_project_id","sort_order");--> statement-breakpoint
CREATE INDEX "investment_projects_ws_status_idx" ON "investment_projects" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_investment_project_fk" FOREIGN KEY ("workspace_id","investment_project_id") REFERENCES "public"."investment_projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_investment_project_idx" ON "documents" USING btree ("investment_project_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.investment_projects'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.investment_plan_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.investment_cost_items'::regclass);
