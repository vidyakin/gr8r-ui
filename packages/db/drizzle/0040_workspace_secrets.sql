CREATE TABLE "workspace_secrets" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_secrets_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "workspace_secrets" ADD CONSTRAINT "workspace_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.workspace_secrets'::regclass);
