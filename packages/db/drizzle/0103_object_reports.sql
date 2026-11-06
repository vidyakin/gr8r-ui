-- Задача 1277: сводка о ходе работ по объекту по расписанию (docs/architecture/construction.md).
-- У объекта одна настройка: включена ли сводка, день недели (1–7) и время «HH:MM» в часовом поясе воркспейса,
-- получатели — участники воркспейса (пусто — ответственный и прорабы объекта, подставляет сервис).
-- Задача воркера object.progress_report раз в минуту выбирает объекты с наступившим окном и создаёт внутренние
-- уведомления со сводкой (почта и SMS отложены, задача 1092). last_sent_at делает повторный проход идемпотентным.
CREATE TABLE "object_report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"time" text DEFAULT '09:00' NOT NULL,
	"recipient_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_report_schedules_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_report_schedules_object_uq" UNIQUE("workspace_id","object_id"),
	CONSTRAINT "object_report_schedules_weekday_chk" CHECK ("weekday" between 1 and 7),
	CONSTRAINT "object_report_schedules_time_chk" CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE INDEX "object_report_schedules_ws_idx" ON "object_report_schedules" USING btree ("workspace_id","enabled");--> statement-breakpoint
ALTER TABLE "object_report_schedules" ADD CONSTRAINT "object_report_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_report_schedules" ADD CONSTRAINT "object_report_schedules_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_report_schedules'::regclass);
--> statement-breakpoint
-- Ссылка уведомления на объект: сводка о ходе открывается в карточке объекта (другие уведомления её не заполняют)
ALTER TABLE "notifications" ADD COLUMN "object_id" uuid;--> statement-breakpoint
CREATE INDEX "notifications_object_idx" ON "notifications" USING btree ("workspace_id","object_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notif_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE SET NULL ("object_id") ON UPDATE no action;
