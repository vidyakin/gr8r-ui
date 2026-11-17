-- Сброс кэша доступа API (apps/api/src/access-cache.ts): любое изменение членства, статуса участника, лицензии или должностей
-- шлёт NOTIFY erp_access_changed с id воркспейса ('*' — общий тариф, затронуты все). Триггер, а не код сервисов: правки идут
-- и из API, и из воркера, CLI арендаторов и сброса демо. NOTIFY уходит после коммита, одинаковые сообщения транзакции сливаются.
CREATE OR REPLACE FUNCTION app_notify_access_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- метка транзакции: tenant() в API сбрасывает свой кэш сразу после коммита, не дожидаясь уведомления
  PERFORM set_config('app.access_changed', 'on', true);
  IF TG_TABLE_NAME = 'license_plans' THEN
    PERFORM pg_notify('erp_access_changed', '*');
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM pg_notify('erp_access_changed', OLD.workspace_id::text); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM pg_notify('erp_access_changed', NEW.workspace_id::text); END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER memberships_access_changed AFTER INSERT OR UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER members_access_changed AFTER INSERT OR DELETE OR UPDATE OF status, user_id, workspace_id ON members FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER workspace_licenses_access_changed AFTER INSERT OR UPDATE OR DELETE ON workspace_licenses FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER workspace_module_grants_access_changed AFTER INSERT OR UPDATE OR DELETE ON workspace_module_grants FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER license_plans_access_changed AFTER INSERT OR UPDATE OR DELETE ON license_plans FOR EACH STATEMENT EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER positions_access_changed AFTER INSERT OR UPDATE OR DELETE ON positions FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();--> statement-breakpoint
CREATE TRIGGER member_positions_access_changed AFTER INSERT OR UPDATE OR DELETE ON member_positions FOR EACH ROW EXECUTE FUNCTION app_notify_access_changed();
