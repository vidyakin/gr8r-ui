/* CLI оператора: арендаторы и операторы установки (docs/architecture/deploy.md). Работает под ADMIN_DATABASE_URL.
   bun run tenant list
   bun run tenant create --name "ООО Ромашка" --owner boss@romashka.ru [--owner-name Имя] [--password …] [--slug romashka] [--plan ключ|id]
   bun run tenant demo --name "Демо для Ромашки" --owner boss@romashka.ru [--ttl 14]
   bun run tenant delete <id|адрес>
   bun run tenant export <id|адрес> [--out файл.jsonl[.gz]]
   bun run tenant import <файл.jsonl[.gz]>
   bun run tenant purge                      # удалить запрошенные к удалению и просроченные демо
   bun run tenant operator grant|revoke <email> */
import { adminDatabaseUrl, createSql } from '..';
import { createTenant, deleteTenant, exportTenant, importTenant, listTenants, purgeTenantsOnce, setOperator } from '../tenants';

const args = process.argv.slice(2);
const [cmd, ...rest] = args;
const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const sql = createSql(adminDatabaseUrl(), { max: 4 });

/** id или адрес (slug) арендатора → id */
async function resolve(ref: string | undefined): Promise<string> {
  if (!ref) fail('Укажите id или адрес арендатора');
  const rows = await listTenants(sql);
  const t = rows.find(r => r.id === ref || r.slug.toLowerCase() === ref!.toLowerCase());
  return t ? t.id : fail(`Арендатор "${ref}" не найден`);
}

try {
  switch (cmd) {
    case 'list': {
      const rows = await listTenants(sql);
      console.table(
        rows.map(r => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          kind: r.kind,
          owner: r.owner_email,
          members: r.members,
          expires: r.expires_at ? String(r.expires_at).slice(0, 10) : '',
          deleting: r.delete_requested_at ? 'yes' : '',
        })),
      );
      break;
    }
    case 'create':
    case 'demo': {
      const name = opt('name') ?? fail('--name обязателен');
      const owner = opt('owner') ?? fail('--owner (email владельца) обязателен');
      const ttl = opt('ttl');
      const t = await createTenant(sql, {
        name,
        slug: opt('slug'),
        owner: { email: owner, name: opt('owner-name'), password: opt('password') },
        demo: cmd === 'demo',
        ttlDays: ttl ? Number(ttl) : undefined,
        plan: opt('plan'),
      });
      console.log(`[tenant] создан ${t.kind === 'demo' ? 'демо-' : ''}арендатор ${t.slug} (${t.workspaceId})${t.expiresAt ? `, удалится ${t.expiresAt.toISOString().slice(0, 10)}` : ''}`);
      console.log(t.password ? `[tenant] вход: ${t.ownerEmail} / ${t.password} (пароль показывается один раз)` : `[tenant] владелец ${t.ownerEmail} уже зарегистрирован — вход с прежним паролем`);
      break;
    }
    case 'delete': {
      const id = await resolve(positional[0]);
      await deleteTenant(sql, sql, id);
      console.log(`[tenant] удалён ${id}`);
      break;
    }
    case 'export': {
      const id = await resolve(positional[0]);
      const out = opt('out') ?? `tenant-${id}.gr8r.jsonl.gz`;
      const archive = await exportTenant(sql, id);
      await Bun.write(out, out.endsWith('.gz') ? Bun.gzipSync(Buffer.from(archive)) : archive);
      console.log(`[tenant] выгружен ${id} → ${out}`);
      break;
    }
    case 'import': {
      const file = positional[0] ?? fail('Укажите файл архива');
      const raw = await Bun.file(file).arrayBuffer();
      const text = file.endsWith('.gz') ? new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(raw))) : new TextDecoder().decode(raw);
      const h = await importTenant(sql, text);
      console.log(`[tenant] загружен ${h.slug} (${h.workspaceId}) из выгрузки ${h.exportedAt}`);
      break;
    }
    case 'purge': {
      const ids = await purgeTenantsOnce(sql, sql);
      console.log(`[tenant] удалено: ${ids.length}`);
      break;
    }
    case 'operator': {
      const [action, email] = positional;
      if ((action !== 'grant' && action !== 'revoke') || !email) fail('bun run tenant operator grant|revoke <email>');
      if (!(await setOperator(sql, email!, action === 'grant'))) fail(`Пользователь ${email} не найден`);
      console.log(`[tenant] ${email}: оператор ${action === 'grant' ? 'назначен' : 'снят'}`);
      break;
    }
    default:
      fail('Команды: list | create | demo | delete | export | import | purge | operator grant|revoke <email>');
  }
} finally {
  await sql.end();
}
