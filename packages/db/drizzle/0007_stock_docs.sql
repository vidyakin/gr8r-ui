CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	"system_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cost_items_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "cost_items_kind_chk" CHECK ("cost_items"."kind" in ('expense','income'))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_type_chk";--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "document_lines" ADD COLUMN "stock_role" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "operation" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "target_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "cost_item_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "kind" text DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_items_ws_name_uq" ON "cost_items" USING btree ("workspace_id",lower("name")) WHERE "cost_items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_items_system_uq" ON "cost_items" USING btree ("workspace_id","system_key") WHERE "cost_items"."system_key" is not null;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_warehouse_fk" FOREIGN KEY ("workspace_id","warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_target_warehouse_fk" FOREIGN KEY ("workspace_id","target_warehouse_id") REFERENCES "public"."warehouses"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_cost_item_fk" FOREIGN KEY ("workspace_id","cost_item_id") REFERENCES "public"."cost_items"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_stock_role_chk" CHECK ("document_lines"."stock_role" is null or "document_lines"."stock_role" in ('in','out'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_state_chk" CHECK ("documents"."state" is null or "documents"."state" ~ '^[a-z][a-z0-9_]*$');--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transfer_chk" CHECK ("documents"."type" <> 'stock_transfer' or ("documents"."target_warehouse_id" is not null and "documents"."target_warehouse_id" <> "documents"."warehouse_id"));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_chk" CHECK ("documents"."type" in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting'));--> statement-breakpoint

-- Изоляция арендаторов: справочник статей затрат и доходов — арендаторская таблица
SELECT app_secure_tenant_table('public.cost_items'::regclass);
--> statement-breakpoint
-- Системные статьи для уже существующих воркспейсов (новым их создаёт ensureCostItems): без статьи не провести списание и оприходование
INSERT INTO "cost_items" ("workspace_id", "name", "kind", "system_key")
SELECT w.id, v.name, v.kind, v.key
FROM "workspaces" w
CROSS JOIN (VALUES
  ('brak', 'Брак', 'expense'),
  ('porcha', 'Порча', 'expense'),
  ('nedostacha', 'Недостача', 'expense'),
  ('othody', 'Отходы', 'expense'),
  ('v_expluaciatsiyu', 'Передача в эксплуатацию', 'expense'),
  ('izlishki', 'Излишки', 'income')
) AS v(key, name, kind)
ON CONFLICT DO NOTHING;
