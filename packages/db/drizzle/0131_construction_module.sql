-- Строительство — отдельный модуль тарифа (подмодуль «Производства») вместо отраслевой опции construction.
-- Доступ не отбираем: модуль получают тарифы и доп. модули с «Производством»; тарифы «Все модули» включают его сами.
UPDATE "license_plans" SET "modules" = array_append("modules", 'construction') WHERE 'production' = ANY("modules") AND NOT 'construction' = ANY("modules");--> statement-breakpoint
INSERT INTO "workspace_module_grants" ("workspace_id", "module", "expires_at", "created_by")
SELECT "workspace_id", 'construction', "expires_at", "created_by" FROM "workspace_module_grants" WHERE "module" = 'production'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "workspaces" SET "industry_options" = array_remove("industry_options", 'construction') WHERE 'construction' = ANY("industry_options");--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_industry_options_chk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_industry_options_chk" CHECK ("industry_options" <@ ARRAY['food']::text[]);
