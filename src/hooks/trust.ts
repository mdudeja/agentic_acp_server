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
  /** Gets the database instance for data storage and retrieval. */
  private get db() {
    return AgenticDB.getInstance().getDB()
  }

  /** Retrieves trust records by path. */
  async get(path: string): Promise<TrustRecord | null> {
    const row = await this.db
      .select()
      .from(hookTrust)
      .where(eq(hookTrust.path, path))
      .then((rows) => rows[0])

    return row ? { sha256: row.sha256, trusted: row.trusted } : null
  }

  /** Sets or updates a trust record at the specified path. A trust record represents a trust relationship in a system. */
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

  /** Fetches a trust record from the specified path. */
  async get(path: string): Promise<TrustRecord | null> {
    return this.records.get(path) ?? null
  }

  /** Sets a trust record at the specified path. */
  async set(path: string, record: TrustRecord): Promise<void> {
    this.records.set(path, record)
  }
}

/** Computes the SHA-256 hash of the given content and returns it as a hexadecimal string. */
export function sha256(content: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(content).digest('hex')
}
