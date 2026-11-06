-- Задача 1276: рейтинг поставщиков — веса показателей и политика при уровне D (docs/architecture/supplier-rating.md).
ALTER TABLE workspaces
  ADD COLUMN supplier_rating_weights jsonb NOT NULL DEFAULT '{"onTime":40,"completeness":30,"quality":30}'::jsonb,
  ADD COLUMN supplier_rating_d_policy text NOT NULL DEFAULT 'none';--> statement-breakpoint

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_supplier_rating_d_policy_chk CHECK (supplier_rating_d_policy IN ('none','warn','block'));
