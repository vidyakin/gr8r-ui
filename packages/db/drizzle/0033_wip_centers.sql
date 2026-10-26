ALTER TABLE "production_headers" ADD COLUMN "final_work_center_id" uuid;--> statement-breakpoint
ALTER TABLE "production_items" ADD COLUMN "closing_cost" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_headers" ADD CONSTRAINT "production_headers_final_work_center_fk" FOREIGN KEY ("workspace_id","final_work_center_id") REFERENCES "public"."work_centers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- завершающий участок существующих заказов и выпусков — их собственный участок
UPDATE "production_headers" SET "final_work_center_id" = "work_center_id" WHERE "work_center_id" IS NOT NULL AND "final_work_center_id" IS NULL;
