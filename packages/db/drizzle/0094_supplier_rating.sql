ALTER TABLE workspaces
  ADD COLUMN supplier_rating_weights jsonb NOT NULL DEFAULT '{"onTime":40,"completeness":30,"quality":30}'::jsonb,
  ADD COLUMN supplier_rating_d_policy text NOT NULL DEFAULT 'none';

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_supplier_rating_d_policy_chk CHECK (supplier_rating_d_policy IN ('none','warn','block'));
