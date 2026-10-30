ALTER TABLE "payroll_kinds" DROP CONSTRAINT "payroll_kinds_base_chk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payroll_trip_piecework_rate" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payroll_trip_km_rate" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payroll_trip_stop_rate" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payroll_trip_perdiem_rate" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_trip_fk" FOREIGN KEY ("workspace_id","trip_id") REFERENCES "public"."fleet_trips"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_lines_trip_idx" ON "payroll_lines" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "payroll_kinds" ADD CONSTRAINT "payroll_kinds_base_chk" CHECK ("payroll_kinds"."base_type" in ('salary','piecework','sales_percent','bonus','one_time','deduction','trip_piecework','trip_km','trip_stop','trip_perdiem'));