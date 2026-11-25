ALTER TABLE users
  ADD COLUMN totp_secret_ciphertext text,
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_verified_at timestamptz,
  ADD COLUMN totp_last_step integer,
  ADD COLUMN recovery_codes_hashes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN totp_challenge_hash text,
  ADD COLUMN totp_challenge_expires_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX users_totp_challenge_idx ON users (totp_challenge_hash) WHERE totp_challenge_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE sessions
  ADD COLUMN login_method text NOT NULL DEFAULT 'password',
  ADD CONSTRAINT sessions_login_method_chk CHECK (login_method IN ('password', 'totp', 'recovery'));
--> statement-breakpoint
ALTER TABLE workspaces
  ADD COLUMN require_2fa boolean NOT NULL DEFAULT false,
  ADD COLUMN ip_allowlist text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE login_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  email text NOT NULL,
  ip text NOT NULL,
  user_agent text,
  method text NOT NULL,
  via_api_token boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_events_method_chk CHECK (method IN ('password', 'totp', 'recovery')),
  CONSTRAINT login_events_status_chk CHECK (status IN ('ok', 'failed_password', 'failed_totp', 'blocked_ip'))
);
--> statement-breakpoint
CREATE INDEX login_events_ws_created_idx ON login_events (workspace_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT app_secure_tenant_table('public.login_events'::regclass);
--> statement-breakpoint
DROP POLICY tenant_isolation ON login_events;
--> statement-breakpoint
CREATE POLICY login_events_select ON login_events FOR SELECT TO app_user USING (
  workspace_id = app_workspace_id() AND EXISTS (
    SELECT 1 FROM memberships m WHERE m.workspace_id = login_events.workspace_id
      AND m.user_id = app_user_id() AND m.role IN ('owner', 'admin')
  )
);
--> statement-breakpoint
CREATE POLICY login_events_insert ON login_events FOR INSERT TO app_user WITH CHECK (
  user_id IS NOT DISTINCT FROM app_user_id() AND (
    workspace_id IS NULL OR workspace_id = app_workspace_id() OR EXISTS (
      SELECT 1 FROM memberships m WHERE m.workspace_id = login_events.workspace_id AND m.user_id = app_user_id()
    )
  )
);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON login_events FROM app_user;
