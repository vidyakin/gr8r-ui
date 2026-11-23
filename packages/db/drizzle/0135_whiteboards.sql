-- Интерактивные доски (whiteboards): multi-tenant таблица с RLS
CREATE TABLE "whiteboards" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"viewport" jsonb DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "whiteboards_ws_updated_idx" ON "whiteboards" USING btree ("workspace_id","updated_at" DESC);--> statement-breakpoint
CREATE INDEX "whiteboards_ws_entity_idx" ON "whiteboards" USING btree ("workspace_id","entity_type","entity_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.whiteboards'::regclass);
