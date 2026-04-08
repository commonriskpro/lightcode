import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql/node"

/**
 * Node.js entrypoint for the libSQL-backed Drizzle client.
 *
 * Mirrors `db.bun.ts` exactly but imports from `drizzle-orm/libsql/node`,
 * which is the Node.js-optimized variant of the libSQL adapter. Used when
 * lightcode runs under plain `node` instead of `bun` (e.g. Node-based
 * tests, server processes). See the `#db` condition mapping in
 * `packages/opencode/package.json`.
 */
export async function init(path: string) {
  const url = path === ":memory:" ? ":memory:" : `file:${path}`
  const client = createClient({ url, intMode: "number" })
  return drizzle({ client })
}
