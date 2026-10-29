CREATE TABLE "fleet_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"owner_kind" text NOT NULL,
	"vehicle_id" uuid,
	"member_id" uuid,
	"number" text DEFAULT '' NOT NULL,
	"issued_on" date,
	"valid_until" date,
	"remind_days" integer DEFAULT 30 NOT NULL,
	"notified_for" date,
	"notified_stage" smallint DEFAULT 0 NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fleet_documents_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_documents_owner_chk" CHECK (("fleet_documents"."owner_kind" = 'vehicle' and "fleet_documents"."vehicle_id" is not null and "fleet_documents"."member_id" is null) or ("fleet_documents"."owner_kind" = 'driver' and "fleet_documents"."member_id" is not null and "fleet_documents"."vehicle_id" is null)),
	CONSTRAINT "fleet_documents_stage_chk" CHECK ("fleet_documents"."notified_stage" between 0 and 2 and "fleet_documents"."remind_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"license_number" text DEFAULT '' NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_driver_profiles_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "fleet_fines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_member_id" uuid,
	"waybill_id" uuid,
	"date" date NOT NULL,
	"uin" text DEFAULT '' NOT NULL,
	"article" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"paid_on" date,
	"charge_driver" boolean DEFAULT false NOT NULL,
	"expense_cost_item_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_fines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_fines_chk" CHECK ("fleet_fines"."amount" >= 0 and "fleet_fines"."status" in ('unpaid','paid','appealed'))
);
--> statement-breakpoint
CREATE TABLE "fleet_fuel_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"vehicle_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fleet_fuel_cards_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "fleet_fuel_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"card_id" uuid,
	"waybill_id" uuid,
	"date" date NOT NULL,
	"liters" numeric(12, 3) NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"odometer" numeric(12, 3),
	"station" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_key" text,
	"expense_cost_item_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_fuel_entries_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_fuel_entries_nums_chk" CHECK ("fleet_fuel_entries"."liters" > 0 and "fleet_fuel_entries"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_repair_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repair_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"qty" numeric(18, 3) DEFAULT '1' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_repair_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_repair_lines_chk" CHECK ("fleet_repair_lines"."qty" > 0 and "fleet_repair_lines"."price" >= 0 and "fleet_repair_lines"."kind" in ('part','work'))
);
--> statement-breakpoint
CREATE TABLE "fleet_repairs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text DEFAULT 'repair' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"date" date NOT NULL,
	"odometer" numeric(12, 3),
	"plan_id" uuid,
	"warehouse_id" uuid,
	"contractor_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"write_off_document_id" uuid,
	"parts_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"direct_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"expense_cost_item_id" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_repairs_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_repairs_status_chk" CHECK ("fleet_repairs"."status" in ('draft','posted','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fleet_service_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"every_km" integer,
	"every_months" integer,
	"last_km" numeric(12, 3),
	"last_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fleet_service_plans_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_service_plans_chk" CHECK (("fleet_service_plans"."every_km" is null or "fleet_service_plans"."every_km" > 0) and ("fleet_service_plans"."every_months" is null or "fleet_service_plans"."every_months" > 0))
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'truck' NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"vin" text DEFAULT '' NOT NULL,
	"year" integer,
	"capacity_kg" numeric(12, 3),
	"volume_m3" numeric(12, 3),
	"pallets" integer,
	"fuel_type" text DEFAULT 'diesel' NOT NULL,
	"fuel_norm_summer" numeric(8, 2),
	"fuel_norm_winter" numeric(8, 2),
	"tank_l" numeric(8, 2),
	"odometer" numeric(12, 3) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"driver_member_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "fleet_vehicles_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_vehicles_nums_chk" CHECK ("fleet_vehicles"."odometer" >= 0 and ("fleet_vehicles"."capacity_kg" is null or "fleet_vehicles"."capacity_kg" >= 0) and ("fleet_vehicles"."volume_m3" is null or "fleet_vehicles"."volume_m3" >= 0) and ("fleet_vehicles"."pallets" is null or "fleet_vehicles"."pallets" >= 0))
);
--> statement-breakpoint
CREATE TABLE "fleet_waybills" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_member_id" uuid NOT NULL,
	"trip_id" uuid,
	"organization_id" uuid,
	"route" text DEFAULT '' NOT NULL,
	"departure_at" timestamp with time zone,
	"return_at" timestamp with time zone,
	"odometer_out" numeric(12, 3) DEFAULT '0' NOT NULL,
	"odometer_back" numeric(12, 3),
	"fuel_out" numeric(12, 3) DEFAULT '0' NOT NULL,
	"fuel_back" numeric(12, 3),
	"norm_per_100" numeric(8, 2) DEFAULT '0' NOT NULL,
	"distance_km" numeric(12, 3),
	"norm_liters" numeric(12, 3),
	"actual_liters" numeric(12, 3),
	"medical_ok" boolean DEFAULT false NOT NULL,
	"medical_time" text DEFAULT '' NOT NULL,
	"medical_by" text DEFAULT '' NOT NULL,
	"tech_ok" boolean DEFAULT false NOT NULL,
	"tech_time" text DEFAULT '' NOT NULL,
	"tech_by" text DEFAULT '' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_waybills_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "fleet_waybills_status_chk" CHECK ("fleet_waybills"."status" in ('draft','issued','closed','cancelled')),
	CONSTRAINT "fleet_waybills_nums_chk" CHECK ("fleet_waybills"."odometer_out" >= 0 and "fleet_waybills"."fuel_out" >= 0 and ("fleet_waybills"."odometer_back" is null or "fleet_waybills"."odometer_back" >= "fleet_waybills"."odometer_out"))
);
--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_profiles" ADD CONSTRAINT "fleet_driver_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_driver_profiles" ADD CONSTRAINT "fleet_driver_profiles_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fines" ADD CONSTRAINT "fleet_fines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fines" ADD CONSTRAINT "fleet_fines_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fines" ADD CONSTRAINT "fleet_fines_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fines" ADD CONSTRAINT "fleet_fines_waybill_fk" FOREIGN KEY ("workspace_id","waybill_id") REFERENCES "public"."fleet_waybills"("workspace_id","id") ON DELETE SET NULL ("waybill_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fines" ADD CONSTRAINT "fleet_fines_cost_item_fk" FOREIGN KEY ("workspace_id","expense_cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_cards" ADD CONSTRAINT "fleet_fuel_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_cards" ADD CONSTRAINT "fleet_fuel_cards_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_entries" ADD CONSTRAINT "fleet_fuel_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_entries" ADD CONSTRAINT "fleet_fuel_entries_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_entries" ADD CONSTRAINT "fleet_fuel_entries_card_fk" FOREIGN KEY ("workspace_id","card_id") REFERENCES "public"."fleet_fuel_cards"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_entries" ADD CONSTRAINT "fleet_fuel_entries_waybill_fk" FOREIGN KEY ("workspace_id","waybill_id") REFERENCES "public"."fleet_waybills"("workspace_id","id") ON DELETE SET NULL ("waybill_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_entries" ADD CONSTRAINT "fleet_fuel_entries_cost_item_fk" FOREIGN KEY ("workspace_id","expense_cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repair_lines" ADD CONSTRAINT "fleet_repair_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repair_lines" ADD CONSTRAINT "fleet_repair_lines_repair_fk" FOREIGN KEY ("workspace_id","repair_id") REFERENCES "public"."fleet_repairs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repair_lines" ADD CONSTRAINT "fleet_repair_lines_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_plan_fk" FOREIGN KEY ("workspace_id","plan_id") REFERENCES "public"."fleet_service_plans"("workspace_id","id") ON DELETE SET NULL ("plan_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_contractor_fk" FOREIGN KEY ("workspace_id","contractor_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_write_off_fk" FOREIGN KEY ("workspace_id","write_off_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("write_off_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_repairs" ADD CONSTRAINT "fleet_repairs_cost_item_fk" FOREIGN KEY ("workspace_id","expense_cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_service_plans" ADD CONSTRAINT "fleet_service_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_service_plans" ADD CONSTRAINT "fleet_service_plans_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD CONSTRAINT "fleet_waybills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD CONSTRAINT "fleet_waybills_vehicle_fk" FOREIGN KEY ("workspace_id","vehicle_id") REFERENCES "public"."fleet_vehicles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_waybills" ADD CONSTRAINT "fleet_waybills_driver_fk" FOREIGN KEY ("workspace_id","driver_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_documents_valid_idx" ON "fleet_documents" USING btree ("workspace_id","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_driver_profiles_member_uq" ON "fleet_driver_profiles" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_fines_uin_uq" ON "fleet_fines" USING btree ("workspace_id","uin") WHERE "fleet_fines"."uin" <> '';--> statement-breakpoint
CREATE INDEX "fleet_fines_vehicle_idx" ON "fleet_fines" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_fuel_cards_ws_number_uq" ON "fleet_fuel_cards" USING btree ("workspace_id",lower("number")) WHERE "fleet_fuel_cards"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_fuel_entries_key_uq" ON "fleet_fuel_entries" USING btree ("workspace_id","external_key") WHERE "fleet_fuel_entries"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "fleet_fuel_entries_vehicle_idx" ON "fleet_fuel_entries" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "fleet_fuel_entries_waybill_idx" ON "fleet_fuel_entries" USING btree ("waybill_id");--> statement-breakpoint
CREATE INDEX "fleet_repair_lines_repair_idx" ON "fleet_repair_lines" USING btree ("repair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_repairs_ws_number_uq" ON "fleet_repairs" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "fleet_repairs_vehicle_idx" ON "fleet_repairs" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_vehicles_ws_plate_uq" ON "fleet_vehicles" USING btree ("workspace_id",lower("plate")) WHERE "fleet_vehicles"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_waybills_ws_number_uq" ON "fleet_waybills" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "fleet_waybills_date_idx" ON "fleet_waybills" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE INDEX "fleet_waybills_vehicle_idx" ON "fleet_waybills" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "fleet_waybills_driver_idx" ON "fleet_waybills" USING btree ("driver_member_id","date");
--> statement-breakpoint
-- Системные статьи затрат автопарка для существующих воркспейсов (новым их создаёт ensureCostItems)
INSERT INTO "cost_items" ("workspace_id", "name", "kind", "system_key")
SELECT w.id, CASE WHEN EXISTS (SELECT 1 FROM "cost_items" c WHERE c.workspace_id = w.id AND lower(c.name) = lower(i.name) AND c.archived_at IS NULL) THEN i.name || ' (системная)' ELSE i.name END, 'expense', i.key
FROM "workspaces" w, (VALUES ('gsm', 'ГСМ'), ('remont_transporta', 'Ремонт и ТО транспорта'), ('shtrafy_gibdd', 'Штрафы ГИБДД')) AS i(key, name)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_vehicles'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_driver_profiles'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_documents'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_waybills'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_fuel_cards'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_fuel_entries'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_service_plans'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_repairs'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_repair_lines'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.fleet_fines'::regclass);
