ALTER TABLE "bom_lines" ADD COLUMN "semi_mode" text;--> statement-breakpoint
UPDATE "bom_lines" SET "semi_mode" = 'stock' WHERE "kind" = 'semi';--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_semi_mode_chk" CHECK (("bom_lines"."kind" = 'semi' and "bom_lines"."semi_mode" is not null and "bom_lines"."semi_mode" in ('stock','explode')) or ("bom_lines"."kind" <> 'semi' and "bom_lines"."semi_mode" is null));
