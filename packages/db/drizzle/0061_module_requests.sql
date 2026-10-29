CREATE TABLE "module_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment" text,
	"contact" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"note" text,
	"handled_at" timestamp with time zone,
	"handled_by_email" text,
	"hook_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module_requests" ADD CONSTRAINT "module_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_requests" ADD CONSTRAINT "module_requests_member_fk" FOREIGN KEY ("workspace_id","requested_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "module_requests_ws_idx" ON "module_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "module_requests_status_idx" ON "module_requests" USING btree ("status","created_at");--> statement-breakpoint
-- Заявки на модули (задача 1208): арендаторская таблица (RLS по workspace_id), арендатор создаёт и читает свои заявки, но не меняет и не удаляет
SELECT app_secure_tenant_table('public.module_requests'::regclass);--> statement-breakpoint
REVOKE UPDATE, DELETE ON module_requests FROM app_user;--> statement-breakpoint

-- Оператор: заявки всех арендаторов, новые первыми; p_status — фильтр (null — все)
CREATE OR REPLACE FUNCTION app_operator_requests(p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_require_operator();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'workspaceId', r.workspace_id, 'workspaceName', w.name, 'workspaceSlug', w.slug,
      'requestedBy', m.name, 'requestedByEmail', m.email,
      'modules', to_jsonb(r.modules), 'comment', r.comment, 'contact', r.contact, 'status', r.status, 'note', r.note,
      'handledAt', r.handled_at, 'handledByEmail', r.handled_by_email, 'hookSentAt', r.hook_sent_at, 'createdAt', r.created_at) ORDER BY r.created_at DESC, r.id DESC)
    FROM module_requests r JOIN workspaces w ON w.id = r.workspace_id LEFT JOIN members m ON m.workspace_id = r.workspace_id AND m.id = r.requested_by
    WHERE p_status IS NULL OR r.status = p_status), '[]'::jsonb);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_requests(text) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_requests(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_requests(text) TO app_user;--> statement-breakpoint

-- Оператор: статус обработки заявки и заметка
CREATE OR REPLACE FUNCTION app_operator_set_request(p_id uuid, p_status text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r module_requests;
BEGIN
  PERFORM app_require_operator();
  IF p_status NOT IN ('new', 'in_progress', 'done', 'rejected') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  UPDATE module_requests SET status = p_status, note = p_note, handled_at = now(), handled_by_email = (SELECT u.email FROM users u WHERE u.id = app_user_id())
  WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(r);
END $$;--> statement-breakpoint
ALTER FUNCTION app_operator_set_request(uuid, text, text) OWNER TO app_worker;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_operator_set_request(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_operator_set_request(uuid, text, text) TO app_user;
