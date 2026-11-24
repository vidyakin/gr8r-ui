-- Область видимости записей CRM (record_scope: all | department | own) и скрытые поля (hidden_fields) на должностях.
-- Политики RESTRICTIVE сужают tenant_isolation (AND); системный контекст (app.system = 'on') и app_worker (BYPASSRLS) видят всё.
ALTER TABLE "positions" ADD COLUMN "record_scope" text NOT NULL DEFAULT 'all';--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "hidden_fields" text[] NOT NULL DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_record_scope_chk" CHECK ("record_scope" IN ('all', 'department', 'own'));--> statement-breakpoint

-- Возвращает NULL, если текущий пользователь видит все записи воркспейса (system, owner/admin, без должностей или record_scope = 'all'),
-- иначе — массив members.id, чьи записи доступны (сам участник для 'own', сам + участники его подразделений и дочерних для 'department').
CREATE OR REPLACE FUNCTION app_visible_owner_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_ws_id uuid;
  v_role text;
  v_member_id uuid;
  v_scope text;
  v_ids uuid[];
BEGIN
  IF current_setting('app.system', true) IN ('on', 'true') THEN
    RETURN NULL;
  END IF;

  v_user_id := app_user_id();
  v_ws_id := app_workspace_id();
  IF v_user_id IS NULL OR v_ws_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ms.role INTO v_role
  FROM memberships ms
  WHERE ms.user_id = v_user_id AND ms.workspace_id = v_ws_id
  LIMIT 1;

  IF v_role IN ('owner', 'admin') THEN
    RETURN NULL;
  END IF;

  SELECT m.id INTO v_member_id
  FROM members m
  WHERE m.user_id = v_user_id AND m.workspace_id = v_ws_id AND m.status <> 'deactivated'
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT CASE
    WHEN count(*) = 0 THEN 'all'
    WHEN bool_or(p.record_scope = 'all') THEN 'all'
    WHEN bool_or(p.record_scope = 'department') THEN 'department'
    ELSE 'own'
  END INTO v_scope
  FROM member_positions mp
  JOIN positions p ON p.workspace_id = mp.workspace_id AND p.id = mp.position_id
  WHERE mp.workspace_id = v_ws_id AND mp.member_id = v_member_id;

  IF v_scope = 'all' THEN
    RETURN NULL;
  END IF;

  IF v_scope = 'own' THEN
    RETURN ARRAY[v_member_id];
  END IF;

  -- department: сам участник + все активные сотрудники подразделений, где он руководитель или участник, и всех дочерних подразделений
  WITH RECURSIVE my_depts AS (
    SELECT d.id
    FROM departments d
    WHERE d.workspace_id = v_ws_id AND d.archived_at IS NULL AND d.head_member_id = v_member_id
    UNION
    SELECT dm.department_id AS id
    FROM department_members dm
    JOIN departments d ON d.workspace_id = dm.workspace_id AND d.id = dm.department_id AND d.archived_at IS NULL
    WHERE dm.workspace_id = v_ws_id AND dm.member_id = v_member_id
  ),
  dept_tree AS (
    SELECT id FROM my_depts
    UNION
    SELECT d.id
    FROM departments d
    JOIN dept_tree dt ON d.parent_id = dt.id
    WHERE d.workspace_id = v_ws_id AND d.archived_at IS NULL
  )
  SELECT array_agg(DISTINCT mid) INTO v_ids
  FROM (
    SELECT v_member_id AS mid
    UNION
    SELECT dm.member_id AS mid
    FROM department_members dm
    JOIN members m ON m.workspace_id = dm.workspace_id AND m.id = dm.member_id AND m.status <> 'deactivated'
    WHERE dm.workspace_id = v_ws_id AND dm.department_id IN (SELECT id FROM dept_tree)
    UNION
    SELECT d.head_member_id AS mid
    FROM departments d
    JOIN members m ON m.workspace_id = d.workspace_id AND m.id = d.head_member_id AND m.status <> 'deactivated'
    WHERE d.workspace_id = v_ws_id AND d.id IN (SELECT id FROM dept_tree) AND d.head_member_id IS NOT NULL
  ) s;

  RETURN coalesce(v_ids, ARRAY[v_member_id]);
END;
$$;--> statement-breakpoint
ALTER FUNCTION app_visible_owner_ids() OWNER TO app_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_visible_owner_ids() TO app_user, app_worker;--> statement-breakpoint

