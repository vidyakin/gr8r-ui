CREATE TABLE "supplier_portal_links" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL,
  "secret" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "expires_at" timestamptz,
  "last_accessed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "supplier_portal_links_company_fk" FOREIGN KEY ("workspace_id", "company_id") REFERENCES "companies" ("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "supplier_portal_links_company_uq" UNIQUE ("workspace_id", "company_id"),
  CONSTRAINT "supplier_portal_links_secret_uq" UNIQUE ("workspace_id", "secret")
);--> statement-breakpoint
SELECT app_secure_tenant_table('public.supplier_portal_links'::regclass);--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN "supplier_status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN "expected_ship_date" date,
  ADD COLUMN "supplier_comment" text NOT NULL DEFAULT '',
  ADD COLUMN "supplier_confirmed_at" timestamptz,
  ADD CONSTRAINT "documents_supplier_status_chk" CHECK ("supplier_status" IN ('pending', 'confirmed', 'shipped', 'declined'));--> statement-breakpoint
CREATE INDEX "documents_supplier_portal_idx" ON "documents" ("workspace_id", "counterparty_id", "date" DESC)
  WHERE "type" = 'supplier_order' AND "status" = 'posted';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "supplier_portal_company_id" uuid;
--> statement-breakpoint
CREATE FUNCTION app_reset_supplier_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.supplier_status := 'pending';
  NEW.expected_ship_date := NULL;
  NEW.supplier_comment := '';
  NEW.supplier_confirmed_at := NULL;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER documents_reset_supplier_response
  BEFORE UPDATE OF counterparty_id ON documents
  FOR EACH ROW WHEN (OLD.type = 'supplier_order' AND OLD.counterparty_id IS DISTINCT FROM NEW.counterparty_id)
  EXECUTE FUNCTION app_reset_supplier_response();
