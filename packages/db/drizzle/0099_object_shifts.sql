-- Задача 1271: табель прораба, бейджи и стоимость часа в затратах объекта (docs/architecture/construction.md).
-- Часы смены живут только в новых таблицах (time_logs не трогаем), смена: черновик → подтверждена.
-- Стоимость часа — снимок в строке при подтверждении: новая ставка прошлые затраты не меняет.
ALTER TABLE "members" ADD COLUMN "badge_code" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "personnel_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_ws_badge_uq" ON "members" USING btree ("workspace_id","badge_code") WHERE "members"."badge_code" is not null and "members"."badge_code" <> '';--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD COLUMN "hourly_rate" numeric(18,2);--> statement-breakpoint
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_hourly_rate_chk" CHECK ("employee_payroll"."hourly_rate" is null or "employee_payroll"."hourly_rate" >= 0);--> statement-breakpoint
CREATE TABLE "object_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"foreman_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_shifts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_shifts_object_date_uq" UNIQUE("object_id","work_date","foreman_id"),
	CONSTRAINT "object_shifts_status_chk" CHECK ("object_shifts"."status" in ('draft','confirmed')),
	CONSTRAINT "object_shifts_confirmed_chk" CHECK (("object_shifts"."status" = 'draft' and "object_shifts"."confirmed_at" is null and "object_shifts"."confirmed_by" is null) or ("object_shifts"."status" = 'confirmed' and "object_shifts"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "object_shifts_object_idx" ON "object_shifts" USING btree ("workspace_id","object_id","work_date");--> statement-breakpoint
CREATE INDEX "object_shifts_foreman_idx" ON "object_shifts" USING btree ("workspace_id","foreman_id","work_date");--> statement-breakpoint
CREATE TABLE "object_shift_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"estimate_item_id" uuid,
	"hours" numeric(6,2) NOT NULL,
	"cost_rate" numeric(18,2),
	"cost_amount" numeric(18,2),
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_shift_hours_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_shift_hours_hours_chk" CHECK ("object_shift_hours"."hours" > 0 and "object_shift_hours"."hours" <= 24),
	CONSTRAINT "object_shift_hours_cost_chk" CHECK (("object_shift_hours"."cost_rate" is null or "object_shift_hours"."cost_rate" >= 0) and ("object_shift_hours"."cost_amount" is null or "object_shift_hours"."cost_amount" >= 0))
);
--> statement-breakpoint
CREATE INDEX "object_shift_hours_shift_idx" ON "object_shift_hours" USING btree ("workspace_id","shift_id");--> statement-breakpoint
CREATE INDEX "object_shift_hours_member_idx" ON "object_shift_hours" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE TABLE "object_shift_volumes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"estimate_item_id" uuid NOT NULL,
	"qty" numeric(18,3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_shift_volumes_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_shift_volumes_shift_item_uq" UNIQUE("shift_id","estimate_item_id"),
	CONSTRAINT "object_shift_volumes_qty_chk" CHECK ("object_shift_volumes"."qty" > 0)
);
--> statement-breakpoint
CREATE INDEX "object_shift_volumes_shift_idx" ON "object_shift_volumes" USING btree ("workspace_id","shift_id");--> statement-breakpoint
CREATE TABLE "object_shift_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"author_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "object_shift_log_shift_idx" ON "object_shift_log" USING btree ("workspace_id","shift_id","at");--> statement-breakpoint
ALTER TABLE "object_shifts" ADD CONSTRAINT "object_shifts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shifts" ADD CONSTRAINT "object_shifts_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shifts" ADD CONSTRAINT "object_shifts_foreman_fk" FOREIGN KEY ("workspace_id","foreman_id") REFERENCES "public"."members"("workspace_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shifts" ADD CONSTRAINT "object_shifts_confirmed_by_fk" FOREIGN KEY ("workspace_id","confirmed_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("confirmed_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shifts" ADD CONSTRAINT "object_shifts_created_by_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("created_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_hours" ADD CONSTRAINT "object_shift_hours_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_hours" ADD CONSTRAINT "object_shift_hours_shift_fk" FOREIGN KEY ("workspace_id","shift_id") REFERENCES "public"."object_shifts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_hours" ADD CONSTRAINT "object_shift_hours_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_hours" ADD CONSTRAINT "object_shift_hours_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE SET NULL ("estimate_item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_volumes" ADD CONSTRAINT "object_shift_volumes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_volumes" ADD CONSTRAINT "object_shift_volumes_shift_fk" FOREIGN KEY ("workspace_id","shift_id") REFERENCES "public"."object_shifts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_volumes" ADD CONSTRAINT "object_shift_volumes_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_log" ADD CONSTRAINT "object_shift_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_log" ADD CONSTRAINT "object_shift_log_shift_fk" FOREIGN KEY ("workspace_id","shift_id") REFERENCES "public"."object_shifts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_shift_log" ADD CONSTRAINT "object_shift_log_author_fk" FOREIGN KEY ("workspace_id","author_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("author_id") ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_shifts'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_shift_hours'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_shift_volumes'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_shift_log'::regclass);
