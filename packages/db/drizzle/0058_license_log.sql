CREATE TABLE "license_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"context" text,
	"old_value" jsonb,
	"new_value" jsonb
);
--> statement-breakpoint
ALTER TABLE "license_log" ADD CONSTRAINT "license_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_log_ws_idx" ON "license_log" USING btree ("workspace_id","at");--> statement-breakpoint
-- Журнал изменений лицензии (задача 1209). Таблица платформенная: владелец app_owner, пишут и читают только функции оператора (app_worker, BYPASSRLS).
-- app_user формально может читать (так требует тест «SELECT без WHERE по каждой таблице»), но политика USING (false) не отдаёт ему ни одной строки; записи у него нет.
ALTER TABLE license_log OWNER TO app_owner;--> statement-breakpoint
GRANT SELECT, INSERT ON license_log TO app_worker;--> statement-breakpoint
GRANT SELECT ON license_log TO app_user;--> statement-breakpoint
ALTER TABLE license_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE license_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY license_log_none ON license_log FOR SELECT TO app_user USING (false);--> statement-breakpoint

-- Запись в журнал; одинаковые значения (нет изменения) не пишутся
CREATE OR REPLACE FUNCTION app_license_log(ws uuid, p_kind text, p_subject text, p_old jsonb, p_new jsonb, p_context text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_old IS NOT DISTINCT FROM p_new THEN RETURN; END IF;
  INSERT INTO license_log (workspace_id, actor_id, actor_email, kind, subject, context, old_value, new_value)
  VALUES (ws, app_user_id(), (SELECT u.email FROM users u WHERE u.id = app_user_id()), p_kind, p_subject, p_context, p_old, p_new);
END $$;--> statement-breakpoint
ALTER FUNCTION app_license_log(uuid, text, text, jsonb, jsonb, text) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_license_log(uuid, text, text, jsonb, jsonb, text) FROM PUBLIC;--> statement-breakpoint

-- Назначение лицензии: то же, что в 0057, плюс запись каждого изменения (тариф, срок, лимиты, доп. модули) в журнал
CREATE OR REPLACE FUNCTION app_operator_set_license(ws uuid, p_plan uuid, p_expires timestamptz, p_limits jsonb, p_grants jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g jsonb; ng jsonb; k text;
  o_row workspace_licenses;
  o_plan uuid;
  o_limits jsonb;
  n_limits jsonb := coalesce(p_limits, '{}'::jsonb);
  n_grants jsonb := coalesce(p_grants, '[]'::jsonb);
BEGIN
  PERFORM app_require_operator();
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ws) THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM license_plans WHERE id = p_plan) THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o_row FROM workspace_licenses WHERE workspace_id = ws;
  o_plan := coalesce(o_row.plan_id, (SELECT id FROM license_plans WHERE is_default));
  o_limits := coalesce(o_row.limits, '{}'::jsonb);

  PERFORM app_license_log(ws, 'plan', NULL, to_jsonb((SELECT name FROM license_plans WHERE id = o_plan)), to_jsonb((SELECT name FROM license_plans WHERE id = p_plan)));
  PERFORM app_license_log(ws, 'plan_expires', NULL, to_jsonb(o_row.plan_expires_at), to_jsonb(p_expires));
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

  INSERT INTO workspace_licenses (workspace_id, plan_id, plan_expires_at, limits, updated_by)
  VALUES (ws, p_plan, p_expires, n_limits, app_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at, limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now();
  DELETE FROM workspace_module_grants WHERE workspace_id = ws AND module NOT IN (SELECT x->>'module' FROM jsonb_array_elements(n_grants) x);
  FOR g IN SELECT * FROM jsonb_array_elements(n_grants) LOOP
    INSERT INTO workspace_module_grants (workspace_id, module, expires_at, created_by)
    VALUES (ws, g->>'module', (g->>'expiresAt')::timestamptz, app_user_id())
    ON CONFLICT (workspace_id, module) DO UPDATE SET expires_at = excluded.expires_at;
  END LOOP;
  PERFORM app_license_changed(ws);
  RETURN app_license_of(ws);
END $$;--> statement-breakpoint

-- Изменение тарифа: то же, что в 0057, плюс запись в журнал каждого арендатора на этом тарифе (модули, «все модули», лимиты, пробный период)
CREATE OR REPLACE FUNCTION app_operator_save_plan(p_id uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rid uuid;
  o license_plans;
  n license_plans;
  mods text[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'modules')), '{}');
  makedefault boolean := coalesce((p->>'isDefault')::boolean, false);
BEGIN
  PERFORM app_require_operator();
  IF p_id IS NOT NULL THEN SELECT * INTO o FROM license_plans WHERE id = p_id; END IF;
  IF makedefault THEN UPDATE license_plans SET is_default = false WHERE is_default AND id IS DISTINCT FROM p_id; END IF;
  IF p_id IS NULL THEN
    INSERT INTO license_plans (key, name, description, modules, all_modules, limits, trial_days, is_default, sort_order)
    VALUES (coalesce(p->>'key', 'plan-' || substr(md5(random()::text), 1, 8)), p->>'name', p->>'description', mods, coalesce((p->>'allModules')::boolean, false),
      coalesce(p->'limits', '{}'::jsonb), (p->>'trialDays')::int, makedefault, coalesce((p->>'sortOrder')::int, 0))
    RETURNING id INTO rid;
  ELSE
    UPDATE license_plans SET name = p->>'name', description = p->>'description', modules = mods, all_modules = coalesce((p->>'allModules')::boolean, false),
      limits = coalesce(p->'limits', '{}'::jsonb), trial_days = (p->>'trialDays')::int,
      is_default = is_default OR makedefault, sort_order = coalesce((p->>'sortOrder')::int, 0), updated_at = now()
    WHERE id = p_id RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO n FROM license_plans WHERE id = rid;
    PERFORM app_license_log(l.workspace_id, 'plan_edit', f.field, f.ov, f.nv, n.name)
      FROM workspace_licenses l,
      (VALUES ('modules', to_jsonb(ARRAY(SELECT unnest(o.modules) ORDER BY 1)), to_jsonb(ARRAY(SELECT unnest(n.modules) ORDER BY 1))),
              ('all_modules', to_jsonb(o.all_modules), to_jsonb(n.all_modules)),
              ('limits', o.limits, n.limits),
              ('trial_days', to_jsonb(o.trial_days), to_jsonb(n.trial_days))) f(field, ov, nv)
      WHERE l.plan_id = rid;
  END IF;
  -- у тарифа сменился набор модулей: интерфейс его арендаторов должен обновиться
  PERFORM app_license_changed(l.workspace_id) FROM workspace_licenses l WHERE l.plan_id = rid;
  RETURN (SELECT to_jsonb(p2) FROM license_plans p2 WHERE p2.id = rid);
END $$;--> statement-breakpoint

-- Журнал арендатора для экрана оператора, новые записи первыми
CREATE OR REPLACE FUNCTION app_operator_license_log(ws uuid, p_limit int DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'actorEmail', l.actor_email, 'kind', l.kind, 'subject', l.subject, 'context', l.context, 'old', l.old_value, 'new', l.new_value) ORDER BY l.at DESC, l.id DESC)
    FROM (SELECT * FROM license_log WHERE workspace_id = ws ORDER BY at DESC, id DESC LIMIT least(greatest(p_limit, 1), 1000)) l), '[]'::jsonb);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_license_log(uuid, int) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_license_log(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_license_log(uuid, int) TO app_user;
