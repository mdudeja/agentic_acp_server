import { int, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { baseSchema } from './common.schema'

/**
 * The user's decision about running a project hook file (a hook file inside
 * a workspace, which may come from the repository).
 *
 * Keyed by absolute path; `sha256` is the file content the decision was made
 * for, so editing the file asks again.
 */
export const hookTrust = sqliteTable(
  'hook_trust',
  {
    ...baseSchema,
    path: text().notNull(),
    sha256: text().notNull(),
    trusted: int({ mode: 'boolean' }).notNull(),
  },
  (table) => [unique('idx_hook_trust_path').on(table.path)],
)

export type HookTrust = {
  Insert: typeof hookTrust.$inferInsert
  Select: typeof hookTrust.$inferSelect
  Update: Partial<typeof hookTrust.$inferSelect>
}
