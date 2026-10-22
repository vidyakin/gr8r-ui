CREATE TABLE "document_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text DEFAULT 'application/zip' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"data" "bytea",
	"storage_key" text,
	"error" text,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "document_exports_status_chk" CHECK ("document_exports"."status" in ('pending','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "document_exports" ADD CONSTRAINT "document_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_exports_ws_idx" ON "document_exports" USING btree ("workspace_id","created_at");--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_exports'::regclass);--> statement-breakpoint
