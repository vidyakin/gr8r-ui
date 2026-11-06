-- Задача 1273: акты КС-2/КС-3 по объекту, выручка «по объёмам», «по вехе» и «по часам» (docs/architecture/construction.md).
-- Акт: черновик → подписан заказчиком (принято); из подписанного акта выставляются счёт и документ «Акт оказания услуг».
ALTER TABLE "objects" ADD COLUMN "customer_hour_rate" numeric(18,2);--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_customer_hour_rate_chk" CHECK ("objects"."customer_hour_rate" is null or "objects"."customer_hour_rate" >= 0);--> statement-breakpoint
CREATE TABLE "object_acts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"act_date" date NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"kind" text DEFAULT 'volumes' NOT NULL,
	"milestone_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"invoice_document_id" uuid,
	"act_document_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_acts_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_acts_kind_chk" CHECK ("object_acts"."kind" in ('volumes','milestone','hours')),
	CONSTRAINT "object_acts_status_chk" CHECK ("object_acts"."status" in ('draft','signed')),
	CONSTRAINT "object_acts_period_chk" CHECK ("object_acts"."period_from" <= "object_acts"."period_to"),
	CONSTRAINT "object_acts_signed_chk" CHECK (("object_acts"."status" = 'draft' and "object_acts"."signed_at" is null and "object_acts"."signed_by" is null) or ("object_acts"."status" = 'signed' and "object_acts"."signed_at" is not null)),
	CONSTRAINT "object_acts_milestone_kind_chk" CHECK (("object_acts"."kind" = 'milestone') = ("object_acts"."milestone_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_acts_ws_number_uq" ON "object_acts" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE INDEX "object_acts_object_idx" ON "object_acts" USING btree ("workspace_id","object_id","act_date");--> statement-breakpoint
CREATE INDEX "object_acts_milestone_idx" ON "object_acts" USING btree ("workspace_id","milestone_id");--> statement-breakpoint
CREATE TABLE "object_act_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"act_id" uuid NOT NULL,
	"estimate_item_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"unit_code" text DEFAULT '796' NOT NULL,
	"qty" numeric(18,3) NOT NULL,
	"price" numeric(18,2) DEFAULT '0' NOT NULL,
	"vat_rate" text DEFAULT '20' NOT NULL,
	"amount" numeric(18,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_act_lines_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_act_lines_qty_chk" CHECK ("object_act_lines"."qty" > 0 and "object_act_lines"."price" >= 0 and "object_act_lines"."amount" >= 0),
	CONSTRAINT "object_act_lines_vat_chk" CHECK ("object_act_lines"."vat_rate" in ('none','0','5','7','10','20'))
);
--> statement-breakpoint
CREATE INDEX "object_act_lines_act_idx" ON "object_act_lines" USING btree ("act_id","sort_order");--> statement-breakpoint
CREATE INDEX "object_act_lines_item_idx" ON "object_act_lines" USING btree ("workspace_id","estimate_item_id");--> statement-breakpoint
CREATE TABLE "object_act_shift_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"act_id" uuid NOT NULL,
	"shift_hour_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_act_shift_hours_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "object_act_shift_hours_hour_uq" UNIQUE("workspace_id","shift_hour_id")
);
--> statement-breakpoint
CREATE INDEX "object_act_shift_hours_act_idx" ON "object_act_shift_hours" USING btree ("act_id");--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_object_fk" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_milestone_fk" FOREIGN KEY ("workspace_id","milestone_id") REFERENCES "public"."object_milestones"("workspace_id","id") ON DELETE SET NULL ("milestone_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_signed_by_fk" FOREIGN KEY ("workspace_id","signed_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE SET NULL ("signed_by") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_invoice_document_fk" FOREIGN KEY ("workspace_id","invoice_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("invoice_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_acts" ADD CONSTRAINT "object_acts_act_document_fk" FOREIGN KEY ("workspace_id","act_document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("act_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_lines" ADD CONSTRAINT "object_act_lines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_lines" ADD CONSTRAINT "object_act_lines_act_fk" FOREIGN KEY ("workspace_id","act_id") REFERENCES "public"."object_acts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_lines" ADD CONSTRAINT "object_act_lines_item_fk" FOREIGN KEY ("workspace_id","estimate_item_id") REFERENCES "public"."object_estimate_items"("workspace_id","id") ON DELETE SET NULL ("estimate_item_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_lines" ADD CONSTRAINT "object_act_lines_unit_fk" FOREIGN KEY ("workspace_id","unit_code") REFERENCES "public"."units"("workspace_id","code") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_shift_hours" ADD CONSTRAINT "object_act_shift_hours_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_shift_hours" ADD CONSTRAINT "object_act_shift_hours_act_fk" FOREIGN KEY ("workspace_id","act_id") REFERENCES "public"."object_acts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_act_shift_hours" ADD CONSTRAINT "object_act_shift_hours_hour_fk" FOREIGN KEY ("workspace_id","shift_hour_id") REFERENCES "public"."object_shift_hours"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_acts'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_act_lines'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.object_act_shift_hours'::regclass);
