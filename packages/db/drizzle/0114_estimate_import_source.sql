-- Импорт сметы из PDF: исходный markdown постранично (как его разобрал pdf-inspector) — для просмотра
-- «документ как его видит разбор» в диалоге импорта, когда ИИ недоступен.
ALTER TABLE "estimate_imports" ADD COLUMN "source" jsonb;
