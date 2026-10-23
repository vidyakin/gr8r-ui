ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_chk" CHECK ("users"."locale" in ('en','ru'));