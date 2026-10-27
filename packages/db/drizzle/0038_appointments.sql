CREATE TABLE "appointment_day_alerts" (
	"workspace_id" uuid NOT NULL,
	"specialist_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_day_alerts_specialist_id_date_kind_pk" PRIMARY KEY("specialist_id","date","kind")
);
--> statement-breakpoint
CREATE TABLE "appointment_reminders" (
	"workspace_id" uuid NOT NULL,
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"specialist_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"product_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_min" integer NOT NULL,
	"slots" integer DEFAULT 1 NOT NULL,
	"slot_minutes" integer NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"cancel_reason" text,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"day_line_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "appointments_status_chk" CHECK ("appointments"."status" in ('booked','confirmed','came','no_show','cancelled')),
	CONSTRAINT "appointments_slots_chk" CHECK ("appointments"."slots" >= 1 and "appointments"."start_min" >= 0 and "appointments"."start_min" + "appointments"."slots" * "appointments"."slot_minutes" <= 1440),
	CONSTRAINT "appointments_client_chk" CHECK ("appointments"."contact_id" is not null or "appointments"."company_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "service_day_docs" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"specialist_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_day_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"product_id" uuid NOT NULL,
	"start_min" integer,
	"qty" numeric(18, 3) DEFAULT '1' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_day_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "service_day_lines_qty_chk" CHECK ("service_day_lines"."qty" > 0 and "service_day_lines"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_day_sales" (
	"workspace_id" uuid NOT NULL,
	"day_document_id" uuid NOT NULL,
	"sale_document_id" uuid NOT NULL,
	CONSTRAINT "service_day_sales_day_document_id_sale_document_id_pk" PRIMARY KEY("day_document_id","sale_document_id")
);
--> statement-breakpoint
CREATE TABLE "specialist_schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slots" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialist_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"day_start_min" integer DEFAULT 480 NOT NULL,
	"day_end_min" integer DEFAULT 1200 NOT NULL,
	"week" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialist_schedules_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "specialist_schedules_slot_chk" CHECK ("specialist_schedules"."slot_minutes" in (15,30,45,60,90)),
	CONSTRAINT "specialist_schedules_range_chk" CHECK ("specialist_schedules"."day_start_min" >= 0 and "specialist_schedules"."day_end_min" <= 1440 and "specialist_schedules"."day_end_min" > "specialist_schedules"."day_start_min")
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "appointment_minutes" integer;--> statement-breakpoint
ALTER TABLE "appointment_day_alerts" ADD CONSTRAINT "appointment_day_alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_day_alerts" ADD CONSTRAINT "appointment_day_alerts_member_fk" FOREIGN KEY ("workspace_id","specialist_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_fk" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_specialist_fk" FOREIGN KEY ("workspace_id","specialist_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_day_line_fk" FOREIGN KEY ("workspace_id","day_line_id") REFERENCES "public"."service_day_lines"("workspace_id","id") ON DELETE SET NULL ("day_line_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_docs" ADD CONSTRAINT "service_day_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_docs" ADD CONSTRAINT "service_day_docs_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_docs" ADD CONSTRAINT "service_day_docs_specialist_fk" FOREIGN KEY ("workspace_id","specialist_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_lines" ADD CONSTRAINT "service_day_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_lines" ADD CONSTRAINT "service_day_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_lines" ADD CONSTRAINT "service_day_lines_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_lines" ADD CONSTRAINT "service_day_lines_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_lines" ADD CONSTRAINT "service_day_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_sales" ADD CONSTRAINT "service_day_sales_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_sales" ADD CONSTRAINT "service_day_sales_day_fk" FOREIGN KEY ("workspace_id","day_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_day_sales" ADD CONSTRAINT "service_day_sales_sale_fk" FOREIGN KEY ("workspace_id","sale_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_schedule_exceptions" ADD CONSTRAINT "specialist_schedule_exceptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_schedule_exceptions" ADD CONSTRAINT "specialist_exceptions_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_schedules" ADD CONSTRAINT "specialist_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_schedules" ADD CONSTRAINT "specialist_schedules_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_specialist_day_idx" ON "appointments" USING btree ("workspace_id","specialist_id","date");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("workspace_id","contact_id");--> statement-breakpoint
CREATE INDEX "appointments_company_idx" ON "appointments" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "service_day_lines_document_idx" ON "service_day_lines" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specialist_schedule_exceptions_uq" ON "specialist_schedule_exceptions" USING btree ("workspace_id","member_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "specialist_schedules_member_uq" ON "specialist_schedules" USING btree ("workspace_id","member_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_appointment_minutes_chk" CHECK ("products"."appointment_minutes" is null or "products"."appointment_minutes" between 5 and 600);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs','material_allocation','tolling_receipt','tolling_report','tolling_return','sales_plan','service_day'));
--> statement-breakpoint
SELECT app_secure_tenant_table('public.specialist_schedules'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.specialist_schedule_exceptions'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.appointments'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.service_day_docs'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.service_day_lines'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.service_day_sales'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.appointment_reminders'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.appointment_day_alerts'::regclass);
