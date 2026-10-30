CREATE TABLE "fleet_routing_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"date" date NOT NULL,
	"trip_id" uuid,
	"requested_by" uuid,
	"source" text,
	"warning" text,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fleet_routing_runs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_routing_runs_kind_chk" CHECK ("fleet_routing_runs"."kind" in ('distribute','optimize')),
	CONSTRAINT "fleet_routing_runs_status_chk" CHECK ("fleet_routing_runs"."status" in ('queued','running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "lon" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "geo_source" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "geo_status" text;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "geo_source" text;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "geo_status" text;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "leg_km" numeric(9, 1);--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "leg_min" integer;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "eta_min" integer;--> statement-breakpoint
ALTER TABLE "fleet_trip_stops" ADD COLUMN "eta_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD COLUMN "route_km" numeric(9, 1);--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD COLUMN "route_min" integer;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD COLUMN "route_source" text;--> statement-breakpoint
ALTER TABLE "fleet_trips" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleet_routing_runs" ADD CONSTRAINT "fleet_routing_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_routing_runs_date_idx" ON "fleet_routing_runs" USING btree ("workspace_id","date","created_at");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_routing_runs'::regclass);
