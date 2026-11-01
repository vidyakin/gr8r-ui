-- Задача 1191 (хранилище вложений) дропнула таблицу files, но SECURITY DEFINER-функция
-- app_event_hidden (миграция 0071) всё ещё ссылалась на неё в CASE — ветка 'file'.
-- Имена резолвятся при вызове, поэтому GET /events падал с «relation "files" does not exist».
-- Вложения (attachments) к проектам не привязаны, прятать их не нужно: убираем битую ветку.
--
-- Заодно NULL-логика app_project_visible (миграция 0072): без заданной app.system
-- current_setting(..., true) = 'on' давал NULL — функция возвращала NULL вместо false,
-- и NOT NULL внутри app_event_hidden ломал EXISTS: события закрытых проектов утекали в /events.

CREATE OR REPLACE FUNCTION app_project_visible(p_id uuid, p_private boolean, p_access text, p_lead uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT (p_private OR p_access = 'private')
    OR coalesce(current_setting('app.system', true), '') = 'on'
    OR EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.user_id = app_user_id() AND ms.workspace_id = app_workspace_id() AND ms.role IN ('owner', 'admin'))
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.user_id = app_user_id() AND m.workspace_id = app_workspace_id() AND m.status <> 'deactivated'
        AND (m.id = p_lead OR m.id = p_created_by
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p_id AND pm.member_id = m.id)))
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_event_hidden(p_entity text, p_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.workspace_id = app_workspace_id()
      AND NOT app_project_visible(p.id, p.is_private, p.access, p.lead_id, p.created_by)
      AND p.id = CASE p_entity
        WHEN 'project' THEN p_record
        WHEN 'task' THEN (SELECT t.project_id FROM tasks t WHERE t.id = p_record)
        WHEN 'comment' THEN (SELECT t.project_id FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = p_record)
        WHEN 'time_log' THEN (SELECT t.project_id FROM time_logs l JOIN tasks t ON t.id = l.task_id WHERE l.id = p_record)
        WHEN 'calendar_event' THEN (SELECT e.project_id FROM calendar_events e WHERE e.id = p_record)
      END)
$$;--> statement-breakpoint
ALTER FUNCTION app_event_hidden(text, uuid) OWNER TO app_worker;
