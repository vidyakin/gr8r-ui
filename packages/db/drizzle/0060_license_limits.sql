-- Лимиты тарифа (задача 1207): использование арендатора и раздельные лимиты тарифа / персональные
-- Использование: пользователи (участники без отключённых + неотвязанные приглашения), организации и склады (не в архиве), объём файлов в байтах
-- (метаданные files.size_bytes + PDF документов + архивы выгрузки). Считается мимо RLS арендатора.
CREATE FUNCTION app_usage_of(ws uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'members',
      (SELECT count(*) FROM memberships ms WHERE ms.workspace_id = ws
         AND NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = ws AND m.user_id = ms.user_id AND m.status = 'deactivated'))
      + (SELECT count(*) FROM invites i WHERE i.workspace_id = ws AND i.accepted_at IS NULL AND i.expires_at > now()),
    'organizations', (SELECT count(*) FROM organizations o WHERE o.workspace_id = ws AND o.archived_at IS NULL),
    'warehouses', (SELECT count(*) FROM warehouses w WHERE w.workspace_id = ws AND w.archived_at IS NULL),
    'storageBytes',
      (SELECT coalesce(sum(f.size_bytes), 0) FROM files f WHERE f.workspace_id = ws AND f.archived_at IS NULL)
      + (SELECT coalesce(sum(d.size), 0) FROM document_files d WHERE d.workspace_id = ws)
      + (SELECT coalesce(sum(e.size), 0) FROM document_exports e WHERE e.workspace_id = ws))
$$;--> statement-breakpoint
ALTER FUNCTION app_usage_of(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_usage_of(uuid) FROM PUBLIC;--> statement-breakpoint

-- То же для текущего арендатора (app.workspace_id): проверка лимитов при создании записей
CREATE FUNCTION app_workspace_usage() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_usage_of(app_workspace_id())
$$;--> statement-breakpoint
ALTER FUNCTION app_workspace_usage() OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_workspace_usage() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_workspace_usage() TO app_user;--> statement-breakpoint

-- Лицензия: limits — итоговые (тариф, поверх него персональные), planLimits и ownLimits — по отдельности (экран оператора)
CREATE OR REPLACE FUNCTION app_license_of(ws uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'planId', p.id, 'planKey', p.key, 'planName', p.name, 'planModules', to_jsonb(p.modules), 'planAllModules', p.all_modules,
    'planExpiresAt', l.plan_expires_at, 'isTrial', coalesce(l.is_trial, false),
    'limits', p.limits || coalesce(l.limits, '{}'::jsonb), 'planLimits', p.limits, 'ownLimits', coalesce(l.limits, '{}'::jsonb),
    'grants', coalesce((SELECT jsonb_agg(jsonb_build_object('module', g.module, 'expiresAt', g.expires_at) ORDER BY g.module) FROM workspace_module_grants g WHERE g.workspace_id = ws), '[]'::jsonb))
  FROM (SELECT ws AS id) w
  LEFT JOIN workspace_licenses l ON l.workspace_id = w.id
  JOIN license_plans p ON p.id = coalesce(l.plan_id, (SELECT id FROM license_plans WHERE is_default))
$$;--> statement-breakpoint

-- Оператор: лицензия арендатора вместе с использованием лимитов
CREATE OR REPLACE FUNCTION app_operator_license(ws uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  RETURN app_license_of(ws) || jsonb_build_object('assigned', EXISTS (SELECT 1 FROM workspace_licenses WHERE workspace_id = ws), 'usage', app_usage_of(ws));
END $$;
