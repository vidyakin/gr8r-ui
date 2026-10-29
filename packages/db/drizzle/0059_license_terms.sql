ALTER TABLE "workspace_licenses" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Сроки и пробный период (задача 1206)

-- Лицензия арендатора в сыром виде: добавлен признак пробного периода
CREATE OR REPLACE FUNCTION app_license_of(ws uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'planId', p.id, 'planKey', p.key, 'planName', p.name, 'planModules', to_jsonb(p.modules), 'planAllModules', p.all_modules,
    'planExpiresAt', l.plan_expires_at, 'isTrial', coalesce(l.is_trial, false),
    'limits', p.limits || coalesce(l.limits, '{}'::jsonb),
    'grants', coalesce((SELECT jsonb_agg(jsonb_build_object('module', g.module, 'expiresAt', g.expires_at) ORDER BY g.module) FROM workspace_module_grants g WHERE g.workspace_id = ws), '[]'::jsonb))
  FROM (SELECT ws AS id) w
  LEFT JOIN workspace_licenses l ON l.workspace_id = w.id
  JOIN license_plans p ON p.id = coalesce(l.plan_id, (SELECT id FROM license_plans WHERE is_default))
$$;--> statement-breakpoint

-- Назначение лицензии оператором: новый параметр p_trial (пробный период). Сигнатура меняется, поэтому старая функция удаляется
DROP FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb);--> statement-breakpoint
CREATE FUNCTION app_operator_set_license(ws uuid, p_plan uuid, p_expires timestamptz, p_limits jsonb, p_grants jsonb, p_trial boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g jsonb; ng jsonb; k text;
  o_row workspace_licenses;
  o_plan uuid;
  o_limits jsonb;
  n_limits jsonb := coalesce(p_limits, '{}'::jsonb);
  n_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  n_trial boolean := coalesce(p_trial, false);
BEGIN
  PERFORM app_require_operator();
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ws) THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM license_plans WHERE id = p_plan) THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o_row FROM workspace_licenses WHERE workspace_id = ws;
  o_plan := coalesce(o_row.plan_id, (SELECT id FROM license_plans WHERE is_default));
  o_limits := coalesce(o_row.limits, '{}'::jsonb);

  PERFORM app_license_log(ws, 'plan', NULL, to_jsonb((SELECT name FROM license_plans WHERE id = o_plan)), to_jsonb((SELECT name FROM license_plans WHERE id = p_plan)));
  PERFORM app_license_log(ws, 'plan_expires', NULL, to_jsonb(o_row.plan_expires_at), to_jsonb(p_expires));
  PERFORM app_license_log(ws, 'trial', NULL, to_jsonb(coalesce(o_row.is_trial, false)), to_jsonb(n_trial));
  FOR k IN SELECT jsonb_object_keys(o_limits || n_limits) LOOP
    PERFORM app_license_log(ws, 'limit', k, o_limits -> k, n_limits -> k);
  END LOOP;
  FOR g IN SELECT jsonb_build_object('module', m.module, 'expiresAt', m.expires_at) FROM workspace_module_grants m WHERE m.workspace_id = ws LOOP
    SELECT x INTO ng FROM jsonb_array_elements(n_grants) x WHERE x->>'module' = g->>'module' LIMIT 1;
    IF ng IS NULL THEN
      PERFORM app_license_log(ws, 'grant_removed', g->>'module', jsonb_build_object('expiresAt', g->'expiresAt'), NULL);
    ELSE
      PERFORM app_license_log(ws, 'grant_expires', g->>'module', to_jsonb((g->>'expiresAt')::timestamptz), to_jsonb((ng->>'expiresAt')::timestamptz));
    END IF;
  END LOOP;
  FOR g IN SELECT x FROM jsonb_array_elements(n_grants) x LOOP
    IF NOT EXISTS (SELECT 1 FROM workspace_module_grants m WHERE m.workspace_id = ws AND m.module = g->>'module') THEN
      PERFORM app_license_log(ws, 'grant_added', g->>'module', NULL, jsonb_build_object('expiresAt', to_jsonb((g->>'expiresAt')::timestamptz)));
    END IF;
  END LOOP;

  INSERT INTO workspace_licenses (workspace_id, plan_id, plan_expires_at, is_trial, limits, updated_by)
  VALUES (ws, p_plan, p_expires, n_trial, n_limits, app_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at, is_trial = excluded.is_trial, limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now();
  DELETE FROM workspace_module_grants WHERE workspace_id = ws AND module NOT IN (SELECT x->>'module' FROM jsonb_array_elements(n_grants) x);
  FOR g IN SELECT * FROM jsonb_array_elements(n_grants) LOOP
    INSERT INTO workspace_module_grants (workspace_id, module, expires_at, created_by)
    VALUES (ws, g->>'module', (g->>'expiresAt')::timestamptz, app_user_id())
    ON CONFLICT (workspace_id, module) DO UPDATE SET expires_at = excluded.expires_at;
  END LOOP;
  PERFORM app_license_changed(ws);
  RETURN app_license_of(ws);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb, boolean) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb, boolean) TO app_user;--> statement-breakpoint

-- Старт лицензии нового арендатора (createTenant, CLI и API оператора). Без права для app_user: вызывается только под app_worker.
-- Тариф не передан и у тарифа по умолчанию нет пробного периода — ничего не меняется (арендатор живёт на тарифе по умолчанию без строки).
-- Иначе назначается тариф; если у него задан trial_days, ставится срок now() + trial_days и признак пробного периода.
CREATE FUNCTION app_license_start(ws uuid, p_plan uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pid uuid := coalesce(p_plan, (SELECT id FROM license_plans WHERE is_default));
  pl license_plans;
  expires timestamptz;
  default_id uuid := (SELECT id FROM license_plans WHERE is_default);
BEGIN
  IF pid IS NULL THEN RETURN; END IF;
  SELECT * INTO pl FROM license_plans WHERE id = pid;
  IF pl.id IS NULL THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
  IF p_plan IS NULL AND pl.trial_days IS NULL THEN RETURN; END IF;
  IF pl.trial_days IS NOT NULL THEN expires := now() + make_interval(days => pl.trial_days); END IF;
  INSERT INTO workspace_licenses (workspace_id, plan_id, plan_expires_at, is_trial, updated_by)
  VALUES (ws, pid, expires, pl.trial_days IS NOT NULL, app_user_id())
  ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM app_license_log(ws, 'plan', NULL, to_jsonb((SELECT name FROM license_plans WHERE id = default_id)), to_jsonb(pl.name));
  IF expires IS NOT NULL THEN PERFORM app_license_log(ws, 'trial_started', NULL, NULL, jsonb_build_object('expiresAt', to_jsonb(expires))); END IF;
  PERFORM app_license_changed(ws);
END $$;--> statement-breakpoint
ALTER FUNCTION app_license_start(uuid, uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_license_start(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_license_start(uuid, uuid) TO app_worker;
