-- Задача 1272: процент выполнения объекта и вехи (docs/architecture/construction.md).
-- Способ расчёта процента: tasks_closed — доля задач в завершённых статусах, tasks_avg — средний прогресс задач,
-- task_weights — то же с весами задач, estimate_volume — выполненный объём позиций согласованной сметы, manual — вручную.
ALTER TABLE "objects" ADD COLUMN "progress_mode" text DEFAULT 'tasks_closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "progress_manual" numeric(5,2);--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_progress_mode_chk" CHECK ("objects"."progress_mode" in ('tasks_closed','tasks_avg','task_weights','estimate_volume','manual'));--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_progress_manual_chk" CHECK ("objects"."progress_manual" is null or ("objects"."progress_manual" >= 0 and "objects"."progress_manual" <= 100));--> statement-breakpoint
-- Вес задачи для расчёта по весам: нет веса — 1
ALTER TABLE "tasks" ADD COLUMN "weight" numeric(10,2);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weight_chk" CHECK ("tasks"."weight" is null or "tasks"."weight" > 0);--> statement-breakpoint
-- Выполненный объём позиции сметы: факт, правится и у согласованной сметы; позже обновляется сменным отчётом (1271)
ALTER TABLE "object_estimate_items" ADD COLUMN "done_qty" numeric(18,3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_estimate_items" ADD CONSTRAINT "object_estimate_items_done_qty_chk" CHECK ("object_estimate_items"."done_qty" >= 0 and "object_estimate_items"."done_qty" <= "object_estimate_items"."qty");--> statement-breakpoint
-- Вехи объекта: этап (выполнение) или аванс (деньги вперёд, не выполнение); сумма или процент стоимости договора
CREATE TABLE "object_milestones" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"kind" text DEFAULT 'stage' NOT NULL,
	"amount" numeric(18,2),
	"pct" numeric(5,2),
	"done_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_milestones_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_milestones_kind_chk" CHECK ("object_milestones"."kind" in ('stage','advance')),
	CONSTRAINT "object_milestones_amount_chk" CHECK ((("object_milestones"."amount" is null) <> ("object_milestones"."pct" is null)) and ("object_milestones"."amount" is null or "object_milestones"."amount" >= 0) and ("object_milestones"."pct" is null or ("object_milestones"."pct" >= 0 and "object_milestones"."pct" <= 100))),
	CONSTRAINT "object_milestones_accepted_chk" CHECK ("object_milestones"."accepted_at" is null or "object_milestones"."done_at" is not null)
);
--> statement-breakpoint
CREATE INDEX "object_milestones_object_idx" ON "object_milestones" USING btree ("workspace_id","object_id","sort_order");--> statement-breakpoint
ALTER TABLE "object_milestones" ADD CONSTRAINT "object_milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_milestones" ADD CONSTRAINT "object_milestones_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_milestones'::regclass);
