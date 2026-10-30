CREATE TABLE "favorites" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_member_id_entity_record_id_pk" PRIMARY KEY("member_id","entity","record_id"),
	CONSTRAINT "favorites_entity_chk" CHECK ("favorites"."entity" in ('project','task'))
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "fav_member_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorites_ws_record_idx" ON "favorites" USING btree ("workspace_id","entity","record_id");--> statement-breakpoint
SELECT app_secure_tenant_table('public.favorites'::regclass);--> statement-breakpoint
-- Прежнее общее избранное становится личным у всех действующих участников воркспейса
INSERT INTO "favorites" ("workspace_id","member_id","entity","record_id")
SELECT p."workspace_id", m."id", 'project', p."id" FROM "projects" p JOIN "members" m ON m."workspace_id" = p."workspace_id" AND m."status" <> 'deactivated' WHERE p."fav";--> statement-breakpoint
INSERT INTO "favorites" ("workspace_id","member_id","entity","record_id")
SELECT t."workspace_id", m."id", 'task', t."id" FROM "tasks" t JOIN "members" m ON m."workspace_id" = t."workspace_id" AND m."status" <> 'deactivated' WHERE t."fav";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "fav";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "fav";