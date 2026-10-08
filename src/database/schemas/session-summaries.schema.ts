import { index, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { baseSchema } from './common.schema'
import { sessions } from './sessions.schema'

/**
 * Maps a session to its generated summary artifact on disk.
 *
 * One summary per session (upserted): regenerating a summary overwrites both
 * the file and this row. The file itself is the source of truth for the
 * summary content; this table only records where it lives so clients can
 * locate it later.
 */
export const sessionSummaries = sqliteTable(
  'session_summaries',
  {
    ...baseSchema,
    session_id: text()
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    file_path: text().notNull(),
    format: text().notNull().default('markdown'),
  },
  (table) => [
    index('idx_session_summary_session_id').on(table.session_id),
    unique('idx_session_id').on(table.session_id),
  ],
)

export type SessionSummary = {
  Insert: typeof sessionSummaries.$inferInsert
  Select: typeof sessionSummaries.$inferSelect
  Update: Partial<typeof sessionSummaries.$inferSelect>
}
