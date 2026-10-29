CREATE TABLE "doc_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT 'quote' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"is_used" boolean DEFAULT true NOT NULL,
	"only_author" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "doc_templates_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "doc_templates_purpose_chk" CHECK ("doc_templates"."purpose" in ('quote','contract','contract_order','contract_invoice','contract_work_order'))
);
--> statement-breakpoint
CREATE TABLE "document_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_variants_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "document_files" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "group_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "variant_name" text;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_author_fk" FOREIGN KEY ("workspace_id","author_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_variants" ADD CONSTRAINT "document_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_variants" ADD CONSTRAINT "document_variants_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_templates_ws_purpose_idx" ON "doc_templates" USING btree ("workspace_id","purpose");--> statement-breakpoint
CREATE INDEX "document_variants_document_idx" ON "document_variants" USING btree ("document_id","sort_order");--> statement-breakpoint
SELECT app_secure_tenant_table('public.doc_templates'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.document_variants'::regclass);
