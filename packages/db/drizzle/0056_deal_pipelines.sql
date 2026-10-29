CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_pipeline_id" uuid,
	"from_stage_id" uuid,
	"to_pipeline_id" uuid NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_lost_reasons" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_lost_reasons_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "deal_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_pipelines_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "deal_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'in_progress' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_stages_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "deal_stages_ws_pipeline_id_uq" UNIQUE("workspace_id","pipeline_id","id"),
	CONSTRAINT "deal_stages_category_chk" CHECK ("deal_stages"."category" in ('in_progress','won','lost')),
	CONSTRAINT "deal_stages_probability_chk" CHECK ("deal_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_stage_chk";--> statement-breakpoint
DROP INDEX "deals_ws_stage_idx";--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "stage_overdue_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "lost_reason_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "dsh_deal_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "dsh_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_lost_reasons" ADD CONSTRAINT "deal_lost_reasons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pipelines" ADD CONSTRAINT "deal_pipelines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stages" ADD CONSTRAINT "deal_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stages" ADD CONSTRAINT "deal_stages_pipeline_fk" FOREIGN KEY ("workspace_id","pipeline_id") REFERENCES "public"."deal_pipelines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_stage_history_deal_idx" ON "deal_stage_history" USING btree ("workspace_id","deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_stage_history_to_idx" ON "deal_stage_history" USING btree ("workspace_id","to_pipeline_id","to_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_lost_reasons_ws_name_uq" ON "deal_lost_reasons" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "deal_pipelines_ws_name_uq" ON "deal_pipelines" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "deal_pipelines_default_uq" ON "deal_pipelines" USING btree ("workspace_id") WHERE "deal_pipelines"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "deal_stages_pipeline_name_uq" ON "deal_stages" USING btree ("workspace_id","pipeline_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "deal_stages_one_won_uq" ON "deal_stages" USING btree ("workspace_id","pipeline_id") WHERE "deal_stages"."category" = 'won';--> statement-breakpoint
CREATE INDEX "deal_stages_pipeline_idx" ON "deal_stages" USING btree ("workspace_id","pipeline_id","sort_order");--> statement-breakpoint

-- ---- Перенос данных: воронка «Sales» в каждом воркспейсе, этапы из старого enum deals.stage ----
INSERT INTO deal_pipelines (workspace_id, name, sort_order, is_default)
SELECT w.id, 'Sales', 0, true FROM workspaces w;--> statement-breakpoint
INSERT INTO deal_stages (workspace_id, pipeline_id, name, color, sort_order, category, probability)
SELECT p.workspace_id, p.id, s.name, s.color, s.ord, s.category, s.prob
FROM deal_pipelines p
CROSS JOIN (VALUES
  ('Lead', 'gray', 0, 'in_progress', 10),
  ('Qualified', 'blue', 1, 'in_progress', 25),
  ('Proposal', 'violet', 2, 'in_progress', 50),
  ('Negotiation', 'amber', 3, 'in_progress', 75),
  ('Won', 'green', 4, 'won', 100),
  ('Lost', 'red', 5, 'lost', 0)
) AS s(name, color, ord, category, prob);--> statement-breakpoint
-- Причины проигрыша: из текстовых причин существующих сделок
INSERT INTO deal_lost_reasons (workspace_id, name, sort_order)
SELECT workspace_id, name, row_number() OVER (PARTITION BY workspace_id ORDER BY name) - 1
FROM (SELECT DISTINCT ON (workspace_id, lower(btrim(lost_reason))) workspace_id, btrim(lost_reason) AS name
      FROM deals WHERE lost_reason IS NOT NULL AND btrim(lost_reason) <> '' ORDER BY workspace_id, lower(btrim(lost_reason)), btrim(lost_reason)) r;--> statement-breakpoint
UPDATE deals d SET
  pipeline_id = s.pipeline_id,
  stage_id = s.id,
  stage_entered_at = d.updated_at
FROM deal_stages s
WHERE s.workspace_id = d.workspace_id
  AND s.sort_order = array_position(ARRAY['lead','qualified','proposal','negotiation','won','lost'], d.stage) - 1;--> statement-breakpoint
UPDATE deals d SET lost_reason_id = r.id
FROM deal_lost_reasons r
WHERE r.workspace_id = d.workspace_id AND lower(r.name) = lower(btrim(d.lost_reason));--> statement-breakpoint
-- История: первая запись каждой сделки — вход в текущий этап
INSERT INTO deal_stage_history (workspace_id, deal_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, created_at)
SELECT workspace_id, id, NULL, NULL, pipeline_id, stage_id, created_at FROM deals;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "stage_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_fk" FOREIGN KEY ("workspace_id","pipeline_id") REFERENCES "public"."deal_pipelines"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_fk" FOREIGN KEY ("workspace_id","pipeline_id","stage_id") REFERENCES "public"."deal_stages"("workspace_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_lost_reason_fk" FOREIGN KEY ("workspace_id","lost_reason_id") REFERENCES "public"."deal_lost_reasons"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_ws_stage_idx" ON "deals" USING btree ("workspace_id","pipeline_id","stage_id");--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "stage";

SELECT app_secure_tenant_table('public.deal_pipelines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.deal_stages'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.deal_lost_reasons'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.deal_stage_history'::regclass);--> statement-breakpoint
-- Автоматизации: «поле stage сделки изменилось на won/lost» -> триггеры «Сделка выиграна / проиграна»
CREATE FUNCTION public.fix_deal_stage_graph(g jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_set(g, '{nodes}', COALESCE((
    SELECT jsonb_agg(CASE
      WHEN n->>'type' = 'trigger.field_changed' AND n->'params'->>'entity' = 'deal' AND n->'params'->>'field' = 'stage' AND n->'params'->>'to' IN ('won','lost')
      THEN jsonb_set(jsonb_set(n, '{type}', to_jsonb('trigger.deal_' || (n->'params'->>'to'))), '{params}', '{}'::jsonb)
      ELSE n END ORDER BY o)
    FROM jsonb_array_elements(g->'nodes') WITH ORDINALITY AS t(n, o)), '[]'::jsonb))
$f$;--> statement-breakpoint
UPDATE flows SET graph = public.fix_deal_stage_graph(graph) WHERE graph::text LIKE '%"field":"stage"%' OR graph::text LIKE '%"field": "stage"%';--> statement-breakpoint
UPDATE flow_versions SET graph = public.fix_deal_stage_graph(graph),
  trigger_type = CASE WHEN graph::text ~ '"field": ?"stage"' AND graph::text ~ '"entity": ?"deal"' AND graph::text ~ '"to": ?"won"' THEN 'trigger.deal_won'
                      WHEN graph::text ~ '"field": ?"stage"' AND graph::text ~ '"entity": ?"deal"' AND graph::text ~ '"to": ?"lost"' THEN 'trigger.deal_lost' ELSE trigger_type END
WHERE trigger_type = 'trigger.field_changed' AND (graph::text LIKE '%"field":"stage"%' OR graph::text LIKE '%"field": "stage"%');
--> statement-breakpoint
DROP FUNCTION public.fix_deal_stage_graph(jsonb);
