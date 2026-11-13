-- Импорт сметы из PDF: подсказка пользователя для ИИ и метаданные документа (страницы, тип pdf).
ALTER TABLE "estimate_imports" ADD COLUMN "hint" text;--> statement-breakpoint
ALTER TABLE "estimate_imports" ADD COLUMN "meta" jsonb;
