/* Арендаторы для оператора установки: создание (пустой или с демо-данными), запрос удаления, удаление целиком,
   выгрузка в архив и загрузка обратно, очистка просроченных демо. Раздел docs/architecture/deploy.md. */
import { readFileSync } from 'node:fs';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { STATUSES } from '@gr8r/shared';
import type { Db, Sql, Tx } from './client';
import { withContext } from './context';
import { ensureCostItems, ensureDocumentDefaults } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { ensureLeadStatuses } from './leads';
import { dropFieldIndex, enqueueFieldIndex, registerSystemEntities } from './meta';
import { registerBaseUnits } from './catalog';
import { ensureModuleProjects } from './modules';
import { ensurePriceKinds } from './pricing';
import { members, memberships, statuses, users, workspaces } from './schema';
import { fields } from './schema/meta';
import { seedDemoWorkspace } from './seed';
import { uuidv7 } from './uuid';
import { ensureWorkOrderKind } from './work-orders';

const PALETTE = ['#5A67D8', '#C54B78', '#3B82C4', '#23918A', '#C48A1E', '#8662C9', '#3D8E5F', '#C0612B'];
/** Срок жизни демо-арендатора по умолчанию, дней */
export const DEMO_TTL_DAYS = 14;

// Транслитерация кириллицы для адреса воркспейса: «ООО Ромашка» → ooo-romashka
const TRANSLIT: Record<string, string> = Object.fromEntries(
  'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya'
    .split(' ')
    .map(p => p.split(':') as [string, string]),
);

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[а-яё]/g, ch => TRANSLIT[ch] ?? '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'workspace';

/** Случайный пароль для нового владельца: показывается оператору один раз, в БД — только хэш */
export const generatePassword = () => Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');

const hashPassword = (pw: string) => Bun.password.hash(pw, { algorithm: 'argon2id' });

export interface WorkspaceOwner {
  userId: string;
  email: string;
  name: string;
}

/** Пустой арендатор: строка воркспейса, владелец (членство + профиль), справочники по умолчанию, событие workspace.created.
    Вызывается в транзакции с app.workspace_id = id (регистрация, /workspaces, createTenant) */
export async function initWorkspace(db: Db, input: { id: string; name: string; slug: string; color?: string; owner: WorkspaceOwner }) {
  const { id, owner } = input;
  const [ws] = await db.insert(workspaces).values({ id, name: input.name, slug: input.slug, color: input.color ?? '#1D1C1A', createdBy: owner.userId }).returning();
  await db.insert(memberships).values({ workspaceId: id, userId: owner.userId, role: 'owner' });
  const [me] = await db
    .insert(members)
    .values({ workspaceId: id, userId: owner.userId, email: owner.email, name: owner.name, color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!, role: 'owner' })
    .returning();
  await db.insert(statuses).values(STATUSES.map((s, i) => ({ workspaceId: id, key: s.id, name: s.name, color: `var(--st-${s.id})`, builtin: true, sortOrder: i })));
  await registerSystemEntities(db, id);
  await ensureLeadStatuses(db, id);
  await registerBaseUnits(db, id);
  await ensurePriceKinds(db, id);
  await ensureDocumentDefaults(db, id, input.name);
  await ensureCostItems(db, id);
  await ensureModuleProjects(db, id);
  await ensureWorkOrderKind(db, id);
  await recordEvent(db, { workspaceId: id, type: 'workspace.created', entity: 'workspace', recordId: id, actorId: me!.id, payload: { name: input.name } });
  return { ws: ws!, me: me! };
}

export interface CreateTenantInput {
  name: string;
  slug?: string;
  owner: { email: string; name?: string; password?: string };
  /** С демо-данными и сроком жизни */
  demo?: boolean;
  ttlDays?: number;
}

export interface CreatedTenant {
  workspaceId: string;
  slug: string;
  kind: 'regular' | 'demo';
  expiresAt: Date | null;
  ownerEmail: string;
  /** Пароль нового владельца (сгенерированный или переданный); null — владелец уже был зарегистрирован, пароль прежний */
  password: string | null;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/** Создаёт арендатора. Владелец — существующий пользователь с этим email или новый (пароль генерируется, если не передан) */
export async function createTenant(sql: Sql, input: CreateTenantInput): Promise<CreatedTenant> {
  const email = input.owner.email.trim().toLowerCase();
  let password: string | null = null;
  const owner = await withContext(sql, {}, async db => {
    const [found] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(dsql`lower(${users.email})`, email)).limit(1);
    if (found) return found;
    password = input.owner.password ?? generatePassword();
    const [created] = await db
      .insert(users)
      .values({ email, name: input.owner.name?.trim() || email.split('@')[0]!, passwordHash: await hashPassword(password) })
      .returning({ id: users.id, email: users.email, name: users.name });
    return created!;
  });

  const id = uuidv7();
  const slug = input.slug ?? `${slugify(input.name)}-${id.slice(-6)}`;
  const kind = input.demo ? ('demo' as const) : ('regular' as const);
  const expiresAt = input.demo ? new Date(Date.now() + (input.ttlDays ?? DEMO_TTL_DAYS) * 864e5) : null;
  try {
    await withContext(sql, { userId: owner.id, workspaceId: id }, async db => {
      if (input.demo) {
        const stats = await seedDemoWorkspace(db, id, owner.id, new Map([['m1', owner.id]]), uuidv7(), { name: input.name, slug, ownerEmail: owner.email, ownerName: owner.name });
        // Индексы полей с флагом filterable строит воркер (как в runSeed)
        for (const t of stats.metaFields) await enqueueFieldIndex(db, id, 'create', t.fieldId);
      } else {
        await initWorkspace(db, { id, name: input.name, slug, owner: { userId: owner.id, email: owner.email, name: owner.name } });
      }
      await db.update(workspaces).set({ kind, expiresAt }).where(eq(workspaces.id, id));
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError(409, 'slug_taken', `Workspace address "${slug}" is already taken`);
    throw e;
  }
  return { workspaceId: id, slug, kind, expiresAt, ownerEmail: owner.email, password };
}

/** Запрос удаления из API оператора: арендатор пропадает из «моих воркспейсов», воркер удаляет его целиком (purgeTenantsOnce) */
export async function requestTenantDelete(sql: Sql, workspaceId: string) {
  const [row] = await withContext(sql, { workspaceId }, db =>
    db.update(workspaces).set({ deleteRequestedAt: new Date() }).where(eq(workspaces.id, workspaceId)).returning({ id: workspaces.id }),
  );
  if (!row) throw new DomainError(404, 'not_found', 'Workspace not found');
}

/** Удаляет арендатора целиком: индексы полей конструктора (DDL), строку воркспейса (все таблицы арендатора удаляются каскадом)
    и пользователей, у которых не осталось членств. `ddl` — подключение владельца таблиц (DATABASE_URL_DDL) или админское */
export async function deleteTenant(sql: Sql, ddl: Sql, workspaceId: string): Promise<boolean> {
  const indexed = await withContext(sql, { workspaceId }, db =>
    db.select({ id: fields.id }).from(fields).where(and(eq(fields.workspaceId, workspaceId), eq(fields.filterable, true))),
  );
  for (const f of indexed) await dropFieldIndex(ddl, f.id);
  return withContext(
    sql,
    {},
    async (_db, tx) => {
      const owners = (await tx`select user_id from memberships where workspace_id = ${workspaceId}`).map(r => r.user_id as string);
      const deleted = await tx`delete from workspaces where id = ${workspaceId} returning id`;
      if (owners.length) await tx`delete from users u where u.id = any(${owners}::uuid[]) and not exists (select 1 from memberships m where m.user_id = u.id)`;
      return deleted.length > 0;
    },
    'app_worker',
  );
}

/** Удаляет арендаторов с запросом удаления и просроченные демо. Вызывает воркер периодически */
export async function purgeTenantsOnce(sql: Sql, ddl: Sql, now = new Date()): Promise<string[]> {
  const due = await withContext(
    sql,
    {},
    async (_db, tx) => (await tx`select id from workspaces where delete_requested_at is not null or (kind = 'demo' and expires_at < ${now.toISOString()}::timestamptz) order by created_at limit 20`).map(r => r.id as string),
    'app_worker',
  );
  for (const id of due) await deleteTenant(sql, ddl, id);
  return due;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  kind: 'regular' | 'demo';
  /** Даты — ISO-строки (так их отдаёт сырой SQL) */
  expires_at: string | null;
  delete_requested_at: string | null;
  created_at: string;
  owner_email: string | null;
  members: number;
}

/** Все арендаторы установки (CLI, под app_worker) */
export async function listTenants(sql: Sql): Promise<TenantRow[]> {
  return withContext(
    sql,
    {},
    async (_db, tx) =>
      (await tx`
        select w.id, w.name, w.slug, w.kind, w.expires_at, w.delete_requested_at, w.created_at,
          (select u.email from memberships m join users u on u.id = m.user_id where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) as owner_email,
          (select count(*)::int from memberships m where m.workspace_id = w.id) as members
        from workspaces w order by w.created_at`) as unknown as TenantRow[],
    'app_worker',
  );
}

/** Список для API оператора: функция app_operator_tenants сама проверяет флаг is_operator текущего пользователя */
export async function listTenantsForOperator(sql: Sql, userId: string): Promise<TenantRow[]> {
  return withContext(sql, { userId }, async (_db, tx) => (await tx`select * from app_operator_tenants()`) as unknown as TenantRow[]);
}

export async function setOperator(sql: Sql, email: string, value: boolean): Promise<boolean> {
  const rows = await withContext(sql, {}, db =>
    db.update(users).set({ isOperator: value }).where(eq(dsql`lower(${users.email})`, email.trim().toLowerCase())).returning({ id: users.id }),
  );
  return rows.length > 0;
}

export async function isOperator(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await withContext(sql, { userId }, db => db.select({ v: users.isOperator }).from(users).where(eq(users.id, userId)).limit(1));
  return row?.v ?? false;
}

/* ---- Выгрузка и загрузка ----
   Формат: текст построчно. Первая строка — заголовок JSON, дальше строки `<таблица>\t<json-массив строк>`.
   Строки таблиц сериализует и разбирает сам Postgres (to_jsonb / jsonb_populate_recordset): numeric, даты, jsonb и bytea
   переносятся без потерь, JS их не разбирает. Таблица jobs не выгружается (это очередь, а не данные). */

export const TENANT_ARCHIVE_FORMAT = 'gr8r-tenant';
const ARCHIVE_VERSION = 1;
const SKIP_TABLES = new Set(['jobs']);

/** Последняя миграция: архив загружается только в установку с той же схемой */
export function schemaTag(): string {
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
  return journal.entries.at(-1)!.tag;
}

/** Таблицы арендатора (с колонкой workspace_id), имена — из каталога */
async function tenantTables(tx: Tx): Promise<string[]> {
  const rows = await tx`
    select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition order by c.relname`;
  return rows.map(r => r.relname as string).filter(t => !SKIP_TABLES.has(t));
}

/** Колонки арендатора, ссылающиеся на users (кроме sessions): при загрузке пересчитываются на пользователей установки */
async function userRefColumns(tx: Tx): Promise<{ table: string; column: string }[]> {
  const rows = await tx`
    select cl.relname as table, a.attname as column from pg_constraint k
    join pg_class cl on cl.oid = k.conrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.contype = 'f' and k.confrelid = 'public.users'::regclass and cl.relname <> 'sessions' order by 1, 2`;
  return rows.map(r => ({ table: r.table as string, column: r.column as string }));
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad identifier "${name}"`);
  return `"${name}"`;
};

export interface TenantArchiveHeader {
  format: typeof TENANT_ARCHIVE_FORMAT;
  version: number;
  schema: string;
  exportedAt: string;
  workspaceId: string;
  name: string;
  slug: string;
}

/** Выгрузка арендатора. Читает под app_user с app.workspace_id: RLS отдаёт ровно строки этого арендатора */
export async function exportTenant(sql: Sql, workspaceId: string): Promise<string> {
  return withContext(sql, { workspaceId }, async (_db, tx) => {
    const [ws] = await tx`select name, slug, to_jsonb(w)::text as row from workspaces w where id = ${workspaceId}`;
    if (!ws) throw new DomainError(404, 'not_found', 'Workspace not found');
    const header: TenantArchiveHeader = { format: TENANT_ARCHIVE_FORMAT, version: ARCHIVE_VERSION, schema: schemaTag(), exportedAt: new Date().toISOString(), workspaceId, name: ws.name, slug: ws.slug };
    const refs = (await userRefColumns(tx)).map(r => `select ${ident(r.column)} as id from ${ident(r.table)} where ${r.table === 'workspaces' ? 'id' : 'workspace_id'} = $1`);
    const [u] = await tx.unsafe(
      `select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', name, 'password_hash', password_hash, 'locale', locale)), '[]')::text as rows
       from users where id in (${refs.join(' union ')})`,
      [workspaceId],
    );
    const lines = [JSON.stringify(header), `users\t${u!.rows}`, `workspaces\t[${ws.row}]`];
    for (const t of await tenantTables(tx)) {
      const [r] = await tx.unsafe(`select count(*)::int as n, coalesce(jsonb_agg(to_jsonb(t)), '[]')::text as rows from ${ident(t)} t where t.workspace_id = $1`, [workspaceId]);
      if (r!.n > 0) lines.push(`${t}\t${r!.rows}`);
    }
    return lines.join('\n') + '\n';
  });
}

export function readArchiveHeader(archive: string): TenantArchiveHeader {
  const header = JSON.parse(archive.slice(0, archive.indexOf('\n'))) as TenantArchiveHeader;
  if (header.format !== TENANT_ARCHIVE_FORMAT) throw new Error('Not a gr8r tenant archive');
  if (header.version !== ARCHIVE_VERSION) throw new Error(`Unsupported archive version ${header.version}`);
  return header;
}

/** Загрузка архива с прежними id. Только под суперпользователем (ADMIN_DATABASE_URL, CLI): в одной транзакции с
    session_replication_role = replica — порядок таблиц и циклы ссылок не важны, триггеры не срабатывают.
    Пользователи сопоставляются по email; события помечаются обработанными, чтобы автоматизации не запустились повторно */
export async function importTenant(adminSql: Sql, archive: string): Promise<TenantArchiveHeader> {
  const header = readArchiveHeader(archive);
  const current = schemaTag();
  if (header.schema !== current) throw new Error(`Archive schema ${header.schema} does not match installation schema ${current}`);
  const lines = archive.split('\n').slice(1).filter(Boolean);
  await adminSql.begin(async tx => {
    const [taken] = await tx`select id from workspaces where id = ${header.workspaceId} or lower(slug) = lower(${header.slug})`;
    if (taken) throw new Error(`Workspace ${header.workspaceId} or address "${header.slug}" already exists`);
    const known = new Set(['workspaces', ...(await tenantTables(tx))]);
    await tx`set local session_replication_role = replica`;
    await tx`create temp table tenant_user_map (old_id uuid primary key, new_id uuid not null) on commit drop`;
    for (const line of lines) {
      const tab = line.indexOf('\t');
      const table = line.slice(0, tab);
      const rows = line.slice(tab + 1);
      if (table === 'users') {
        // Существующий email — к нему, иначе пользователь создаётся с прежним id
        await tx.unsafe(
          `with src as (select * from jsonb_to_recordset($1::jsonb) as x(id uuid, email text, name text, password_hash text, locale text)),
           ins as (insert into users (id, email, name, password_hash, locale)
             select id, email, name, password_hash, locale from src where not exists (select 1 from users u where lower(u.email) = lower(src.email)) returning id)
           insert into tenant_user_map select src.id, coalesce((select u.id from users u where lower(u.email) = lower(src.email)), src.id) from src`,
          [rows],
        );
        continue;
      }
      if (!known.has(table)) throw new Error(`Unknown table "${table}" in archive`);
      await tx.unsafe(`insert into ${ident(table)} overriding system value select * from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`, [rows]);
    }
    for (const r of await userRefColumns(tx)) {
      const scope = r.table === 'workspaces' ? 'id' : 'workspace_id';
      await tx.unsafe(`update ${ident(r.table)} t set ${ident(r.column)} = m.new_id from tenant_user_map m where t.${ident(r.column)} = m.old_id and m.new_id <> m.old_id and t.${scope} = $1`, [header.workspaceId]);
    }
    // Identity-колонки (seq событий): в другой установке счётчик может отставать от загруженных значений
    const identities = await tx`select c.relname as table, a.attname as column from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and a.attidentity <> '' and not a.attisdropped`;
    for (const r of identities) {
      const seq = `pg_get_serial_sequence('${ident(r.table as string)}', '${r.column}')`;
      await tx.unsafe(`select setval(${seq}, max_v) from (select max(${ident(r.column as string)}) as max_v from ${ident(r.table as string)}) m
        where max_v > coalesce((select last_value from pg_sequences where schemaname || '.' || sequencename = ${seq}), 0)`);
    }
    await tx`update events set processed_at = coalesce(processed_at, now()) where workspace_id = ${header.workspaceId}`;
    // Индексы полей конструктора — заново, через воркер
    await tx`insert into jobs (workspace_id, queue, type, payload)
      select workspace_id, 'ddl', 'index.create', jsonb_build_object('fieldId', id) from fields where workspace_id = ${header.workspaceId} and filterable`;
  });
  return header;
}
