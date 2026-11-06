-- Задача 1275: прогноз прибыли объекта (docs/architecture/construction.md). Ручная правка остатка прогноза —
-- ответственный (owner/admin) заменяет ожидаемые затраты по позиции сметы или по категории затрат целиком.
-- Всегда с причиной и автором: правка видна в отчёте с пометкой. Ровно одна цель — позиция или категория.
CREATE TABLE "object_forecast_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"estimate_item_id" uuid,
	"category" text,
	"remaining" numeric(18,2) NOT NULL,
	"reason" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_forecast_overrides_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_forecast_overrides_target_chk" CHECK (("estimate_item_id" is null) <> ("category" is null)),
	CONSTRAINT "object_forecast_overrides_category_chk" CHECK ("category" is null or "category" in ('material','labor','subcontract','other')),
	CONSTRAINT "object_forecast_overrides_remaining_chk" CHECK ("remaining" >= 0),
	CONSTRAINT "object_forecast_overrides_reason_chk" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_forecast_overrides_item_uq" ON "object_forecast_overrides" USING btree ("object_id","estimate_item_id") WHERE "estimate_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "object_forecast_overrides_category_uq" ON "object_forecast_overrides" USING btree ("object_id","category") WHERE "category" is not null;--> statement-breakpoint
CREATE INDEX "object_forecast_overrides_object_idx" ON "object_forecast_overrides" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "object_forecast_overrides" ADD CONSTRAINT "object_forecast_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_forecast_overrides" ADD CONSTRAINT "object_forecast_overrides_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_forecast_overrides" ADD CONSTRAINT "object_forecast_overrides_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_forecast_overrides" ADD CONSTRAINT "object_forecast_overrides_author_fk" FOREIGN KEY ("workspace_id","author_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("author_id") ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_forecast_overrides'::regclass);
