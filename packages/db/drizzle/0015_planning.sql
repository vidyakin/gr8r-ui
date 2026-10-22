CREATE TABLE "calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_exceptions_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "calendar_exceptions_scope_chk" CHECK ("calendar_exceptions"."scope" in ('member','work_center','resource')),
	CONSTRAINT "calendar_exceptions_range_chk" CHECK ("calendar_exceptions"."date_to" >= "calendar_exceptions"."date_from")
);
--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'weekly' NOT NULL,
	"pattern" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cycle_start" date,
	"hours_per_day" numeric(10, 3) DEFAULT '8' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "work_calendars_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "work_calendars_kind_chk" CHECK ("work_calendars"."kind" in ('weekly','cycle')),
	CONSTRAINT "work_calendars_hours_chk" CHECK ("work_calendars"."hours_per_day" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_holidays" (
	"workspace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_holidays_workspace_id_date_pk" PRIMARY KEY("workspace_id","date")
);
--> statement-breakpoint
CREATE TABLE "document_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_id" uuid,
	"resource_id" uuid NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"hours" numeric(10, 3) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_resources_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "document_resources_hours_chk" CHECK ("document_resources"."hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_resources" (
	"workspace_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"hours_per_unit" numeric(10, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_resources_workspace_id_product_id_resource_id_pk" PRIMARY KEY("workspace_id","product_id","resource_id"),
	CONSTRAINT "product_resources_hours_chk" CHECK ("product_resources"."hours_per_unit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'equipment' NOT NULL,
	"work_center_id" uuid,
	"capacity_units" integer DEFAULT 1 NOT NULL,
	"calendar_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "resources_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "resources_capacity_chk" CHECK ("resources"."capacity_units" > 0)
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "production_operations" ADD COLUMN "planned_start" date;--> statement-breakpoint
ALTER TABLE "production_operations" ADD COLUMN "planned_end" date;--> statement-breakpoint
ALTER TABLE "production_operations" ADD COLUMN "auto_planned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "capacity_hours_per_day" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_holidays" ADD CONSTRAINT "workspace_holidays_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_resources" ADD CONSTRAINT "document_resources_resource_fk" FOREIGN KEY ("workspace_id","resource_id") REFERENCES "public"."resources"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_resources" ADD CONSTRAINT "product_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_resources" ADD CONSTRAINT "product_resources_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_resources" ADD CONSTRAINT "product_resources_resource_fk" FOREIGN KEY ("workspace_id","resource_id") REFERENCES "public"."resources"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_work_center_fk" FOREIGN KEY ("workspace_id","work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_calendar_fk" FOREIGN KEY ("workspace_id","calendar_id") REFERENCES "public"."work_calendars"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_exceptions_scope_idx" ON "calendar_exceptions" USING btree ("workspace_id","scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendars_ws_name_uq" ON "work_calendars" USING btree ("workspace_id",lower("name")) WHERE "work_calendars"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_calendars_ws_default_uq" ON "work_calendars" USING btree ("workspace_id") WHERE "work_calendars"."is_default" and "work_calendars"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "work_calendars_ws_idx" ON "work_calendars" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "document_resources_document_idx" ON "document_resources" USING btree ("workspace_id","document_id","sort_order");--> statement-breakpoint
CREATE INDEX "document_resources_resource_idx" ON "document_resources" USING btree ("workspace_id","resource_id");--> statement-breakpoint
CREATE INDEX "product_resources_resource_idx" ON "product_resources" USING btree ("workspace_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_ws_name_uq" ON "resources" USING btree ("workspace_id",lower("name")) WHERE "resources"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "resources_ws_idx" ON "resources" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_calendar_fk" FOREIGN KEY ("workspace_id","calendar_id") REFERENCES "public"."work_calendars"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_calendar_fk" FOREIGN KEY ("workspace_id","calendar_id") REFERENCES "public"."work_calendars"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Планирование загрузки: графики, праздники, исключения, ресурсы — арендаторские таблицы
SELECT app_secure_tenant_table('public.work_calendars'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.workspace_holidays'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.calendar_exceptions'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.resources'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_resources'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_resources'::regclass);
