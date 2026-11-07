-- Задача 1287 (docs/architecture/mcp.md, «Запись»).
-- activity.api_token_id: строка ленты, записанная запросом по токену агента, помечается им (как events.api_token_id).
ALTER TABLE "activity" ADD COLUMN "api_token_id" uuid DEFAULT nullif(current_setting('app.api_token_id', true), '')::uuid;--> statement-breakpoint
-- Поиск токена без записи на каждый запрос: last_used_at обновляется не чаще раза в минуту отдельным UPDATE.
CREATE OR REPLACE FUNCTION app_api_token_lookup(p_hash text)
RETURNS TABLE (id uuid, workspace_id uuid, member_id uuid, user_id uuid, read_only boolean, sections text[], can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.workspace_id, t.member_id,
    (SELECT m.user_id FROM members m WHERE m.id = t.member_id AND m.workspace_id = t.workspace_id),
    t.read_only, t.sections, t.can_post
  FROM api_tokens AS t
  WHERE t.token_hash = p_hash
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now());
  UPDATE api_tokens AS t
  SET last_used_at = now()
  WHERE t.token_hash = p_hash
    AND t.revoked_at IS NULL
    AND (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute');
END $$;
