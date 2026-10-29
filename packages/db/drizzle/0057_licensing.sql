CREATE TABLE "license_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"all_modules" boolean DEFAULT false NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_days" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_licenses" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_expires_at" timestamp with time zone,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_module_grants" (
	"workspace_id" uuid NOT NULL,
	"module" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_module_grants_pk" PRIMARY KEY("workspace_id","module")
);
--> statement-breakpoint
ALTER TABLE "workspace_licenses" ADD CONSTRAINT "workspace_licenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_licenses" ADD CONSTRAINT "workspace_licenses_plan_id_license_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."license_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_licenses" ADD CONSTRAINT "workspace_licenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_module_grants" ADD CONSTRAINT "workspace_module_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_module_grants" ADD CONSTRAINT "workspace_module_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "license_plans_key_uq" ON "license_plans" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "license_plans_default_uq" ON "license_plans" USING btree ("is_default") WHERE "license_plans"."is_default";--> statement-breakpoint
CREATE INDEX "workspace_module_grants_expires_idx" ON "workspace_module_grants" USING btree ("expires_at");--> statement-breakpoint
-- Платформенные таблицы тарифов (задача 1205). Владелец app_owner; app_worker (воркер, функции оператора) читает и пишет.
-- Приложению (app_user) доступно только чтение своей строки workspace_licenses / workspace_module_grants по RLS;
-- справочник тарифов app_user не виден вообще. Запись оператора — только SECURITY DEFINER-функции ниже.
ALTER TABLE license_plans OWNER TO app_owner;--> statement-breakpoint
ALTER TABLE workspace_licenses OWNER TO app_owner;--> statement-breakpoint
ALTER TABLE workspace_module_grants OWNER TO app_owner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON license_plans, workspace_licenses, workspace_module_grants TO app_worker;--> statement-breakpoint
ALTER TABLE workspace_licenses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_licenses FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_module_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workspace_module_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY license_select ON workspace_licenses FOR SELECT TO app_user USING (workspace_id = app_workspace_id());--> statement-breakpoint
CREATE POLICY license_select ON workspace_module_grants FOR SELECT TO app_user USING (workspace_id = app_workspace_id());--> statement-breakpoint
GRANT SELECT ON workspace_licenses, workspace_module_grants TO app_user;--> statement-breakpoint

-- Тарифы по умолчанию: «Полный» (все модули, в том числе будущие) и «Базовый» (ядро + CRM + торговля)
INSERT INTO license_plans (key, name, description, all_modules, modules, is_default, sort_order) VALUES
  ('full', 'Полный', 'Все модули платформы', true, '{}', true, 0),
  ('basic', 'Базовый', 'Задачи, проекты, справочники, CRM и торговля', false, ARRAY['crm','trade'], false, 10);--> statement-breakpoint
-- Существующие арендаторы остаются на «Полном» без срока, чтобы ничего не сломать
INSERT INTO workspace_licenses (workspace_id, plan_id)
  SELECT w.id, (SELECT id FROM license_plans WHERE key = 'full') FROM workspaces w;--> statement-breakpoint

-- Проверка оператора для функций записи
CREATE OR REPLACE FUNCTION app_require_operator() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = app_user_id() AND u.is_operator) THEN
    RAISE EXCEPTION 'operator access required' USING ERRCODE = '42501';
  END IF;
END $$;--> statement-breakpoint
ALTER FUNCTION app_require_operator() OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_require_operator() FROM PUBLIC;--> statement-breakpoint

-- Лицензия арендатора в сыром виде (LicenseRaw в @gr8r/shared). Без назначения действует тариф по умолчанию; нет и его — только ядро
CREATE OR REPLACE FUNCTION app_license_of(ws uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'planId', p.id, 'planKey', p.key, 'planName', p.name, 'planModules', to_jsonb(p.modules), 'planAllModules', p.all_modules,
    'planExpiresAt', l.plan_expires_at,
    'limits', p.limits || coalesce(l.limits, '{}'::jsonb),
    'grants', coalesce((SELECT jsonb_agg(jsonb_build_object('module', g.module, 'expiresAt', g.expires_at) ORDER BY g.module) FROM workspace_module_grants g WHERE g.workspace_id = ws), '[]'::jsonb))
  FROM (SELECT ws AS id) w
  LEFT JOIN workspace_licenses l ON l.workspace_id = w.id
  JOIN license_plans p ON p.id = coalesce(l.plan_id, (SELECT id FROM license_plans WHERE is_default))
