CREATE TABLE "production_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "production_kinds_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "production_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_stages_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD COLUMN "production_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "production_components" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "production_headers" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "stage_cost" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "production_kinds" ADD CONSTRAINT "production_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_kind_fk" FOREIGN KEY ("workspace_id","kind_id") REFERENCES "public"."production_kinds"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_kinds_ws_name_uq" ON "production_kinds" USING btree ("workspace_id",lower("name")) WHERE "production_kinds"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "production_stages_kind_idx" ON "production_stages" USING btree ("kind_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "production_stages_kind_final_uq" ON "production_stages" USING btree ("workspace_id","kind_id") WHERE "production_stages"."is_final";--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_stage_fk" FOREIGN KEY ("workspace_id","stage_id") REFERENCES "public"."production_stages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_kind_fk" FOREIGN KEY ("workspace_id","production_kind_id") REFERENCES "public"."production_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_stage_fk" FOREIGN KEY ("workspace_id","stage_id") REFERENCES "public"."production_stages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_stage_fk" FOREIGN KEY ("workspace_id","stage_id") REFERENCES "public"."production_stages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_stage_fk" FOREIGN KEY ("workspace_id","stage_id") REFERENCES "public"."production_stages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Этапы производства: справочник видов и упорядоченных этапов
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_sort_chk" CHECK ("sort_order" >= 0);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_stages'::regclass);
