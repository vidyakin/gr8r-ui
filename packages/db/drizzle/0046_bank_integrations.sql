CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_prefix" text NOT NULL,
	"sync_from" date,
	"auto_post" boolean DEFAULT true NOT NULL,
	"synced_through" date,
	"last_sync_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "bank_connections_provider_chk" CHECK ("bank_connections"."provider" in ('tbank','tochka','sber','yookassa'))
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_payment_id" text NOT NULL,
	"confirmation_url" text NOT NULL,
	"receipt_document_id" uuid,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "payment_links_status_chk" CHECK ("payment_links"."status" in ('pending','succeeded','canceled')),
	CONSTRAINT "payment_links_amount_chk" CHECK ("payment_links"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_account_fk" FOREIGN KEY ("workspace_id","bank_account_id") REFERENCES "public"."bank_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."bank_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_connections_account_uq" ON "bank_connections" USING btree ("workspace_id","bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_provider_uq" ON "payment_links" USING btree ("workspace_id","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payment_links_document_idx" ON "payment_links" USING btree ("document_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.bank_connections'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.payment_links'::regclass);
