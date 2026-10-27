CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"origin_document_id" uuid,
	"method_id" uuid,
	"address" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"delivery_date" date,
	"window_from" time,
	"window_to" time,
	"distance_km" numeric(12, 3) DEFAULT '0' NOT NULL,
	"weight_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"our_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"courier_member_id" uuid,
	"carrier_company_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"line_id" uuid,
	"expense_cost_item_id" uuid,
	"expense_amount" numeric(18, 2),
	"expensed_at" date,
	"delivered_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "deliveries_status_chk" CHECK ("deliveries"."status" in ('new','assigned','in_transit','delivered','failed')),
	CONSTRAINT "deliveries_amounts_chk" CHECK ("deliveries"."price" >= 0 and "deliveries"."our_cost" >= 0 and "deliveries"."distance_km" >= 0 and "deliveries"."weight_kg" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'own_courier' NOT NULL,
	"product_id" uuid,
	"carrier_company_id" uuid,
	"client_rate" jsonb DEFAULT '{"base":"0","perKm":"0","perKg":"0","min":"0"}'::jsonb NOT NULL,
	"cost_rate" jsonb DEFAULT '{"base":"0","perKm":"0","perKg":"0","min":"0"}'::jsonb NOT NULL,
	"free_from" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "delivery_methods_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "delivery_methods_kind_chk" CHECK ("delivery_methods"."kind" in ('own_courier','courier_service','third_party')),
	CONSTRAINT "delivery_methods_free_chk" CHECK ("delivery_methods"."free_from" is null or "delivery_methods"."free_from" >= 0)
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "is_courier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "weight_kg" numeric(18, 3);--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_origin_fk" FOREIGN KEY ("workspace_id","origin_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("origin_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_method_fk" FOREIGN KEY ("workspace_id","method_id") REFERENCES "public"."delivery_methods"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courier_fk" FOREIGN KEY ("workspace_id","courier_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_carrier_fk" FOREIGN KEY ("workspace_id","carrier_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE SET NULL ("line_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_expense_item_fk" FOREIGN KEY ("workspace_id","expense_cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_methods" ADD CONSTRAINT "delivery_methods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_methods" ADD CONSTRAINT "delivery_methods_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_methods" ADD CONSTRAINT "delivery_methods_carrier_fk" FOREIGN KEY ("workspace_id","carrier_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_document_uq" ON "deliveries" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "deliveries_date_idx" ON "deliveries" USING btree ("workspace_id","delivery_date");--> statement-breakpoint
CREATE INDEX "deliveries_courier_idx" ON "deliveries" USING btree ("courier_member_id");--> statement-breakpoint
CREATE INDEX "deliveries_method_idx" ON "deliveries" USING btree ("method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_methods_ws_name_uq" ON "delivery_methods" USING btree ("workspace_id",lower("name")) WHERE "delivery_methods"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_weight_chk" CHECK ("products"."weight_kg" is null or "products"."weight_kg" >= 0);
--> statement-breakpoint
-- Системная статья затрат «Доставка» для существующих воркспейсов (новым её создаёт ensureCostItems)
INSERT INTO "cost_items" ("workspace_id", "name", "kind", "system_key")
SELECT w.id, CASE WHEN EXISTS (SELECT 1 FROM "cost_items" c WHERE c.workspace_id = w.id AND lower(c.name) = 'доставка' AND c.archived_at IS NULL) THEN 'Доставка (системная)' ELSE 'Доставка' END, 'expense', 'dostavka'
FROM "workspaces" w
ON CONFLICT DO NOTHING;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.delivery_methods'::regclass);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.deliveries'::regclass);
