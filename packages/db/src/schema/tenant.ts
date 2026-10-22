/* Колонка workspace_id арендатора — в каждой таблице данных. Вынесена отдельно, чтобы графики (calendars.ts)
   ссылались на арендатора, не замыкая круг импортов с профилями участников (people.ts). */
import { uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './core';

export const wsCol = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });
