-- Шаги автоматизаций идут под app_user без пользователя (app.system = on): закрытые проекты им видны,
-- политика tenant_isolation по app.workspace_id продолжает действовать.
CREATE OR REPLACE FUNCTION app_project_visible(p_id uuid, p_private boolean, p_access text, p_lead uuid, p_created_by uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT (p_private OR p_access = 'private')
    OR current_setting('app.system', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.user_id = app_user_id() AND ms.workspace_id = app_workspace_id() AND ms.role IN ('owner', 'admin'))
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.user_id = app_user_id() AND m.workspace_id = app_workspace_id() AND m.status <> 'deactivated'
        AND (m.id = p_lead OR m.id = p_created_by
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p_id AND pm.member_id = m.id)))
$$;