-- Индексы по ответственному для фильтрации RLS
CREATE INDEX IF NOT EXISTS "companies_ws_owner_idx" ON "companies" ("workspace_id", "owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_ws_owner_idx" ON "contacts" ("workspace_id", "owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_ws_owner_idx" ON "deals" ("workspace_id", "owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_ws_owner_idx" ON "leads" ("workspace_id", "owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_ws_owner_idx" ON "cases" ("workspace_id", "owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_ws_responsible_idx" ON "documents" ("workspace_id", "responsible_id") WHERE "responsible_id" IS NOT NULL;--> statement-breakpoint

-- Основные сущности CRM: записи без ответственного (owner_id IS NULL) видны всем (общий пул)
CREATE POLICY record_access ON companies AS RESTRICTIVE FOR ALL TO app_user
  USING (owner_id IS NULL OR app_visible_owner_ids() IS NULL OR owner_id = ANY(app_visible_owner_ids()));--> statement-breakpoint
CREATE POLICY record_access ON contacts AS RESTRICTIVE FOR ALL TO app_user
  USING (owner_id IS NULL OR app_visible_owner_ids() IS NULL OR owner_id = ANY(app_visible_owner_ids()));--> statement-breakpoint
CREATE POLICY record_access ON deals AS RESTRICTIVE FOR ALL TO app_user
  USING (owner_id IS NULL OR app_visible_owner_ids() IS NULL OR owner_id = ANY(app_visible_owner_ids()));--> statement-breakpoint
CREATE POLICY record_access ON leads AS RESTRICTIVE FOR ALL TO app_user
  USING (owner_id IS NULL OR app_visible_owner_ids() IS NULL OR owner_id = ANY(app_visible_owner_ids()));--> statement-breakpoint
CREATE POLICY record_access ON cases AS RESTRICTIVE FOR ALL TO app_user
  USING (owner_id IS NULL OR app_visible_owner_ids() IS NULL OR owner_id = ANY(app_visible_owner_ids()));--> statement-breakpoint

-- Связанные таблицы сделок
CREATE POLICY record_access ON deal_stage_history AS RESTRICTIVE FOR ALL TO app_user
  USING (app_visible_owner_ids() IS NULL OR EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_stage_history.deal_id));--> statement-breakpoint
CREATE POLICY record_access ON deal_contacts AS RESTRICTIVE FOR ALL TO app_user
  USING (app_visible_owner_ids() IS NULL OR EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_contacts.deal_id));--> statement-breakpoint

-- Дела CRM и касания: наследуют видимость привязанных сущностей
CREATE POLICY record_access ON crm_activities AS RESTRICTIVE FOR ALL TO app_user
  USING (
    app_visible_owner_ids() IS NULL
    OR (deal_id IS NULL AND company_id IS NULL AND contact_id IS NULL AND lead_id IS NULL AND case_id IS NULL)
    OR (deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM deals d WHERE d.id = crm_activities.deal_id))
    OR (company_id IS NOT NULL AND EXISTS (SELECT 1 FROM companies c WHERE c.id = crm_activities.company_id))
    OR (contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = crm_activities.contact_id))
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = crm_activities.lead_id))
    OR (case_id IS NOT NULL AND EXISTS (SELECT 1 FROM cases cs WHERE cs.id = crm_activities.case_id))
  );--> statement-breakpoint

-- Документы продаж: видны по ответственному документа или по контрагенту (если ответственный не указан)
CREATE POLICY record_access ON documents AS RESTRICTIVE FOR ALL TO app_user
  USING (
    app_visible_owner_ids() IS NULL
    OR type NOT IN ('quote', 'customer_order', 'invoice', 'realization', 'act', 'customer_return')
    OR responsible_id = ANY(app_visible_owner_ids())
    OR (
      responsible_id IS NULL
      AND (counterparty_id IS NULL OR EXISTS (SELECT 1 FROM companies c WHERE c.id = documents.counterparty_id))
    )
  );--> statement-breakpoint

-- Письма: наследуют видимость привязанной сущности CRM или документа
CREATE POLICY record_access ON email_messages AS RESTRICTIVE FOR ALL TO app_user
  USING (
    app_visible_owner_ids() IS NULL
    OR (lead_id IS NULL AND contact_id IS NULL AND company_id IS NULL AND deal_id IS NULL AND case_id IS NULL AND document_id IS NULL)
    OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = email_messages.lead_id))
    OR (contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = email_messages.contact_id))
    OR (company_id IS NOT NULL AND EXISTS (SELECT 1 FROM companies c WHERE c.id = email_messages.company_id))
    OR (deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM deals d WHERE d.id = email_messages.deal_id))
    OR (case_id IS NOT NULL AND EXISTS (SELECT 1 FROM cases cs WHERE cs.id = email_messages.case_id))
    OR (document_id IS NOT NULL AND EXISTS (SELECT 1 FROM documents doc WHERE doc.id = email_messages.document_id))
  );
