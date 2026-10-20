import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/gr8r_dev' },
});
