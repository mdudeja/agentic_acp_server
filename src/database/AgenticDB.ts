import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'

import * as schema from './schemas'
import { existsSync, mkdirSync } from 'node:fs'
import { drizzle, SQLiteBunDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { defineRelations } from 'drizzle-orm'
import { resolvePath } from 'src/utils/paths'
import { logDebug } from 'src/utils/logger'

export class AgenticDB {
  db: SQLiteBunDatabase<typeof schema> | null = null

  private dbFilePath?: string
  private static instance: AgenticDB | null = null
  private dbReady: boolean = false

  constructor(filePath?: string) {
    this.dbFilePath = filePath || process.env.DB_FILE_URL
  }

  public static getInstance(filePath?: string): AgenticDB {
    if (
      !AgenticDB.instance ||
      (filePath && AgenticDB.instance.dbFilePath !== filePath)
    ) {
      AgenticDB.instance = new AgenticDB(filePath)
    }
    return AgenticDB.instance
  }

  public isReady(): boolean {
    return this.dbReady
  }

  public getDB(): SQLiteBunDatabase<typeof schema> {
    if (this.db && this.dbReady) {
      return this.db
    }

    return this._init()
  }

  private _init() {
    if (!this.dbFilePath) {
      throw new Error('Database file path is not set')
    }

    const resolvedPath = resolvePath(this.dbFilePath)

    const dbDir = dirname(resolvedPath)

    if (!existsSync(dbDir)) {
      logDebug(`Creating database directory at ${dbDir}`)
      mkdirSync(dbDir, { recursive: true })
    }

    const sqlite = new Database(resolvedPath, { create: true, strict: true })

    sqlite.run('PRAGMA foreign_keys = ON;')
    sqlite.run('PRAGMA journal_mode = WAL;')
    sqlite.run('PRAGMA synchronous = NORMAL;')

    const relations = this._make_relations()

    this.db = drizzle({
      client: sqlite,
      schema,
      relations,
    })

    const migrationsDir = resolvePath(
      process.env.DB_MIGRATIONS_DIR || './drizzle_migrations',
    )

    migrate(this.db, { migrationsFolder: migrationsDir })
    this.dbReady = true
    logDebug('Database initialized and migrations applied')

    return this.db
  }

  private _make_relations() {
    const { agents, sessions } = schema

    const relations = defineRelations({ agents, sessions }, (r) => ({
      agents: {
        sessions: r.many.sessions({
          from: r.agents.id,
          to: r.sessions.agent_id,
        }),
      },
      sessions: {
        agent: r.one.agents({
          from: r.sessions.agent_id,
          to: r.agents.id,
        }),
      },
    }))

    return relations
  }
}
