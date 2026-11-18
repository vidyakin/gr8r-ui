-- Почта, инкремент А (задача 1092, docs/architecture/email.md): ящики, письма, связь касания CRM с письмом.
-- Пишется вручную (снимки meta/ после 0088 не ведутся). Пароль ящика — в workspace_secrets (`mailbox.<id>.password`).
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_secure" text DEFAULT 'ssl' NOT NULL,
	"smtp_user" text NOT NULL,
	"imap_host" text,
	"imap_port" integer,
	"imap_secure" text,
	"imap_user" text,
	"signature" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"last_error" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "mailboxes_kind_chk" CHECK (("kind" = 'shared' and "member_id" is null) or ("kind" = 'personal' and "member_id" is not null)),
	CONSTRAINT "mailboxes_smtp_secure_chk" CHECK ("smtp_secure" in ('ssl','starttls','none')),
	CONSTRAINT "mailboxes_imap_secure_chk" CHECK ("imap_secure" is null or "imap_secure" in ('ssl','starttls','none')),
	CONSTRAINT "mailboxes_status_chk" CHECK ("status" in ('ok','error','unchecked'))
);--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"direction" text DEFAULT 'out' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"to" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text,
	"message_id" text,
	"in_reply_to" text,
	"references" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_by" uuid,
	"lead_id" uuid,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"document_id" uuid,
	"print_form" text,
	"print_template_id" uuid,
	"attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "email_messages_direction_chk" CHECK ("direction" in ('out','in')),
	CONSTRAINT "email_messages_status_chk" CHECK ("status" in ('queued','sending','sent','failed','received'))
);--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "email_message_id" uuid;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mailboxes"("workspace_id","id") ON DELETE SET NULL ("mailbox_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "ca_email_fk" FOREIGN KEY ("workspace_id","email_message_id") REFERENCES "public"."email_messages"("workspace_id","id") ON DELETE SET NULL ("email_message_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_shared_uq" ON "mailboxes" USING btree ("workspace_id") WHERE "kind" = 'shared';--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_personal_uq" ON "mailboxes" USING btree ("workspace_id","member_id") WHERE "kind" = 'personal';--> statement-breakpoint
CREATE INDEX "email_messages_ws_created_idx" ON "email_messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "email_messages_lead_idx" ON "email_messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "email_messages_contact_idx" ON "email_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "email_messages_company_idx" ON "email_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_messages_deal_idx" ON "email_messages" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "email_messages_document_idx" ON "email_messages" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "email_messages_message_id_idx" ON "email_messages" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "crm_activities_email_idx" ON "crm_activities" USING btree ("email_message_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.mailboxes'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.email_messages'::regclass);
