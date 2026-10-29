/* Лицензия текущего арендатора: включённые модули и тариф (docs/architecture/licensing.md). Читают все участники. */
import { Hono } from 'hono';
import { readMyLicense } from '@gr8r/db';
import { licenseView } from '@gr8r/shared';
import type { AppEnv } from '../types';

export const licenseRoutes = new Hono<AppEnv>().get('/', async c => c.json(licenseView(await readMyLicense(c.get('db')))));
