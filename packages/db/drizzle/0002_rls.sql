-- Роли и изоляция арендаторов (RLS). См. docs/architecture.md, раздел «Арендаторы и доступ».
--
--   app_owner  — владелец таблиц (NOLOGIN). Миграции выполняет суперпользователь/админ БД и передаёт владение этой роли.
--   app_user   — роль, под которой работает API: NOLOGIN, NOBYPASSRLS. Подключение API входит под логином,
--                состоящим в app_user, и в каждой транзакции делает `SET LOCAL ROLE app_user`.
--   app_worker — роль воркера: BYPASSRLS (фоновые задачи и outbox идут через всех арендаторов).
--
-- Политики используют app.workspace_id (арендатор) и app.user_id (пользователь, нужен для списка «мои воркспейсы»).
-- Пустая/неустановленная настройка даёт NULL → сравнение ложно → строк не видно (fail closed).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT app_owner, app_user, app_worker TO CURRENT_USER;
--> statement-breakpoint
-- app_owner нужен USAGE: проверки внешних ключей выполняются с правами владельца таблицы
GRANT USAGE ON SCHEMA public TO app_owner, app_user, app_worker;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_workspace_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.workspace_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Подключает таблицу арендатора: владелец, ENABLE + FORCE RLS, политика по workspace_id, права ролям.
-- Каждая будущая миграция, создающая таблицу с workspace_id, обязана вызвать её (это проверяет тест покрытия RLS).
CREATE OR REPLACE FUNCTION app_secure_tenant_table(tbl regclass, col text DEFAULT 'workspace_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s OWNER TO app_owner', tbl);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL TO app_user ' ||
    'USING (%I = app_workspace_id()) ' ||
    'WITH CHECK (%I = app_workspace_id())', tbl, col, col);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user', tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_worker', tbl);
END $$;
--> statement-breakpoint

-- Все существующие таблицы с workspace_id, кроме memberships (у неё своя политика ниже)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'workspace_id' AND c.table_name <> 'memberships'
  LOOP
    PERFORM app_secure_tenant_table(format('public.%I', r.table_name)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint

-- Журнал событий неизменяем для приложения: только добавление
REVOKE UPDATE, DELETE ON events FROM app_user;
--> statement-breakpoint

-- workspaces: арендатор — сама строка. Список «мои воркспейсы» читается по членству (app.user_id).
ALTER TABLE workspaces OWNER TO app_owner;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_select ON workspaces FOR SELECT TO app_user USING (
  id = app_workspace_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = workspaces.id AND m.user_id = app_user_id())
);
--> statement-breakpoint
CREATE POLICY ws_insert ON workspaces FOR INSERT TO app_user WITH CHECK (id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY ws_update ON workspaces FOR UPDATE TO app_user
  USING (id = app_workspace_id()) WITH CHECK (id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY ws_delete ON workspaces FOR DELETE TO app_user USING (id = app_workspace_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces TO app_user, app_worker;
--> statement-breakpoint

-- memberships: свои членства видны без выбранного воркспейса (определить доступ), изменять — только в рамках арендатора
ALTER TABLE memberships OWNER TO app_owner;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ms_select ON memberships FOR SELECT TO app_user USING (
  workspace_id = app_workspace_id()
  OR user_id = app_user_id()
);
--> statement-breakpoint
CREATE POLICY ms_insert ON memberships FOR INSERT TO app_user WITH CHECK (workspace_id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY ms_update ON memberships FOR UPDATE TO app_user
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY ms_delete ON memberships FOR DELETE TO app_user USING (workspace_id = app_workspace_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO app_user, app_worker;
--> statement-breakpoint

-- Глобальные таблицы без RLS (учётные записи, сессии, счётчики): минимальные права
ALTER TABLE users OWNER TO app_owner;
--> statement-breakpoint
ALTER TABLE sessions OWNER TO app_owner;
--> statement-breakpoint
ALTER TABLE rate_limits OWNER TO app_owner;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users TO app_user, app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON sessions TO app_user, app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO app_user, app_worker;
