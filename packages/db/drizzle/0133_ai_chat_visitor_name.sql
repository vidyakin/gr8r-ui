-- Никнейм посетителя чат-бота (например, «Благородный панголин») для группировки переписок в CRM
ALTER TABLE "ai_chat_sessions" ADD COLUMN IF NOT EXISTS "visitor_name" text;
