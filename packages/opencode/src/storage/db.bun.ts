import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { existsSync } from "fs"
import * as sqliteVec from "sqlite-vec"

export function init(path: string) {
  if (process.platform === "win32") {
    console.warn("[db] sqlite-vec is not supported on Windows — falling back to plain SQLite")
    const sqlite = new Database(path, { create: true })
    const db = drizzle({ client: sqlite })
    return db
  }

  const isMemory = path === ":memory:"

  if (process.platform === "darwin" && !isMemory) {
    const arm = "/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib"
    const intel = "/usr/local/opt/sqlite3/lib/libsqlite3.dylib"
    const lib = existsSync(arm) ? arm : existsSync(intel) ? intel : null
    if (lib) Database.setCustomSQLite(lib)
  }

  /**
   * sqlite-vec requires SQLite extension loading, so `enableExtensions: true`
   * must be enabled on the Bun connection.
   *
   * On macOS, Apple's bundled SQLite does not ship with extension support, so
   * we switch Bun to a Homebrew SQLite dylib before opening the database.
   *
   * `:memory:` databases skip sqlite-vec loading because extension-backed vec
   * tests and runtime setup use file-backed databases only.
   *
   * The vector dimension is defined in the migration (`FLOAT[384]`), not here.
   */
  const sqlite = new Database(path, { create: true, enableExtensions: true })

  sqliteVec.load(sqlite)

  const db = drizzle({ client: sqlite })
  return db
}
