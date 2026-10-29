ALTER TABLE "users" ADD COLUMN "is_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "delete_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_kind_chk" CHECK ("workspaces"."kind" in ('regular','demo'));--> statement-breakpoint
-- Удаление арендатора убирает пользователей, у которых не осталось других членств (воркер и CLI)
GRANT DELETE ON "users" TO app_worker;--> statement-breakpoint
-- Список арендаторов для оператора: единственное чтение через всех арендаторов из API. Владелец — app_worker (BYPASSRLS),
-- функция сама проверяет флаг is_operator текущего пользователя и отдаёт только метаданные
CREATE OR REPLACE FUNCTION app_operator_tenants()
RETURNS TABLE (id uuid, name text, slug text, kind text, expires_at timestamptz, delete_requested_at timestamptz, created_at timestamptz, owner_email text, members integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  select w.id, w.name, w.slug, w.kind, w.expires_at, w.delete_requested_at, w.created_at,
    (select u.email from memberships m join users u on u.id = m.user_id where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*)::int from memberships m where m.workspace_id = w.id)
  from workspaces w
  where exists (select 1 from users u where u.id = app_user_id() and u.is_operator)
  order by w.created_at
$$;--> statement-breakpoint
ALTER FUNCTION app_operator_tenants() OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_tenants() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_tenants() TO app_user;
