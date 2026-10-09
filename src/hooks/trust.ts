import { eq } from 'drizzle-orm'
import { AgenticDB } from 'src/database/AgenticDB'
import { hookTrust } from 'src/database/schemas'

/** A recorded decision about running a project hook file. */
export interface TrustRecord {
  sha256: string
  trusted: boolean
}

export interface TrustStore {
  get(path: string): Promise<TrustRecord | null>
  set(path: string, record: TrustRecord): Promise<void>
}

/** Trust decisions persisted in the `hook_trust` table. */
export class DbTrustStore implements TrustStore {
  private get db() {
    return AgenticDB.getInstance().getDB()
  }

  async get(path: string): Promise<TrustRecord | null> {
    const row = await this.db
      .select()
      .from(hookTrust)
      .where(eq(hookTrust.path, path))
      .then((rows) => rows[0])

    return row ? { sha256: row.sha256, trusted: row.trusted } : null
  }

  async set(path: string, record: TrustRecord): Promise<void> {
    await this.db
      .insert(hookTrust)
      .values({ path, ...record })
      .onConflictDoUpdate({
        target: hookTrust.path,
        set: { sha256: record.sha256, trusted: record.trusted },
      })
  }
}

/** In-memory trust store (tests, or when no DB is wanted). */
export class MemoryTrustStore implements TrustStore {
  private records = new Map<string, TrustRecord>()

  async get(path: string): Promise<TrustRecord | null> {
    return this.records.get(path) ?? null
  }

  async set(path: string, record: TrustRecord): Promise<void> {
    this.records.set(path, record)
  }
}

export function sha256(content: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(content).digest('hex')
}
