-- Задача 1269: смета объекта — основная смета, разделы и позиции, допработы (docs/architecture/construction.md).
-- У объекта одна основная смета (частичный уникальный индекс) и любое число дополнений (kind = 'change').
CREATE TABLE "object_estimates" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "object_id" uuid NOT NULL,
  "number" text DEFAULT '' NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by" uuid,
  "parent_id" uuid,
  "kind" text DEFAULT 'main' NOT NULL,
  "change_status" text,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_estimates_status_chk" CHECK ("object_estimates"."status" in ('draft','approved')),
  CONSTRAINT "object_estimates_kind_chk" CHECK ("object_estimates"."kind" in ('main','change')),
  CONSTRAINT "object_estimates_change_status_chk" CHECK (("object_estimates"."kind" = 'main' and "object_estimates"."change_status" is null and "object_estimates"."parent_id" is null) or ("object_estimates"."kind" = 'change' and "object_estimates"."parent_id" is not null and "object_estimates"."change_status" in ('draft','approved','rejected')))
);--> statement-breakpoint
ALTER TABLE "object_estimates" ADD CONSTRAINT "object_estimates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimates" ADD CONSTRAINT "object_estimates_ws_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_estimates_main_uq" ON "object_estimates" USING btree ("workspace_id","object_id") WHERE "object_estimates"."kind" = 'main';--> statement-breakpoint
CREATE INDEX "object_estimates_object_idx" ON "object_estimates" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "object_estimates" ADD CONSTRAINT "object_estimates_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimates" ADD CONSTRAINT "object_estimates_approved_by_fk" FOREIGN KEY ("workspace_id","approved_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("approved_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimates" ADD CONSTRAINT "object_estimates_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."object_estimates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "object_estimate_sections" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "estimate_id" uuid NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "object_estimate_sections" ADD CONSTRAINT "object_estimate_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_sections" ADD CONSTRAINT "object_estimate_sections_ws_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "object_estimate_sections" ADD CONSTRAINT "object_estimate_sections_estimate_fk" FOREIGN KEY ("workspace_id","estimate_id") REFERENCES "public"."object_estimates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_estimate_sections_estimate_idx" ON "object_estimate_sections" USING btree ("estimate_id","sort_order");--> statement-breakpoint
CREATE TABLE "object_estimate_items" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "estimate_id" uuid NOT NULL,
  "section_id" uuid,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "kind" text DEFAULT 'work' NOT NULL,
  "name" text NOT NULL,
  "product_id" uuid,
  "unit_code" text DEFAULT '796' NOT NULL,
  "qty" numeric(18,3) DEFAULT '0' NOT NULL,
  "price" numeric(18,2) DEFAULT '0' NOT NULL,
  "vat_rate" text DEFAULT '20' NOT NULL,
  "cost_price" numeric(18,2) DEFAULT '0' NOT NULL,
  "labor_hours" numeric(18,3) DEFAULT '0' NOT NULL,
  "manufactured_item_id" uuid,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "object_estimate_items_kind_chk" CHECK ("object_estimate_items"."kind" in ('work','material','panel','subcontract','other')),
  CONSTRAINT "object_estimate_items_vat_chk" CHECK ("object_estimate_items"."vat_rate" in ('none','0','5','7','10','20')),
  CONSTRAINT "object_estimate_items_amounts_chk" CHECK ("object_estimate_items"."qty" >= 0 and "object_estimate_items"."price" >= 0 and "object_estimate_items"."cost_price" >= 0 and "object_estimate_items"."labor_hours" >= 0)
);--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_ws_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_estimate_fk" FOREIGN KEY ("workspace_id","estimate_id") REFERENCES "public"."object_estimates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_section_fk" FOREIGN KEY ("workspace_id","section_id") REFERENCES "public"."object_estimate_sections"("workspace_id","id") ON DELETE SET NULL ("section_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE SET NULL ("product_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_manufactured_fk" FOREIGN KEY ("workspace_id","manufactured_item_id") REFERENCES "public"."manufactured_items"("workspace_id","id") ON DELETE SET NULL ("manufactured_item_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "object_estimate_items_estimate_idx" ON "object_estimate_items" USING btree ("estimate_id","sort_order");--> statement-breakpoint
CREATE INDEX "object_estimate_items_section_idx" ON "object_estimate_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "object_estimate_items_product_idx" ON "object_estimate_items" USING btree ("product_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_estimates'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_estimate_sections'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_estimate_items'::regclass);
