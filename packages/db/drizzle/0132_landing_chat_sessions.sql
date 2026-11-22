-- Журнал диалогов ИИ-консультантов (лендинг и будущие боты): multi-tenant таблица с RLS
CREATE TABLE "ai_chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	"bot_name" text DEFAULT 'landing' NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text,
	"locale" text DEFAULT 'ru' NOT NULL,
	"page_url" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_ws_updated_idx" ON "ai_chat_sessions" USING btree ("workspace_id","updated_at" DESC);--> statement-breakpoint
CREATE INDEX "ai_chat_sessions_ws_ip_idx" ON "ai_chat_sessions" USING btree ("workspace_id","ip");--> statement-breakpoint
SELECT app_secure_tenant_table('public.ai_chat_sessions'::regclass);
