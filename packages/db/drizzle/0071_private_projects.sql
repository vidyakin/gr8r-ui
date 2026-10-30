-- Закрытые проекты на уровне БД: проект с is_private или access = 'private' видят только участники проекта,
-- руководитель, создатель и owner/admin воркспейса. Остальное (задачи, комментарии, файлы, время…) прячется вслед за проектом.
-- Политики RESTRICTIVE: они сужают tenant_isolation, а не заменяют его. Роль app_worker (BYPASSRLS) их не видит.
ALTER TABLE "projects" ADD COLUMN "created_by" uuid;--> statement-breakpoint

-- Видимость проекта для текущего пользователя (app.user_id) в текущем воркспейсе (app.workspace_id).
-- SECURITY INVOKER: читает members/memberships/project_members под RLS самого пользователя.
CREATE OR REPLACE FUNCTION app_project_visible(p_id uuid, p_private boolean, p_access text, p_lead uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT (p_private OR p_access = 'private')
    OR EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.user_id = app_user_id() AND ms.workspace_id = app_workspace_id() AND ms.role IN ('owner', 'admin'))
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.user_id = app_user_id() AND m.workspace_id = app_workspace_id() AND m.status <> 'deactivated'
        AND (m.id = p_lead OR m.id = p_created_by
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p_id AND pm.member_id = m.id)))
$$;--> statement-breakpoint

CREATE POLICY private_project ON projects AS RESTRICTIVE FOR ALL TO app_user
  USING (app_project_visible(id, is_private, access, lead_id, created_by));--> statement-breakpoint

-- Подзапрос к projects внутри политики сам проходит RLS проектов, поэтому возвращает только доступные проекты.
CREATE POLICY private_project ON tasks AS RESTRICTIVE FOR ALL TO app_user
  USING (project_id IN (SELECT id FROM projects));--> statement-breakpoint
CREATE POLICY private_project ON comments AS RESTRICTIVE FOR ALL TO app_user
  USING (task_id IN (SELECT id FROM tasks));--> statement-breakpoint
CREATE POLICY private_project ON comment_reactions AS RESTRICTIVE FOR ALL TO app_user
  USING (comment_id IN (SELECT id FROM comments));--> statement-breakpoint
CREATE POLICY private_project ON time_logs AS RESTRICTIVE FOR ALL TO app_user
  USING (task_id IN (SELECT id FROM tasks));--> statement-breakpoint
CREATE POLICY private_project ON files AS RESTRICTIVE FOR ALL TO app_user
  USING ((project_id IS NULL OR project_id IN (SELECT id FROM projects)) AND (task_id IS NULL OR task_id IN (SELECT id FROM tasks)));--> statement-breakpoint
CREATE POLICY private_project ON activity AS RESTRICTIVE FOR ALL TO app_user
  USING ((project_id IS NULL OR project_id IN (SELECT id FROM projects)) AND (task_id IS NULL OR task_id IN (SELECT id FROM tasks)));--> statement-breakpoint
CREATE POLICY private_project ON notifications AS RESTRICTIVE FOR ALL TO app_user
  USING ((project_id IS NULL OR project_id IN (SELECT id FROM projects)) AND (task_id IS NULL OR task_id IN (SELECT id FROM tasks)));--> statement-breakpoint
CREATE POLICY private_project ON saved_views AS RESTRICTIVE FOR ALL TO app_user
  USING (project_id IN (SELECT id FROM projects));--> statement-breakpoint
CREATE POLICY private_project ON calendar_events AS RESTRICTIVE FOR ALL TO app_user
  USING (project_id IS NULL OR project_id IN (SELECT id FROM projects));--> statement-breakpoint

-- Журнал событий хранит снимки записей (payload), поэтому события закрытых проектов прячем в GET /events.
-- Функция читает проекты мимо RLS (владелец app_worker с BYPASSRLS), но видимость считает для текущего пользователя.
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
        WHEN 'file' THEN (SELECT coalesce(f.project_id, (SELECT t.project_id FROM tasks t WHERE t.id = f.task_id)) FROM files f WHERE f.id = p_record)
        WHEN 'calendar_event' THEN (SELECT e.project_id FROM calendar_events e WHERE e.id = p_record)
      END)
$$;--> statement-breakpoint
ALTER FUNCTION app_event_hidden(text, uuid) OWNER TO app_worker;
