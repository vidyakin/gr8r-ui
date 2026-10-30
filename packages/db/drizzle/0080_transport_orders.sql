CREATE TABLE "fleet_trip_carriers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"carrier_company_id" uuid NOT NULL,
	"rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vehicle_plate" text DEFAULT '' NOT NULL,
	"vehicle_model" text DEFAULT '' NOT NULL,
	"driver_name" text DEFAULT '' NOT NULL,
	"driver_phone" text DEFAULT '' NOT NULL,
	"driver_license" text DEFAULT '' NOT NULL,
	"contract_number" text DEFAULT '' NOT NULL,
	"contract_date" date,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trip_carriers_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_trip_carriers_rate_chk" CHECK ("fleet_trip_carriers"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_trip_costs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trip_costs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_trip_costs_amount_chk" CHECK ("fleet_trip_costs"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transport_order_points" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text DEFAULT 'load' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_order_points_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "transport_order_points_kind_chk" CHECK ("transport_order_points"."kind" in ('load','unload'))
);
--> statement-breakpoint
CREATE TABLE "transport_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_company_id" uuid NOT NULL,
	"from_place" text DEFAULT '' NOT NULL,
	"to_place" text DEFAULT '' NOT NULL,
	"ready_date" date,
	"delivery_date" date,
	"cargo_name" text DEFAULT '' NOT NULL,
	"weight_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"volume_m3" numeric(12, 3) DEFAULT '0' NOT NULL,
	"places" integer DEFAULT 0 NOT NULL,
	"body_type" text DEFAULT '' NOT NULL,
	"rate_schedule_id" uuid,
	"rate_kind" text DEFAULT 'flat' NOT NULL,
	"rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"distance_km" numeric(9, 1),
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"trip_id" uuid,
	"invoice_document_id" uuid,
	"act_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_orders_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "transport_orders_status_chk" CHECK ("transport_orders"."status" in ('draft','confirmed','in_progress','done','cancelled')),
	CONSTRAINT "transport_orders_rate_chk" CHECK ("transport_orders"."rate_kind" in ('flat','per_km','per_ton')),
	CONSTRAINT "transport_orders_cargo_chk" CHECK ("transport_orders"."weight_kg" >= 0 and "transport_orders"."volume_m3" >= 0 and "transport_orders"."places" >= 0 and "transport_orders"."rate" >= 0 and "transport_orders"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transport_rate_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_place" text DEFAULT '' NOT NULL,
	"to_place" text DEFAULT '' NOT NULL,
	"body_type" text DEFAULT '' NOT NULL,
	"rate_kind" text DEFAULT 'flat' NOT NULL,
	"rate" numeric(18, 2) DEFAULT '0' NOT NULL,
	"distance_km" numeric(9, 1),
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "transport_rate_schedules_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "transport_rate_schedules_rate_chk" CHECK ("transport_rate_schedules"."rate_kind" in ('flat','per_km','per_ton')),
	CONSTRAINT "transport_rate_schedules_amount_chk" CHECK ("transport_rate_schedules"."rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_trip_carriers" ADD CONSTRAINT "fleet_trip_carriers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_carriers" ADD CONSTRAINT "fleet_trip_carriers_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_carriers" ADD CONSTRAINT "fleet_trip_carriers_company_fk" FOREIGN KEY ("workspace_id","carrier_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_costs" ADD CONSTRAINT "fleet_trip_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_costs" ADD CONSTRAINT "fleet_trip_costs_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_order_points" ADD CONSTRAINT "transport_order_points_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_order_points" ADD CONSTRAINT "transport_order_points_order_fk" FOREIGN KEY ("workspace_id","order_id") REFERENCES "public"."transport_orders"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_org_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."organizations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_customer_fk" FOREIGN KEY ("workspace_id","customer_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_rate_schedule_fk" FOREIGN KEY ("workspace_id","rate_schedule_id") REFERENCES "public"."transport_rate_schedules"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE SET NULL ("trip_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_invoice_fk" FOREIGN KEY ("workspace_id","invoice_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("invoice_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_orders" ADD CONSTRAINT "transport_orders_act_fk" FOREIGN KEY ("workspace_id","act_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("act_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_rate_schedules" ADD CONSTRAINT "transport_rate_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_trip_carriers_trip_uq" ON "fleet_trip_carriers" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "fleet_trip_carriers_carrier_idx" ON "fleet_trip_carriers" USING btree ("carrier_company_id");--> statement-breakpoint
CREATE INDEX "fleet_trip_costs_trip_idx" ON "fleet_trip_costs" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "transport_order_points_order_idx" ON "transport_order_points" USING btree ("order_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_orders_ws_number_uq" ON "transport_orders" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "transport_orders_date_idx" ON "transport_orders" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "transport_orders_customer_idx" ON "transport_orders" USING btree ("customer_company_id");--> statement-breakpoint
CREATE INDEX "transport_orders_trip_idx" ON "transport_orders" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "transport_rate_schedules_route_idx" ON "transport_rate_schedules" USING btree ("workspace_id","from_place","to_place");--> statement-breakpoint
SELECT app_secure_tenant_table('public.transport_rate_schedules'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.transport_orders'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.transport_order_points'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_trip_carriers'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_trip_costs'::regclass);
