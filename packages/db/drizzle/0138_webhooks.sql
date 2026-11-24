-- Исходящие подписки и журнал доставок. Связи не могут пересекать границы арендаторов.
CREATE UNIQUE INDEX "events_ws_id_uq" ON "events" ("workspace_id", "id");--> statement-breakpoint
CREATE TABLE "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" text[] NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "webhooks_ws_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "webhooks_url_chk" CHECK (char_length("url") BETWEEN 1 AND 2048),
  CONSTRAINT "webhooks_secret_chk" CHECK (char_length("secret") BETWEEN 1 AND 512),
  CONSTRAINT "webhooks_events_chk" CHECK (cardinality("events") > 0)
);--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "webhook_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "response_status" integer,
  "last_error" text,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz,
  CONSTRAINT "webhook_deliveries_ws_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "webhook_deliveries_event_uq" UNIQUE ("workspace_id", "webhook_id", "event_id"),
  CONSTRAINT "webhook_deliveries_webhook_fk" FOREIGN KEY ("workspace_id", "webhook_id") REFERENCES "webhooks"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "webhook_deliveries_event_fk" FOREIGN KEY ("workspace_id", "event_id") REFERENCES "events"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "webhook_deliveries_status_chk" CHECK ("status" IN ('queued', 'delivered', 'failed')),
  CONSTRAINT "webhook_deliveries_attempts_chk" CHECK ("attempts" >= 0)
);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_queue_idx" ON "webhook_deliveries" ("next_attempt_at", "id") WHERE "status" = 'queued';--> statement-breakpoint
SELECT app_secure_tenant_table('public.webhooks'::regclass);--> statement-breakpoint
SELECT app_secure_tenant_table('public.webhook_deliveries'::regclass);
