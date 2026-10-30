CREATE TABLE "fleet_driver_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" text NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"comment" text DEFAULT '' NOT NULL,
	"photo" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_driver_events_ws_client_uq" UNIQUE("workspace_id","client_id"),
	CONSTRAINT "fleet_driver_events_status_chk" CHECK ("fleet_driver_events"."status" in ('arrived','done','failed')),
	CONSTRAINT "fleet_driver_events_coords_chk" CHECK (("fleet_driver_events"."latitude" is null and "fleet_driver_events"."longitude" is null) or ("fleet_driver_events"."latitude" is not null and "fleet_driver_events"."longitude" is not null and "fleet_driver_events"."latitude" between -90 and 90 and "fleet_driver_events"."longitude" between -180 and 180)),
	CONSTRAINT "fleet_driver_events_pod_size_chk" CHECK (coalesce(octet_length("fleet_driver_events"."photo"), 0) <= 2097152 and coalesce(octet_length("fleet_driver_events"."signature"), 0) <= 524288)
);
--> statement-breakpoint
ALTER TABLE "fleet_driver_events" ADD CONSTRAINT "fleet_driver_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_events" ADD CONSTRAINT "fleet_driver_events_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_events" ADD CONSTRAINT "fleet_driver_events_stop_fk" FOREIGN KEY ("workspace_id","stop_id") REFERENCES "public"."fleet_trip_stops"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_events" ADD CONSTRAINT "fleet_driver_events_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_driver_events_stop_idx" ON "fleet_driver_events" USING btree ("stop_id","created_at");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_driver_events'::regclass);
