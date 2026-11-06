-- Задача 1258: отраслевые опции воркспейса (docs/architecture/industry-options.md).
-- Бесплатная настройка вида интерфейса, не модуль тарифа: food — пищевое производство (партии, сроки годности, карантин),
-- construction — строительство и монтаж. Пустой набор — все отраслевые поля и разделы скрыты (новые воркспейсы).
ALTER TABLE "workspaces" ADD COLUMN "industry_options" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_industry_options_chk" CHECK ("workspaces"."industry_options" <@ ARRAY['food','construction']::text[]);--> statement-breakpoint
-- Существующие воркспейсы получают все опции: их экраны не должны измениться
UPDATE "workspaces" SET "industry_options" = '{food,construction}';
