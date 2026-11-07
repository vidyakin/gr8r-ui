-- Сокращённые предпраздничные дни: вид дня календаря воркспейса (docs/architecture/resource-planning.md).
-- off — выходной или праздник (как было), short — день короче на short_hours часов.
ALTER TABLE "workspace_holidays" ADD COLUMN "kind" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_holidays" ADD COLUMN "short_hours" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_holidays" ADD CONSTRAINT "workspace_holidays_kind_chk" CHECK ("workspace_holidays"."kind" in ('off','short'));--> statement-breakpoint
ALTER TABLE "workspace_holidays" ADD CONSTRAINT "workspace_holidays_short_chk" CHECK (("workspace_holidays"."kind" = 'off' and "workspace_holidays"."short_hours" = 0) or ("workspace_holidays"."kind" = 'short' and "workspace_holidays"."short_hours" > 0));
