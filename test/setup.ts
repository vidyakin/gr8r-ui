/* Preload для `bun test`: тестовая БД с нуля, переменные окружения для приложения. */
import { setupTestDatabase } from '@gr8r/db/testing';

const db = await setupTestDatabase();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = db.appUrl;
process.env.ADMIN_DATABASE_URL = db.adminUrl;
process.env.DATABASE_URL_DDL = db.ddlUrl;
process.env.AUTH_RATE_LIMIT_MAX = '1000'; // отдельные тесты ограничивают лимит сами
