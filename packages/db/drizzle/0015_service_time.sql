CREATE TABLE "work_order_lines" (
	"workspace_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"billing" text DEFAULT 'norm' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_lines_workspace_id_line_id_pk" PRIMARY KEY("workspace_id","line_id"),
	CONSTRAINT "work_order_lines_billing_chk" CHECK ("work_order_lines"."billing" in ('norm','hours'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_line_fk" FOREIGN KEY ("workspace_id","line_id") REFERENCES "public"."document_lines"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_lines_document_idx" ON "work_order_lines" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_ws_company_idx" ON "tasks" USING btree ("workspace_id","company_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_chk" CHECK ("tasks"."company_id" is null or "tasks"."module" = 'services');--> statement-breakpoint
-- Новая таблица — арендаторская: владелец, ENABLE+FORCE RLS, политика по workspace_id и права
SELECT app_secure_tenant_table('public.work_order_lines'::regclass);