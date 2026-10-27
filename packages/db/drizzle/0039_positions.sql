CREATE TABLE "member_positions" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	CONSTRAINT "member_positions_member_id_position_id_pk" PRIMARY KEY("member_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "position_product_kinds" (
	"workspace_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"product_kind_id" uuid NOT NULL,
	CONSTRAINT "position_product_kinds_position_id_product_kind_id_pk" PRIMARY KEY("position_id","product_kind_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"functions" text[] DEFAULT '{}'::text[] NOT NULL,
	"sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "product_kinds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'goods' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_kinds_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "product_kinds_type_chk" CHECK ("product_kinds"."type" in ('goods','service','work'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_kind_id" uuid;--> statement-breakpoint
ALTER TABLE "member_positions" ADD CONSTRAINT "member_positions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_positions" ADD CONSTRAINT "member_positions_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_positions" ADD CONSTRAINT "member_positions_position_fk" FOREIGN KEY ("workspace_id","position_id") REFERENCES "public"."positions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_product_kinds" ADD CONSTRAINT "position_product_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_product_kinds" ADD CONSTRAINT "position_product_kinds_position_fk" FOREIGN KEY ("workspace_id","position_id") REFERENCES "public"."positions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_product_kinds" ADD CONSTRAINT "position_product_kinds_kind_fk" FOREIGN KEY ("workspace_id","product_kind_id") REFERENCES "public"."product_kinds"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_kinds" ADD CONSTRAINT "product_kinds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_positions_position_idx" ON "member_positions" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_ws_name_uq" ON "positions" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_kinds_ws_name_uq" ON "product_kinds" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_kind_fk" FOREIGN KEY ("workspace_id","product_kind_id") REFERENCES "public"."product_kinds"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Перенос флага «курьер» (задача 1100) в должность «Курьер» с функцией courier: по одной на воркспейс, где есть отмеченные
INSERT INTO "positions" ("workspace_id", "name", "functions", "sections")
SELECT DISTINCT m."workspace_id", 'Курьер', ARRAY['courier']::text[], '{}'::text[]
FROM "members" m
WHERE m."is_courier";--> statement-breakpoint
INSERT INTO "member_positions" ("workspace_id", "member_id", "position_id")
SELECT m."workspace_id", m."id", p."id"
FROM "members" m
JOIN "positions" p ON p."workspace_id" = m."workspace_id" AND lower(p."name") = lower('Курьер')
WHERE m."is_courier";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "is_courier";--> statement-breakpoint
SELECT app_secure_tenant_table('public.product_kinds'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.positions'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.member_positions'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.position_product_kinds'::regclass);