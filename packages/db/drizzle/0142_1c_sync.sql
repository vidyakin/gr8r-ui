-- Task 1229: per-node EnterpriseData sequencing, outbound changes and exchange journal.
CREATE TABLE "integrations_1c_channels" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "endpoint_url" text NOT NULL,
  "node_name" text NOT NULL,
  "local_node_name" text NOT NULL DEFAULT 'ERP',
  "auth_type" text NOT NULL,
  "username" text,
  "secret_ciphertext" text NOT NULL,
  "conflict_policy" text NOT NULL DEFAULT '1c_wins',
  "version" text NOT NULL DEFAULT '1.17',
  "interval_minutes" integer NOT NULL DEFAULT 60,
  "enabled" boolean NOT NULL DEFAULT false,
  "register_from" timestamptz NOT NULL DEFAULT now(),
  "last_sent_message_no" integer NOT NULL DEFAULT 0,
  "last_received_message_no" integer NOT NULL DEFAULT 0,
  "acked_sent_message_no" integer NOT NULL DEFAULT 0,
  "sent_received_no" integer NOT NULL DEFAULT 0,
  "last_data_received_no" integer NOT NULL DEFAULT 0,
  "pending_blocked" boolean NOT NULL DEFAULT false,
  "pending_xml" text,
  "pending_object_count" integer NOT NULL DEFAULT 0,
  "last_sync_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ic_channels_ws_id_uq" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "ic_channels_ws_source_uq" UNIQUE ("workspace_id", "source"),
  CONSTRAINT "ic_channels_source_chk" CHECK ("source" IN ('buh3', 'ut', 'unf')),
  CONSTRAINT "ic_channels_auth_chk" CHECK (("auth_type" = 'basic' AND "username" IS NOT NULL) OR ("auth_type" = 'bearer' AND "username" IS NULL)),
  CONSTRAINT "ic_channels_policy_chk" CHECK ("conflict_policy" IN ('1c_wins', 'erp_wins', 'manual')),
  CONSTRAINT "ic_channels_interval_chk" CHECK ("interval_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "ic_channels_version_chk" CHECK ("version" IN ('1.15', '1.17')),
  CONSTRAINT "ic_channels_counters_chk" CHECK ("acked_sent_message_no" BETWEEN 0 AND "last_sent_message_no" AND "sent_received_no" BETWEEN 0 AND "last_received_message_no" AND "last_data_received_no" BETWEEN 0 AND "last_received_message_no")
);
--> statement-breakpoint
CREATE INDEX "ic_channels_enabled_idx" ON "integrations_1c_channels" ("last_sync_at") WHERE "enabled";
--> statement-breakpoint
SELECT app_secure_tenant_table('public.integrations_1c_channels'::regclass);
--> statement-breakpoint
CREATE TABLE "integrations_1c_change_queue" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "channel_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "document_type" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "sent_message_no" integer,
  "acked_at" timestamptz,
  "discarded_at" timestamptz,
  CONSTRAINT "ic_queue_channel_fk" FOREIGN KEY ("workspace_id", "channel_id")
    REFERENCES "integrations_1c_channels" ("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "ic_queue_event_uq" UNIQUE ("workspace_id", "channel_id", "event_id"),
  CONSTRAINT "ic_queue_action_chk" CHECK ("action" IN ('upsert', 'remove')),
  CONSTRAINT "ic_queue_type_chk" CHECK ("entity_type" IN ('organization', 'company', 'product', 'warehouse', 'document'))
);
--> statement-breakpoint
CREATE INDEX "ic_queue_pending_idx" ON "integrations_1c_change_queue" ("workspace_id", "channel_id", "sent_message_no", "updated_at")
  WHERE "acked_at" IS NULL AND "discarded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "ic_queue_entity_idx" ON "integrations_1c_change_queue" ("workspace_id", "channel_id", "entity_type", "entity_id")
  WHERE "acked_at" IS NULL AND "discarded_at" IS NULL;
--> statement-breakpoint
SELECT app_secure_tenant_table('public.integrations_1c_change_queue'::regclass);
--> statement-breakpoint
CREATE TABLE "integrations_1c_runs" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "channel_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "status" text NOT NULL,
  "sent_message_no" integer,
  "received_message_no" integer,
  "objects_sent" integer NOT NULL DEFAULT 0,
  "objects_received" integer NOT NULL DEFAULT 0,
  "conflicts_count" integer NOT NULL DEFAULT 0,
  "errors_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  CONSTRAINT "ic_runs_channel_fk" FOREIGN KEY ("workspace_id", "channel_id")
    REFERENCES "integrations_1c_channels" ("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "ic_runs_direction_chk" CHECK ("direction" IN ('push', 'pull', 'both')),
  CONSTRAINT "ic_runs_status_chk" CHECK ("status" IN ('ok', 'partial', 'error'))
);
--> statement-breakpoint
CREATE INDEX "ic_runs_channel_idx" ON "integrations_1c_runs" ("workspace_id", "channel_id", "started_at");
--> statement-breakpoint
SELECT app_secure_tenant_table('public.integrations_1c_runs'::regclass);
