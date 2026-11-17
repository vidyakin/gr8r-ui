-- Подразделения (оргструктура, docs/architecture/departments.md): дерево с руководителями и привязка сотрудников.
-- Руководитель подразделения сотрудника — основа будущего правила согласования; у участника не больше одного подразделения.
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"head_member_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_ws_id_uq" UNIQUE("workspace_id","id")
);--> statement-breakpoint
CREATE TABLE "department_members" (
	"workspace_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "department_members_department_id_member_id_pk" PRIMARY KEY("department_id","member_id")
);--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."departments"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_member_fk" FOREIGN KEY ("workspace_id","head_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("head_member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_fk" FOREIGN KEY ("workspace_id","department_id") REFERENCES "public"."departments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_ws_name_uq" ON "departments" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_members_ws_member_uq" ON "department_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "department_members_department_idx" ON "department_members" USING btree ("department_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.departments'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.department_members'::regclass);