import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { baseSchema, sessionStatusSchema } from './common.schema'
import { agents } from './agents.schema'

export const sessions = sqliteTable(
  'sessions',
  {
    ...baseSchema,
    ...sessionStatusSchema,
    name: text(),
    acp_session_id: text().notNull(),
    agent_id: text()
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    is_archived: integer({ mode: 'boolean' }).default(false),
  },
  (table) => [
    index('idx_session_agent_id').on(table.agent_id),
    index('idx_session_created_at').on(table.created_at),
    index('idx_session_updated_at').on(table.updated_at),
  ],
)

export type Session = {
  Insert: typeof sessions.$inferInsert
  Select: typeof sessions.$inferSelect
  Update: Partial<typeof sessions.$inferSelect>
}
