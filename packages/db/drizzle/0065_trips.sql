CREATE TABLE "fleet_trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text DEFAULT 'delivery' NOT NULL,
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"delivery_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" numeric(9, 6),
	"lon" numeric(9, 6),
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"day" date NOT NULL,
	"window_from" time,
	"window_to" time,
	"weight_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"volume_m3" numeric(12, 3) DEFAULT '0' NOT NULL,
	"pallets" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"arrived_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trip_stops_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_trip_stops_kind_chk" CHECK ("fleet_trip_stops"."kind" in ('load','unload','delivery')),
	CONSTRAINT "fleet_trip_stops_source_chk" CHECK ("fleet_trip_stops"."source_kind" in ('manual','delivery','transport_order')),
	CONSTRAINT "fleet_trip_stops_status_chk" CHECK ("fleet_trip_stops"."status" in ('planned','arrived','done','failed')),
	CONSTRAINT "fleet_trip_stops_cargo_chk" CHECK ("fleet_trip_stops"."weight_kg" >= 0 and "fleet_trip_stops"."volume_m3" >= 0 and "fleet_trip_stops"."pallets" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_trips" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text DEFAULT 'city' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"vehicle_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"co_driver_member_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_trips_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_trips_status_chk" CHECK ("fleet_trips"."status" in ('planned','in_transit','done','cancelled')),
	CONSTRAINT "fleet_trips_kind_chk" CHECK ("fleet_trips"."kind" in ('city','intercity')),
	CONSTRAINT "fleet_trips_dates_chk" CHECK ("fleet_trips"."date_to" >= "fleet_trips"."date_from")
);
--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD CONSTRAINT "fleet_trip_stops_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD CONSTRAINT "fleet_trip_stops_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD CONSTRAINT "fleet_trip_stops_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."deliveries"("workspace_id","id") ON DELETE SET NULL ("delivery_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD CONSTRAINT "fleet_trips_co_driver_fk" FOREIGN KEY ("workspace_id","co_driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_trip_stops_trip_idx" ON "fleet_trip_stops" USING btree ("trip_id","seq");--> statement-breakpoint
CREATE INDEX "fleet_trip_stops_delivery_idx" ON "fleet_trip_stops" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_trips_ws_number_uq" ON "fleet_trips" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "fleet_trips_date_idx" ON "fleet_trips" USING btree ("workspace_id","date_from");--> statement-breakpoint
CREATE INDEX "fleet_trips_vehicle_idx" ON "fleet_trips" USING btree ("vehicle_id","date_from");--> statement-breakpoint
CREATE INDEX "fleet_trips_driver_idx" ON "fleet_trips" USING btree ("driver_member_id","date_from");--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD CONSTRAINT "fleet_waybills_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE SET NULL ("trip_id") ON UPDATE no action;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_trips'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_trip_stops'::regclass);