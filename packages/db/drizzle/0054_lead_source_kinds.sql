ALTER TABLE "companies" ADD COLUMN "referrer_company_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "referrer_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "referrer_company_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "referrer_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "referrer_company_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "referrer_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "kind" text DEFAULT 'channel' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_kind_chk" CHECK ("lead_sources"."kind" in ('channel','partner','contact'));--> statement-breakpoint
-- Кто привёл (задача 1177): составные FK, при удалении родителя обнуляется только ссылка
ALTER TABLE "leads" ADD CONSTRAINT "leads_ref_company_fk" FOREIGN KEY ("workspace_id","referrer_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE SET NULL ("referrer_company_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_ref_contact_fk" FOREIGN KEY ("workspace_id","referrer_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("referrer_contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ref_company_fk" FOREIGN KEY ("workspace_id","referrer_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE SET NULL ("referrer_company_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ref_contact_fk" FOREIGN KEY ("workspace_id","referrer_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("referrer_contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_ref_company_fk" FOREIGN KEY ("workspace_id","referrer_company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE SET NULL ("referrer_company_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_ref_contact_fk" FOREIGN KEY ("workspace_id","referrer_contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("referrer_contact_id") ON UPDATE no action;
