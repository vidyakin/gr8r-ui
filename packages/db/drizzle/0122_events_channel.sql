-- Канал LISTEN/NOTIFY переименован: gr8r_events → erp_events (EVENTS_CHANNEL в src/events.ts).
-- Функция из 0057 пересоздаётся с новым каналом, тело в остальном прежнее.
CREATE OR REPLACE FUNCTION app_license_changed(ws uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record;
BEGIN
  INSERT INTO events (workspace_id, type, entity, record_id, payload) VALUES (ws, 'license.changed', 'license', ws, '{}'::jsonb) RETURNING id, created_at INTO e;
  PERFORM pg_notify('erp_events', jsonb_build_object('id', e.id, 'workspaceId', ws, 'type', 'license.changed', 'entity', 'license', 'recordId', ws, 'actorId', NULL, 'createdAt', e.created_at)::text);
END $$;--> statement-breakpoint
ALTER FUNCTION app_license_changed(uuid) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_license_changed(uuid) FROM PUBLIC;
