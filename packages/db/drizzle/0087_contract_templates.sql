CREATE TABLE "contract_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"template_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"data" "bytea",
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "contract_files_status_chk" CHECK ("contract_files"."status" in ('pending','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "org_signer_basis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "party_signer_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "party_signer_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "party_signer_basis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_files" ADD CONSTRAINT "contract_files_contract_fk" FOREIGN KEY ("workspace_id","contract_id") REFERENCES "public"."contracts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_files_contract_idx" ON "contract_files" USING btree ("contract_id","created_at");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.contract_files'::regclass);
