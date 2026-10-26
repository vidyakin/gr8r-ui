CREATE TABLE "material_allocation_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"release_item_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_allocation_items_ws_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "material_allocation_rows" DROP CONSTRAINT "material_allocation_rows_release_fk";
--> statement-breakpoint
ALTER TABLE "material_allocation_rows" DROP CONSTRAINT "material_allocation_rows_item_fk";
--> statement-breakpoint
ALTER TABLE "material_allocation_items" ADD CONSTRAINT "material_allocation_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_items" ADD CONSTRAINT "material_allocation_items_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_items" ADD CONSTRAINT "material_allocation_items_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_items" ADD CONSTRAINT "material_allocation_items_item_fk" FOREIGN KEY ("workspace_id","release_item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_allocation_items_doc_item_uq" ON "material_allocation_items" USING btree ("document_id","release_item_id");--> statement-breakpoint
CREATE INDEX "material_allocation_items_release_idx" ON "material_allocation_items" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "material_allocation_items_item_idx" ON "material_allocation_items" USING btree ("release_item_id");--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_allocation_rows" ADD CONSTRAINT "material_allocation_rows_item_fk" FOREIGN KEY ("workspace_id","release_item_id") REFERENCES "public"."production_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.material_allocation_items'::regclass);
