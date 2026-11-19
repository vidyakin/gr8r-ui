-- Поле-ловушка для ботов у форм сайта: если в заявке оно заполнено, вебхук отвечает успехом, но запись не создаёт. Пусто — проверка выключена
ALTER TABLE "lead_forms" ADD COLUMN "honeypot_field" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_forms" ADD COLUMN "honeypot_field" text DEFAULT '' NOT NULL;
