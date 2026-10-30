ALTER TABLE "documents" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_deal_idx" ON "documents" USING btree ("workspace_id","deal_id");
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE SET NULL ("deal_id");
