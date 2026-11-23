ALTER TABLE "ai_chat_sessions" ADD COLUMN IF NOT EXISTS "current_node_id" text;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD COLUMN IF NOT EXISTS "collected_data" jsonb DEFAULT '{}'::jsonb NOT NULL;
