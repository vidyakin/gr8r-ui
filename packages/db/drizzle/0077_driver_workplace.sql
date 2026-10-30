CREATE TABLE "fleet_driver_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_driver_payments_client_uq" UNIQUE("workspace_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "fleet_driver_registers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	CONSTRAINT "fleet_driver_registers_driver_org_uq" UNIQUE("workspace_id","driver_member_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "fleet_driver_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_driver_returns_client_uq" UNIQUE("workspace_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "fleet_driver_payments" ADD CONSTRAINT "fleet_driver_payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_payments" ADD CONSTRAINT "fleet_driver_payments_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_payments" ADD CONSTRAINT "fleet_driver_payments_stop_fk" FOREIGN KEY ("workspace_id","stop_id") REFERENCES "public"."fleet_trip_stops"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_payments" ADD CONSTRAINT "fleet_driver_payments_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_payments" ADD CONSTRAINT "fleet_driver_payments_payment_fk" FOREIGN KEY ("workspace_id","payment_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_registers" ADD CONSTRAINT "fleet_driver_registers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_registers" ADD CONSTRAINT "fleet_driver_registers_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_registers" ADD CONSTRAINT "fleet_driver_registers_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_registers" ADD CONSTRAINT "fleet_driver_registers_cash_fk" FOREIGN KEY ("workspace_id","cash_register_id") REFERENCES "public"."cash_registers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_returns" ADD CONSTRAINT "fleet_driver_returns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_returns" ADD CONSTRAINT "fleet_driver_returns_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_returns" ADD CONSTRAINT "fleet_driver_returns_stop_fk" FOREIGN KEY ("workspace_id","stop_id") REFERENCES "public"."fleet_trip_stops"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_returns" ADD CONSTRAINT "fleet_driver_returns_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_returns" ADD CONSTRAINT "fleet_driver_returns_document_fk" FOREIGN KEY ("workspace_id","return_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_driver_payments'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_driver_registers'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_driver_returns'::regclass);
