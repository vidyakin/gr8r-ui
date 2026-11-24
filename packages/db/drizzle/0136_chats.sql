-- Встроенный мультиязычный чат с автопереводом: multi-tenant таблицы с RLS
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"kind" text DEFAULT 'group' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"guest_token" text,
	"guest_name" text,
	"guest_language" text DEFAULT 'en' NOT NULL,
	"created_by" uuid,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "chats_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "chats_kind_chk" CHECK ("kind" in ('direct','group','client')),
	CONSTRAINT "chats_entity_type_chk" CHECK ("entity_type" is null or "entity_type" in ('lead','deal','company','project'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "chats_guest_token_uq" ON "chats" USING btree ("guest_token") WHERE ("guest_token" is not null);--> statement-breakpoint
CREATE INDEX "chats_ws_last_msg_idx" ON "chats" USING btree ("workspace_id","last_message_at" DESC NULLS LAST,"created_at" DESC);--> statement-breakpoint
CREATE INDEX "chats_ws_entity_idx" ON "chats" USING btree ("workspace_id","entity_type","entity_id");--> statement-breakpoint
CREATE TABLE "chat_members" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"chat_id" uuid NOT NULL REFERENCES "public"."chats"("id") ON DELETE cascade,
	"member_id" uuid NOT NULL,
	"preferred_language" text,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_members_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_members_chat_member_uq" ON "chat_members" USING btree ("chat_id","member_id");--> statement-breakpoint
CREATE INDEX "chat_members_ws_member_idx" ON "chat_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "chat_members_ws_chat_idx" ON "chat_members" USING btree ("workspace_id","chat_id");--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"chat_id" uuid NOT NULL REFERENCES "public"."chats"("id") ON DELETE cascade,
	"sender_member_id" uuid,
	"sender_guest_name" text,
	"original_text" text NOT NULL,
	"original_language" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"translation_provider" text,
	"translation_status" text DEFAULT 'none' NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chat_messages_translation_status_chk" CHECK ("translation_status" in ('pending','done','failed','none')),
	CONSTRAINT "chat_messages_feedback_chk" CHECK ("feedback" is null or "feedback" in ('like','dislike'))
);--> statement-breakpoint
CREATE INDEX "chat_messages_ws_chat_created_idx" ON "chat_messages" USING btree ("workspace_id","chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_created_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
SELECT app_secure_tenant_table('public.chats'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.chat_members'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.chat_messages'::regclass);
