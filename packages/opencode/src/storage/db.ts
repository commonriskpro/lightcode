import { type LibSQLDatabase } from "drizzle-orm/libsql"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "../flag/flag"
import { CHANNEL } from "../installation/meta"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export function getChannelPath() {
    if (["latest", "beta"].includes(CHANNEL) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "lightcode.db")
    const safe = CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `lightcode-${safe}.db`)
  }

  export const Path = iife(() => {
    if (Flag.OPENCODE_DB) {
      if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
      return path.join(Global.Path.data, Flag.OPENCODE_DB)
    }
    return getChannelPath()
  })

  export type Transaction = SQLiteTransaction<"async", any, any, any>

  type DbClient = LibSQLDatabase

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Cached async init. `lazy()` caches the returned Promise, so concurrent
   * callers share the same in-flight initialization and the PRAGMAs +
   * migrations run exactly once. `lazy.reset()` clears the Promise so
   * `close()` can be followed by a fresh `Client()` call.
   */
  export const Client = lazy(async () => {
    log.info("opening database", { path: Path })

    const db = await init(Path)

    await db.$client.execute("PRAGMA journal_mode = WAL")
    await db.$client.execute("PRAGMA synchronous = NORMAL")
    await db.$client.execute("PRAGMA busy_timeout = 5000")
    await db.$client.execute("PRAGMA cache_size = -64000")
    await db.$client.execute("PRAGMA foreign_keys = ON")
    await db.$client.execute("PRAGMA wal_checkpoint(PASSIVE)")

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      await applyMigrations(db, entries)
    }

    return db
  })

  /**
   * Minimal drop-in replacement for `drizzle-orm/libsql/migrator`'s `migrate()`.
   * The libsql migrator in drizzle-orm@1.0.0-beta only accepts `MigrationConfig`
   * with a `migrationsFolder` path, but lightcode has always fed migrations as
   * an in-memory `MigrationsJournal` (either bundled at build time via
   * `OPENCODE_MIGRATIONS` or read from disk in dev). We reproduce the same
   * behavior as the previous `drizzle-orm/bun-sqlite/migrator.migrate` journal
   * overload: create `__drizzle_migrations`, skip already-applied entries (by
   * `created_at` timestamp, same convention), and run the rest.
   */
  async function applyMigrations(db: Awaited<ReturnType<typeof init>>, journal: Journal) {
    await db.$client.execute(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC,
        name TEXT,
        applied_at TEXT
      )
    `)
    const applied = await db.$client.execute("SELECT created_at FROM __drizzle_migrations ORDER BY created_at ASC")
    const seen = new Set<number>()
    for (const row of applied.rows) {
      const ts = Number(row.created_at)
      if (Number.isFinite(ts)) seen.add(ts)
    }
    for (const entry of journal) {
      if (seen.has(entry.timestamp)) continue
      const statements = entry.sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      for (const stmt of statements) {
        await db.$client.execute(stmt)
      }
      await db.$client.execute({
        sql: 'INSERT INTO __drizzle_migrations ("hash", "created_at", "name", "applied_at") VALUES (?, ?, ?, ?)',
        args: ["", entry.timestamp, entry.name, new Date().toISOString()],
      })
    }
  }

  export async function close() {
    const db = await Client()
    db.$client.close()
    Client.reset()
  }

  export type TxOrDb = Transaction | DbClient

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export async function use<T>(callback: (trx: TxOrDb) => Promise<T> | T): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const client = await Client()
        const result = await ctx.provide({ effects, tx: client }, () => callback(client))
        for (const fx of effects) await fx()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    const bound = InstanceState.bind(fn)
    try {
      ctx.use().effects.push(bound)
    } catch {
      bound()
    }
  }

  export async function transaction<T>(
    callback: (tx: TxOrDb) => Promise<T> | T,
    options?: {
      behavior?: "deferred" | "immediate" | "exclusive"
    },
  ): Promise<T> {
    try {
      return await callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const client = await Client()
        const txCallback = InstanceState.bind((tx: Transaction) =>
          ctx.provide({ tx, effects }, () => Promise.resolve(callback(tx))),
        )
        const result = await client.transaction(txCallback, {
          behavior: options?.behavior,
        })
        for (const fx of effects) await fx()
        return result as T
      }
      throw err
    }
  }
}
