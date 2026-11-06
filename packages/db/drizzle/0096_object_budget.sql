-- Задача 1270: бюджет объекта с контролем (docs/architecture/construction.md).
-- Политика контроля бюджета у объекта: none — не контролировать, warn — предупредить, block — запретить проведение.
ALTER TABLE "objects" ADD COLUMN "budget_policy" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_budget_policy_chk" CHECK ("objects"."budget_policy" in ('none','warn','block'));
