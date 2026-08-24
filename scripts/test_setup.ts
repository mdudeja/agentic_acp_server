import { beforeAll, afterAll } from 'bun:test'
import { unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AgenticDB } from 'src/database/AgenticDB'

beforeAll(() => {
  // User AgenticDB.getInstance() to setup the test database and run migrations.
  AgenticDB.getInstance().getDB()
})

afterAll(() => {
  try {
    unlinkSync(process.env.ACP_DB_FILE_URL!)
    unlinkSync(`${process.env.ACP_DB_FILE_URL!}-shm`)
    unlinkSync(`${process.env.ACP_DB_FILE_URL!}-wal`)

    const workspace_root = join(import.meta.dirname, '..')
    rmSync(join(workspace_root, '.agentic'), { recursive: true, force: true })
  } catch {
    // already removed
  }
})
