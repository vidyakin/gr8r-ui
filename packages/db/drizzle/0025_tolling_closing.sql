ALTER TABLE "processing_service_costs" ADD COLUMN "closing_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_report_fk" FOREIGN KEY ("workspace_id","report_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("report_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_service_costs" ADD CONSTRAINT "processing_service_costs_closing_fk" FOREIGN KEY ("workspace_id","closing_id") REFERENCES "public"."production_cost_closings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_service_costs_closing_idx" ON "processing_service_costs" USING btree ("workspace_id","closing_id");--> statement-breakpoint
-- составной FK с ON DELETE SET NULL обнулил бы и workspace_id (NOT NULL): обнуляется только ссылка на заказ на переработку
ALTER TABLE "documents" DROP CONSTRAINT "documents_tolling_order_fk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tolling_order_fk" FOREIGN KEY ("workspace_id","tolling_order_id") REFERENCES "public"."documents"("workspace_id","id") ON DELETE SET NULL ("tolling_order_id") ON UPDATE no action;
