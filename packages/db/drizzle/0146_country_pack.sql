ALTER TABLE organizations
  ADD COLUMN country text NOT NULL DEFAULT 'RU',
  ADD COLUMN requisites jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT organizations_country_chk CHECK (country IN ('RU', 'KZ', 'AE'));
--> statement-breakpoint
ALTER TABLE companies
  ADD COLUMN country text NOT NULL DEFAULT 'RU',
  ADD COLUMN requisites jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT companies_country_chk CHECK (country IN ('RU', 'KZ', 'AE'));
--> statement-breakpoint
ALTER TABLE organizations
  DROP CONSTRAINT organizations_tax_chk,
  ADD CONSTRAINT organizations_tax_chk CHECK (tax_system IN ('osn', 'usn', 'our', 'simplified', 'standard', 'exempt'));
--> statement-breakpoint
ALTER TABLE organizations
  DROP CONSTRAINT organizations_vat_chk,
  ADD CONSTRAINT organizations_vat_chk CHECK (default_vat_rate = 'none' OR default_vat_rate ~ '^[0-9]+(\.[0-9]+)?$');
--> statement-breakpoint
ALTER TABLE products
  DROP CONSTRAINT products_vat_chk,
  ADD CONSTRAINT products_vat_chk CHECK (vat_rate = 'none' OR vat_rate ~ '^[0-9]+(\.[0-9]+)?$');
--> statement-breakpoint
ALTER TABLE document_lines
  DROP CONSTRAINT document_lines_vat_chk,
  ADD CONSTRAINT document_lines_vat_chk CHECK (vat_rate = 'none' OR vat_rate ~ '^[0-9]+(\.[0-9]+)?$');
--> statement-breakpoint
ALTER TABLE object_estimate_items
  DROP CONSTRAINT object_estimate_items_vat_chk,
  ADD CONSTRAINT object_estimate_items_vat_chk CHECK (vat_rate = 'none' OR vat_rate ~ '^[0-9]+(\.[0-9]+)?$');
--> statement-breakpoint
ALTER TABLE object_act_lines
  DROP CONSTRAINT object_act_lines_vat_chk,
  ADD CONSTRAINT object_act_lines_vat_chk CHECK (vat_rate = 'none' OR vat_rate ~ '^[0-9]+(\.[0-9]+)?$');
