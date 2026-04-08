import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

/**
 * Initialize the libSQL-backed Drizzle client.
 *
 * libSQL is a fork of SQLite with native vector search (`F32_BLOB`,
 * `vector_top_k`, `vector_distance_cos`) and embedded-replica sync,
 * replacing the previous Bun SQLite + extension-based vector stack.
 *
 * Supports both file-backed (`file:/path/to/db.sqlite`) and in-memory
 * (`:memory:`) databases. `intMode: "number"` is required to match the
 * numeric `INTEGER` return type behavior of `bun:sqlite` — without it,
 * libSQL returns `bigint` for every `INTEGER` column and breaks the
 * schema typing throughout the codebase.
 *
 * The cross-platform native binding (`@libsql/<os>-<arch>.node`) is
 * bundled as a sidecar next to the compiled binary via `script/build.ts`
 * and resolved at runtime from the adjacent `node_modules/` directory.
 */
export async function init(path: string) {
  const url = path === ":memory:" ? ":memory:" : `file:${path}`
  const client = createClient({ url, intMode: "number" })
  return drizzle({ client })
}
