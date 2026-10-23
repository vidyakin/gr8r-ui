ALTER TABLE "work_order_assignments" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_interval_chk" CHECK ("work_order_assignments"."end_at" is null or "work_order_assignments"."start_at" is null or "work_order_assignments"."end_at" > "work_order_assignments"."start_at");
