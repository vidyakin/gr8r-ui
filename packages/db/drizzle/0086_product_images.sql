-- Задача 1192: картинки товаров. Основная картинка товара — вложение (entity_type = product);
-- шаблон КП с картинками строк
ALTER TABLE "products" ADD COLUMN "image_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD COLUMN "with_images" boolean DEFAULT false NOT NULL;