$$;--> statement-breakpoint
ALTER FUNCTION app_license_of(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_license_of(uuid) FROM PUBLIC;--> statement-breakpoint

-- Лицензия текущего арендатора (app.workspace_id): единственное, что арендатор читает о тарифах
CREATE OR REPLACE FUNCTION app_workspace_license() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_license_of(app_workspace_id())
$$;--> statement-breakpoint
ALTER FUNCTION app_workspace_license() OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_workspace_license() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_workspace_license() TO app_user;--> statement-breakpoint

-- Событие «лицензия арендатора изменилась»: интерфейс по нему перечитывает набор модулей (realtime)
CREATE OR REPLACE FUNCTION app_license_changed(ws uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record;
BEGIN
  INSERT INTO events (workspace_id, type, entity, record_id, payload) VALUES (ws, 'license.changed', 'license', ws, '{}'::jsonb) RETURNING id, created_at INTO e;
  PERFORM pg_notify('gr8r_events', jsonb_build_object('id', e.id, 'workspaceId', ws, 'type', 'license.changed', 'entity', 'license', 'recordId', ws, 'actorId', NULL, 'createdAt', e.created_at)::text);
END $$;--> statement-breakpoint
ALTER FUNCTION app_license_changed(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_license_changed(uuid) FROM PUBLIC;--> statement-breakpoint

-- Оператор: список тарифов с числом арендаторов
CREATE OR REPLACE FUNCTION app_operator_plans() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('tenants', (SELECT count(*)::int FROM workspace_licenses l WHERE l.plan_id = p.id)) ORDER BY p.sort_order, p.name)
    FROM license_plans p WHERE p.archived_at IS NULL), '[]'::jsonb);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_plans() OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_plans() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_plans() TO app_user;--> statement-breakpoint

-- Оператор: создать (p_id is null) или изменить тариф. p — jsonb с полями key, name, description, modules, allModules, limits, trialDays, isDefault, sortOrder
CREATE OR REPLACE FUNCTION app_operator_save_plan(p_id uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rid uuid;
  mods text[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'modules')), '{}');
  makedefault boolean := coalesce((p->>'isDefault')::boolean, false);
BEGIN
  PERFORM app_require_operator();
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
  END IF;
  -- у тарифа сменился набор модулей: интерфейс его арендаторов должен обновиться
  PERFORM app_license_changed(l.workspace_id) FROM workspace_licenses l WHERE l.plan_id = rid;
  RETURN (SELECT to_jsonb(p2) FROM license_plans p2 WHERE p2.id = rid);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_save_plan(uuid, jsonb) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_save_plan(uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_save_plan(uuid, jsonb) TO app_user;--> statement-breakpoint

-- Оператор: удалить тариф (нельзя — по умолчанию или назначен арендаторам)
CREATE OR REPLACE FUNCTION app_operator_delete_plan(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  IF EXISTS (SELECT 1 FROM license_plans WHERE id = p_id AND is_default) THEN RAISE EXCEPTION 'default plan cannot be deleted' USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM workspace_licenses WHERE plan_id = p_id) THEN RAISE EXCEPTION 'plan is assigned to tenants' USING ERRCODE = '23503'; END IF;
  DELETE FROM license_plans WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_delete_plan(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_delete_plan(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_delete_plan(uuid) TO app_user;--> statement-breakpoint

-- Оператор: лицензия арендатора как она есть (для экрана оператора)
CREATE OR REPLACE FUNCTION app_operator_license(ws uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  RETURN app_license_of(ws) || jsonb_build_object('assigned', EXISTS (SELECT 1 FROM workspace_licenses WHERE workspace_id = ws));
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_license(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_license(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_license(uuid) TO app_user;--> statement-breakpoint

-- Оператор: назначить арендатору тариф, срок, лимиты и полный набор доп. модулей (p_grants — массив {module, expiresAt})
CREATE OR REPLACE FUNCTION app_operator_set_license(ws uuid, p_plan uuid, p_expires timestamptz, p_limits jsonb, p_grants jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g jsonb;
BEGIN
  PERFORM app_require_operator();
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = ws) THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM license_plans WHERE id = p_plan) THEN RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO workspace_licenses (workspace_id, plan_id, plan_expires_at, limits, updated_by)
  VALUES (ws, p_plan, p_expires, coalesce(p_limits, '{}'::jsonb), app_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET plan_id = excluded.plan_id, plan_expires_at = excluded.plan_expires_at, limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now();
  DELETE FROM workspace_module_grants WHERE workspace_id = ws AND module NOT IN (SELECT x->>'module' FROM jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) x);
  FOR g IN SELECT * FROM jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) LOOP
    INSERT INTO workspace_module_grants (workspace_id, module, expires_at, created_by)
    VALUES (ws, g->>'module', (g->>'expiresAt')::timestamptz, app_user_id())
    ON CONFLICT (workspace_id, module) DO UPDATE SET expires_at = excluded.expires_at;
  END LOOP;
  PERFORM app_license_changed(ws);
  RETURN app_license_of(ws);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_set_license(uuid, uuid, timestamptz, jsonb, jsonb) TO app_user;
