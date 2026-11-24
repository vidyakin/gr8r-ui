ALTER TABLE "integrations_1c_links"
  DROP CONSTRAINT "integrations_1c_links_source_chk",
  DROP CONSTRAINT "integrations_1c_links_entity_type_chk",
  ADD CONSTRAINT "integrations_1c_links_source_chk" CHECK ("source" IN ('buh3', 'ut', 'unf')),
  ADD CONSTRAINT "integrations_1c_links_entity_type_chk" CHECK ("entity_type" IN
    ('organization', 'company', 'product', 'bank_account', 'document', 'contract', 'warehouse', 'cash_register'));
