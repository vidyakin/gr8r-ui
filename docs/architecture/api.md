# Public REST API v1 & Outgoing Webhooks

## Public REST API v1 (`/v1/*`, proxied at `/api/v1/*`)

- **Authentication**: `Authorization: Bearer erp_...` only (cookie sessions are rejected with `401 token_required`). Token lookup reuses `requireSession` → `app_api_token_lookup` (checks revocation and expiry) and `hitTokenRate` (120 requests/minute per token by default).
- **Tenancy & RLS**: `tenant('token')` resolves workspace from the token (or validates `X-Workspace-Id` matches `apiToken.workspaceId`), sets `app.workspace_id` / `app.user_id` / `app.api_token_id` under `app_user` RLS.
- **Permissions**:
  - `read_only` tokens are restricted to `GET`/`HEAD`/`OPTIONS`.
  - `sections` are checked against `TOKEN_PATH_SECTIONS` via `requireV1Scope` alongside module licensing (`requireModule`) and position restrictions (`requireSection`).
  - `POST /v1/documents/:id/post` requires `can_post` (enforced via `isTokenPostingRequest`).
- **OpenAPI 3.0.3**: `GET /v1/openapi.json` is unauthenticated and returns the complete OpenAPI 3.0.3 specification (`apps/api/src/routes/v1/openapi.ts`).

### Endpoints
- `GET /v1/products`, `GET /v1/products/:id`
- `GET /v1/stock`
- `GET /v1/prices`
- `GET /v1/companies`, `GET /v1/companies/:id`
- `GET /v1/warehouses`
- `GET /v1/documents`, `GET /v1/documents/:id`
- `POST /v1/documents`, `PATCH /v1/documents/:id`, `POST /v1/documents/:id/post`

## Outgoing Webhooks

- **Tables** (`packages/db/drizzle/0138_webhooks.sql`, `packages/db/src/schema/webhooks.ts`):
  - `webhooks`: tenant-scoped subscriptions (`url`, `secret`, `events text[]`, `enabled`) protected by `app_secure_tenant_table`.
  - `webhook_deliveries`: delivery queue and log (`webhook_id`, `event_id`, `status`, `attempts`, `response_status`, `last_error`, `next_attempt_at`, `delivered_at`), unique per `(workspace_id, webhook_id, event_id)`.
- **Outbox Integration** (`apps/worker/src/handlers.ts`, `apps/worker/src/webhooks.ts`):
  - `handleEvent` calls `enqueueWebhooksForEvent(db, event)` for every outbox event. Subscriptions support exact event types, prefix wildcards (`document.*`), and `*`.
- **Delivery Worker** (`apps/worker/src/webhooks.ts`, `apps/worker/src/webhook-http.ts`):
  - `processWebhookDeliveriesOnce` claims due `queued` rows with `FOR UPDATE SKIP LOCKED`, sends `POST` outside the DB transaction using `guardedFetch` (`allowPrivate: false`, SSRF protection, 10s timeout, no redirects) with `X-FutureERP-Signature: sha256=<hmac-sha256>`.
  - Failed deliveries retry with exponential backoff up to 5 attempts before transitioning to `failed`.
- **Management API** (`apps/api/src/routes/webhooks.ts`, admin/owner only):
  - `GET /webhooks`, `POST /webhooks`, `PATCH /webhooks/:id`, `DELETE /webhooks/:id`
  - `GET /webhooks/:id/deliveries`, `POST /webhooks/:id/deliveries/:deliveryId/retry`
- **UI**: Settings → Integrations (`apps/web/src/app/settings/webhooks-settings.tsx` and `webhook-deliveries.tsx`).
