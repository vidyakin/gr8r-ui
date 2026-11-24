-- Добыча: взвешивания, насыпная плотность, моточасы техники
ALTER TABLE "products" ADD COLUMN "bulk_density" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD COLUMN "meter_type" text DEFAULT 'odometer' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD COLUMN "engine_hours" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_meter_type_chk" CHECK ("meter_type" in ('odometer','engine_hours'));--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD COLUMN "engine_hours_start" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD COLUMN "engine_hours_end" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "fleet_service_plans" ADD COLUMN "interval_hours" numeric(12, 2);--> statement-breakpoint
CREATE TABLE "weighings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"number" text NOT NULL,
	"weighed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" text DEFAULT 'out' NOT NULL,
	"vehicle_id" uuid,
	"plate_number" text DEFAULT '' NOT NULL,
	"driver_name" text DEFAULT '' NOT NULL,
	"counterparty_id" uuid,
	"product_id" uuid,
	"gross_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"tare_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"net_kg" numeric(14, 3) DEFAULT '0' NOT NULL,
	"bulk_density" numeric(10, 4),
	"volume_m3" numeric(14, 3),
	"waybill_number" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "weighings_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "weighings_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id"),
	CONSTRAINT "weighings_counterparty_fk" FOREIGN KEY ("workspace_id","counterparty_id") REFERENCES "public"."companies"("workspace_id","id"),
	CONSTRAINT "weighings_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id"),
	CONSTRAINT "weighings_direction_chk" CHECK ("direction" in ('out','in')),
	CONSTRAINT "weighings_source_chk" CHECK ("source" in ('manual','scale_api')),
	CONSTRAINT "weighings_weights_chk" CHECK ("tare_kg" >= 0 and "gross_kg" >= "tare_kg")
);--> statement-breakpoint
CREATE UNIQUE INDEX "weighings_ws_number_uq" ON "weighings" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "weighings_ws_weighed_idx" ON "weighings" USING btree ("workspace_id","weighed_at");--> statement-breakpoint
CREATE INDEX "weighings_ws_product_idx" ON "weighings" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "weighings_ws_vehicle_idx" ON "weighings" USING btree ("workspace_id","vehicle_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.weighings'::regclass);--> statement-breakpoint
