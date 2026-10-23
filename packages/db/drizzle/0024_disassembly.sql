ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_kind_chk";--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_shape_chk";--> statement-breakpoint
ALTER TABLE "production_components" DROP CONSTRAINT "production_components_kind_chk";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_operation_chk";--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "cost_share" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD COLUMN "mode" text DEFAULT 'assembly' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_components" ADD COLUMN "cost_share" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_cost_share_chk" CHECK (("bom_lines"."kind" = 'output' and ("bom_lines"."cost_share" is null or "bom_lines"."cost_share" >= 0)) or ("bom_lines"."kind" <> 'output' and "bom_lines"."cost_share" is null));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_kind_chk" CHECK ("bom_lines"."kind" in ('material','semi','work','expense','output'));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_shape_chk" CHECK (("bom_lines"."kind" = 'material' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'expense' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'output' and "bom_lines"."product_id" is not null and "bom_lines"."child_item_id" is null)
        or ("bom_lines"."kind" = 'semi' and "bom_lines"."child_item_id" is not null and "bom_lines"."product_id" is null and "bom_lines"."child_item_id" <> "bom_lines"."item_id")
        or ("bom_lines"."kind" = 'work' and "bom_lines"."child_item_id" is null));--> statement-breakpoint
ALTER TABLE "manufactured_items" ADD CONSTRAINT "manufactured_items_mode_chk" CHECK ("manufactured_items"."mode" in ('assembly','disassembly'));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_cost_share_chk" CHECK (("production_components"."kind" = 'output' and ("production_components"."cost_share" is null or "production_components"."cost_share" >= 0)) or ("production_components"."kind" <> 'output' and "production_components"."cost_share" is null));--> statement-breakpoint
ALTER TABLE "production_components" ADD CONSTRAINT "production_components_kind_chk" CHECK ("production_components"."kind" in ('material','semi','work','expense','output'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_chk" CHECK ("documents"."operation" is null or "documents"."operation" in ('transfer','in_transit','to_operation','from_operation','assembly','disassembly'));