-- Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md).
-- api_tokens: токен выпускается на участника воркспейса и может только сузить его права (роль, должности, RLS действуют как у сотрудника).
-- users.is_service: служебный сотрудник (агент без человека) — вход по паролю запрещён (password_hash = '!service').
-- events.api_token_id: событие, записанное запросом по токену, помечается им без правки мест вызова recordEvent
-- (setContext выставляет app.api_token_id, default колонки читает current_setting).

ALTER TABLE "users" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "api_token_id" uuid DEFAULT nullif(current_setting('app.api_token_id', true), '')::uuid;--> statement-breakpoint

CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"sections" text[],
	"can_post" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_ws_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "api_tokens_name_chk" CHECK (char_length("name") between 1 and 120)
);--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE set null ("created_by") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_ws_member_idx" ON "api_tokens" USING btree ("workspace_id","member_id");--> statement-breakpoint

-- RLS как у соседних таблиц: владелец app_owner, ENABLE+FORCE, политика по workspace_id, права ролям.
SELECT app_secure_tenant_table('public.api_tokens'::regclass);--> statement-breakpoint

-- Поиск токена в requireSession идёт без арендатора, а таблица под RLS — функция SECURITY DEFINER (владелец app_worker,
-- как app_workspace_license) читает неотозванный и неистёкший токен по sha256, обновляет last_used_at не чаще раза в минуту.
CREATE OR REPLACE FUNCTION app_api_token_lookup(p_hash text)
RETURNS TABLE (id uuid, workspace_id uuid, member_id uuid, user_id uuid, read_only boolean, sections text[], can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE api_tokens AS t
  SET last_used_at = CASE WHEN t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute' THEN now() ELSE t.last_used_at END
  WHERE t.token_hash = p_hash
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now())
  RETURNING
    t.id, t.workspace_id, t.member_id,
    (SELECT m.user_id FROM members m WHERE m.id = t.member_id AND m.workspace_id = t.workspace_id),
    t.read_only, t.sections, t.can_post;
END $$;--> statement-breakpoint
ALTER FUNCTION app_api_token_lookup(text) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_api_token_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_api_token_lookup(text) TO app_user;
