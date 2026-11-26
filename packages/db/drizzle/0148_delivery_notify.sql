ALTER TABLE "deliveries"
  ADD COLUMN "contact_email" text NOT NULL DEFAULT '',
  ADD COLUMN "tracking_token" text,
  ADD COLUMN "tracking_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "tracking_enabled_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_tracking_token_uq" ON "deliveries" ("tracking_token") WHERE "tracking_token" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "delivery_notifications" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE CASCADE,
  "delivery_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "event_kind" text NOT NULL,
  "recipient" text NOT NULL DEFAULT '',
  "subject" text NOT NULL DEFAULT '',
  "message" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'queued',
  "provider" text NOT NULL DEFAULT '',
  "external_id" text,
  "error" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "delivery_notifications_ws_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "delivery_notifications_delivery_fk" FOREIGN KEY ("workspace_id", "delivery_id") REFERENCES "deliveries" ("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "delivery_notifications_channel_chk" CHECK ("channel" IN ('email', 'sms', 'telegram', 'whatsapp')),
  CONSTRAINT "delivery_notifications_event_chk" CHECK ("event_kind" IN ('tracking_enabled', 'window_updated', 'status_assigned', 'status_in_transit', 'status_delivered', 'status_failed')),
  CONSTRAINT "delivery_notifications_status_chk" CHECK ("status" IN ('queued', 'sent', 'logged', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX "delivery_notifications_delivery_idx" ON "delivery_notifications" ("workspace_id", "delivery_id", "created_at");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.delivery_notifications'::regclass);
