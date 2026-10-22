CREATE TABLE "production_placements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_placements_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "production_placements_qty_chk" CHECK ("production_placements"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_owner_chk";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "default_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "production_components" ADD COLUMN "source_component_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "production_component_id" uuid;--> statement-breakpoint
ALTER TABLE "production_placements" ADD CONSTRAINT "production_placements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_placements" ADD CONSTRAINT "production_placements_component_fk" FOREIGN KEY ("workspace_id","component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_placements" ADD CONSTRAINT "production_placements_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_placements" ADD CONSTRAINT "production_placements_line_fk" FOREIGN KEY ("workspace_id","document_line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_placements_line_uq" ON "production_placements" USING btree ("workspace_id","document_line_id") WHERE "production_placements"."document_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "production_placements_document_uq" ON "production_placements" USING btree ("workspace_id","component_id","document_id") WHERE "production_placements"."document_line_id" is null;--> statement-breakpoint
CREATE INDEX "production_placements_component_idx" ON "production_placements" USING btree ("workspace_id","component_id");--> statement-breakpoint
CREATE INDEX "production_placements_document_idx" ON "production_placements" USING btree ("workspace_id","document_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_supplier_fk" FOREIGN KEY ("workspace_id","default_supplier_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_source_fk" FOREIGN KEY ("workspace_id","source_component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_components_source_idx" ON "production_components" USING btree ("source_component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_component_uq" ON "stock_reservations" USING btree ("workspace_id","production_component_id","warehouse_id") WHERE "stock_reservations"."production_component_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_reservations_component_idx" ON "stock_reservations" USING btree ("workspace_id","production_component_id");--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_owner_chk" CHECK (num_nonnulls("stock_reservations"."document_line_id", "stock_reservations"."production_line_id", "stock_reservations"."production_component_id") = 1);--> statement-breakpoint
-- Составной FK резрва материалов на строку состава заказа на производство: в схеме его нет намеренно
-- (documents.ts не может ссылаться на production.ts — схема документов зациклилась бы), поэтому он добавлен здесь.
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_component_fk" FOREIGN KEY ("workspace_id","production_component_id") REFERENCES "public"."production_components"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.production_placements'::regclass);--> statement-breakpoint
-- Резерв материалов уже проведённых незакрытых заказов на производство: свободный остаток склада материалов
-- распределяется по заказам по очереди (по дате и id заказа) — несколько заказов не займут одно и то же количество.
-- Списанное прежними выпусками не вычитается: связи выпуска со строкой состава заказа до этой миграции не было.
WITH comps AS (
  SELECT pc.id, pc.workspace_id, pc.document_id, pc.product_id, pc.qty AS need, o.warehouse_id, o.date, o.id AS order_id
  FROM production_components pc
  JOIN documents o ON o.id = pc.document_id AND o.workspace_id = pc.workspace_id
  WHERE pc.kind IN ('material','semi') AND pc.product_id IS NOT NULL
    AND o.type = 'production_order' AND o.status = 'posted' AND o.warehouse_id IS NOT NULL
    AND o.state IS DISTINCT FROM 'done' AND o.state IS DISTINCT FROM 'closed'
), res AS (
  SELECT workspace_id, warehouse_id, product_id, sum(qty) AS reserved
  FROM stock_reservations GROUP BY 1,2,3
), avail AS (
  SELECT c.*, greatest(coalesce(b.qty,0) - coalesce(r.reserved,0), 0) AS free,
         coalesce(sum(c.need) OVER (PARTITION BY c.workspace_id, c.warehouse_id, c.product_id ORDER BY c.date, c.order_id, c.id
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
  FROM comps c
  LEFT JOIN stock_balances b ON b.workspace_id = c.workspace_id AND b.product_id = c.product_id AND b.warehouse_id = c.warehouse_id
  LEFT JOIN res r ON r.workspace_id = c.workspace_id AND r.product_id = c.product_id AND r.warehouse_id = c.warehouse_id
), free AS (
  SELECT a.*, least(a.need, greatest(a.free - a.before, 0)) AS qty FROM avail a
)
INSERT INTO stock_reservations (workspace_id, document_id, production_component_id, warehouse_id, product_id, qty, updated_at)
SELECT f.workspace_id, f.document_id, f.id, f.warehouse_id, f.product_id, f.qty::numeric(18,3), now()
FROM free f
WHERE f.qty > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_reservations s
    WHERE s.workspace_id = f.workspace_id AND s.production_component_id = f.id AND s.warehouse_id = f.warehouse_id
  );
