-- Журнал документов (GET /documents, сортировка по умолчанию «новые сверху»): страница из индекса, без полной сортировки.
-- Порядок колонок и направления — как в ORDER BY маршрута: date desc, created_at desc, id desc.
CREATE INDEX IF NOT EXISTS "documents_ws_journal_idx" ON "documents" USING btree ("workspace_id", "date" DESC, "created_at" DESC, "id" DESC);
