CREATE TABLE "transport_waybills" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"trip_id" uuid,
	"stop_id" uuid,
	"delivery_id" uuid,
	"etrn_status" text DEFAULT 'none' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_waybills_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "transport_waybills_etrn_chk" CHECK ("transport_waybills"."etrn_status" in ('none','draft','sent','signed','rejected'))
);
--> statement-breakpoint
ALTER TABLE "transport_waybills" ADD CONSTRAINT "transport_waybills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_waybills" ADD CONSTRAINT "transport_waybills_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE SET NULL ("trip_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_waybills" ADD CONSTRAINT "transport_waybills_stop_fk" FOREIGN KEY ("workspace_id","stop_id") REFERENCES "public"."fleet_trip_stops"("workspace_id","id") ON DELETE SET NULL ("stop_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_waybills" ADD CONSTRAINT "transport_waybills_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."deliveries"("workspace_id","id") ON DELETE SET NULL ("delivery_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_waybills_ws_number_uq" ON "transport_waybills" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "transport_waybills_trip_idx" ON "transport_waybills" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "transport_waybills_delivery_idx" ON "transport_waybills" USING btree ("delivery_id");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.transport_waybills'::regclass);
