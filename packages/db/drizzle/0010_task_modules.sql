ALTER TABLE "projects" ADD COLUMN "module" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "module" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_ws_module_uq" ON "projects" USING btree ("workspace_id","module") WHERE "projects"."module" <> 'general';--> statement-breakpoint
CREATE INDEX "projects_ws_module_idx" ON "projects" USING btree ("workspace_id","module");--> statement-breakpoint
CREATE INDEX "tasks_ws_module_idx" ON "tasks" USING btree ("workspace_id","module");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_module_chk" CHECK ("projects"."module" in ('general','production','services'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_module_chk" CHECK ("tasks"."module" in ('general','production','services'));--> statement-breakpoint
-- Системные проекты модулей (production, services) для воркспейсов, созданных до этой миграции:
-- без них нельзя создать задачу модуля. Ключ проекта уникален в воркспейсе — занятый ключ пропускаем,
-- проект модуля тогда создаст код (ensureModuleProject) при первом обращении.
insert into projects (id, workspace_id, key, name, icon, color, status, module, description, milestones, task_counter, sort_order, last_activity_at, created_at, updated_at)
select uuid_generate_v7(), w.id, m.key, m.name, m.icon, m.color, 'active', m.module, m.description, '[]'::jsonb, 0, 1000, now(), now(), now()
from workspaces w
cross join (values
  ('PROD', 'Production', 'factory', 'violet', 'production', 'Tasks of the production module: operations, work orders and releases.'),
  ('SERV', 'Services', 'wrench', 'teal', 'services', 'Tasks of the services module: orders, works and acts.')
) as m(key, name, icon, color, module, description)
where not exists (select 1 from projects p where p.workspace_id = w.id and p.module = m.module)
  and not exists (select 1 from projects p where p.workspace_id = w.id and lower(p.key) = lower(m.key))
on conflict do nothing;
