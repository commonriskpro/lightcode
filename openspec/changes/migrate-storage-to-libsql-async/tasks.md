# Tasks — Migrate Storage to libSQL with Async Refactor

Six phases. Must execute in order. Each phase ends with verification that blocks the next.

Total estimated time: **8–10 working days**, divided as:

- Phase 1: ~2 hours
- Phase 2: ~1 day
- Phase 3: ~3–4 days (biggest phase)
- Phase 4: ~1 day
- Phase 5: ~3 hours
- Phase 6: ~2 days

## Phase 1 — Dependencies & Config (2 hours)

Goal: get `@libsql/client` + `drizzle-orm/libsql` installed, `sqlite-vec` removed, drizzle
config switched to `turso` dialect, and `drizzle-kit generate` validated.

- [ ] **1.1** In `packages/opencode/package.json`:
  - Remove from `dependencies`: `sqlite-vec`, `sqlite-vec-darwin-arm64`, `sqlite-vec-darwin-x64`,
    `sqlite-vec-linux-arm64`, `sqlite-vec-linux-x64`, `sqlite-vec-windows-x64`.
  - Add to `dependencies`: `@libsql/client@^0.17.2` (or latest stable).
  - Add to `optionalDependencies` (so install does not fail on a single-platform dev host):
    `@libsql/darwin-arm64`, `@libsql/darwin-x64`, `@libsql/linux-x64-gnu`,
    `@libsql/linux-x64-musl`, `@libsql/linux-arm64-gnu`, `@libsql/linux-arm64-musl`,
    `@libsql/win32-x64-msvc`.
  - Verify `drizzle-orm` is at the same version as POC 3 (`^0.45.2`) or bump if needed.

- [ ] **1.2** Run `bun install` from the repo root. Verify:
  - `node_modules/.bun/@libsql*` directories exist.
  - `node_modules/@libsql/client` is present.
  - `node_modules/libsql/` is present.
  - `node_modules/.bun/@libsql+darwin-arm64@...` (or host-platform equivalent) exists.
  - `node_modules/` no longer contains `sqlite-vec*` directories.

- [ ] **1.3** In `packages/opencode/drizzle.config.ts`:
  - Change `dialect: "sqlite"` to `dialect: "turso"`.
  - Verify `schema` path still points to `./src/**/*.sql.ts` and `out` still points to
    `./migration`.
  - If the config exports a `dbCredentials` object, update it to libSQL format:
    `{ url: "file:./dev.db" }`.

- [ ] **1.4** Run `bun run db generate --name libsql_smoke_test` as a throwaway validation:
  - Should produce a migration in `migration/<timestamp>_libsql_smoke_test/migration.sql`.
  - Inspect the SQL: it should be identical or near-identical to what the `sqlite` dialect
    would produce (since libSQL IS SQLite). If any unexpected keyword appears (e.g. weird
    `WITHOUT ROWID` default, different column type formatting), note it as **Open Question**
    for design.md and delete the migration directory. Do NOT commit.

- [ ] **1.5** Add `@libsql/client` + `drizzle-orm/libsql` to the existing `tsconfig.json` `types`
      if the repo uses explicit `"types"` entries (usually automatic via `bun-types`).

- [ ] **1.6** Commit checkpoint (optional but recommended): `deps: install libsql, remove
sqlite-vec`. Makes rollback easier if subsequent phases hit issues.

**Exit criteria for Phase 1**:

- `bun install` clean.
- `ls node_modules/@libsql/client` succeeds.
- `ls node_modules/sqlite-vec` fails (package removed).
- `bun run db generate` works with the new `turso` dialect.

## Phase 2 — Core storage rewrite (~1 day)

Goal: replace `bun:sqlite` and `drizzle-orm/bun-sqlite` in the three direct users, convert
`Database` namespace to async, validate a cold DB open runs migrations and all PRAGMAs.

### 2A — `db.bun.ts` rewrite

- [ ] **2.1** Back up `packages/opencode/src/storage/db.bun.ts` (for diff reference during
      implementation).

- [ ] **2.2** Rewrite `packages/opencode/src/storage/db.bun.ts` to:
  - Import `createClient` from `@libsql/client`.
  - Import `drizzle` from `drizzle-orm/libsql`.
  - Export `async function init(path: string)` that:
    - Maps `path === ":memory:"` → `url: ":memory:"`.
    - Otherwise → `url: `file:${path}``.
    - Calls `createClient({ url, intMode: "number" })`. **`intMode: "number"` is mandatory
      to match bun:sqlite's `INTEGER → number` behavior** (see design D / open Q3).
    - Wraps the client in `drizzle(client)` and returns.
  - Delete the following pre-existing branches (all dead with libSQL):
    - `if (process.platform === "win32")` Windows sqlite-vec fallback warning.
    - `if (process.platform === "darwin" && !isMemory)` Homebrew dylib detection +
      `Database.setCustomSQLite(lib)`.
    - `sqliteVec.load(sqlite)`.
    - `enableExtensions: true` option.
    - `const isMemory = path === ":memory:"` (now inlined).
    - `import * as sqliteVec from "sqlite-vec"`.
    - `import { Database } from "bun:sqlite"`.
    - `import { drizzle } from "drizzle-orm/bun-sqlite"`.
    - `import { existsSync } from "fs"` (no longer needed).

- [ ] **2.3** Verify that the `#db` export in `packages/opencode/package.json` still points to
      `src/storage/db.bun.ts` (or whatever entry the Bun condition uses).

### 2B — `db.ts` rewrite

- [ ] **2.4** Back up `packages/opencode/src/storage/db.ts`.

- [ ] **2.5** Rewrite the imports at the top of `db.ts`:
  - Remove: `import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"` and
    `import { migrate } from "drizzle-orm/bun-sqlite/migrator"`.
  - Add: `import { type LibSQLDatabase } from "drizzle-orm/libsql"` and
    `import { migrate } from "drizzle-orm/libsql/migrator"`.
  - Keep `import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"`.

- [ ] **2.6** Change type declarations in `db.ts`:
  - `type Transaction = SQLiteTransaction<"sync", void>` → `type Transaction = SQLiteTransaction<"async", ResultSet>`
    (where `ResultSet` is imported from `@libsql/client`).
  - `type DbClient = SQLiteBunDatabase` → `type DbClient = LibSQLDatabase`.
  - **DELETE** `type NotPromise<T> = T extends Promise<any> ? never : T`.

- [ ] **2.7** Rewrite `Database.Client` to use `Effect.cached`:
  - Before: `export const Client = lazy(() => { ... return db })`.
  - After: `export const Client = Effect.cached(Effect.gen(function*() { ... return db }))`.
  - Inside the Effect:
    - `const db = yield* Effect.promise(() => init(Path))`
    - Run each PRAGMA as `yield* Effect.promise(() => db.$client.execute("PRAGMA ..."))`.
    - Run `yield* Effect.promise(() => migrate(db, entries))`.
    - Return `db`.
  - Follow the `Effect.cached` pattern documented in `packages/opencode/AGENTS.md` under
    "Effect.cached for deduplication" and `specs/effect-migration.md`.

- [ ] **2.8** Change `Database.close()`:
  - Before: `Client().$client.close(); Client.reset()`.
  - After: `await Client.pipe(Effect.map(db => db.$client.close())); Client = ... reset ...`.
  - Verify the `Effect.cached` reset semantics — may need manual cache invalidation. Check
    the `src/effect/run-service.ts` helpers for the canonical reset pattern.

- [ ] **2.9** Rewrite `Database.use`:
  - Signature: `export function use<T>(callback: (trx: TxOrDb) => Promise<T>): Promise<T>`.
  - Remove the `ctx.use().tx` happy path (it still works for async callbacks because
    `ctx.provide` is synchronous metadata).
  - Body: `return callback(Client().tx)` → await-able, works inside `Effect.promise` callers.
  - Effects list processing stays the same but the `for (const effect of effects) effect()`
    loop happens AFTER the `await result`.

- [ ] **2.10** Rewrite `Database.transaction`:
  - Signature: `export function transaction<T>(callback: (tx: TxOrDb) => Promise<T>, options?: {behavior?: "deferred" | "immediate" | "exclusive"}): Promise<T>`.
  - Remove `NotPromise<T>` constraint.
  - Map `options.behavior` to libSQL mode per design D5:
    - `undefined` or `"immediate"` or `"exclusive"` → `"write"`
    - `"deferred"` → `"deferred"`
  - Use Drizzle's `db.transaction(async (tx) => { ... }, { behavior: mode })` — async by design.
  - Keep the `ctx.use().tx` reentrancy check for nested calls.

- [ ] **2.11** Keep `Database.effect(fn: () => any | Promise<any>)` signature unchanged. The
      function already accepts Promise returns. The only change is that `use/transaction` now
      run effects after the awaited result instead of sync.

- [ ] **2.12** Compile check: `bun run typecheck` from `packages/opencode` should show
      expected errors in the 21 files that call `Database.use/transaction/effect` (now returning
      Promises). It should NOT show errors in `db.ts` or `db.bun.ts` themselves.

### 2C — `index.ts` sidecar resolution preamble

- [ ] **2.13** Add the following block at the **very top** of
      `packages/opencode/src/index.ts`, BEFORE any other import:

  ```typescript
  // Sidecar node_modules resolution for compiled binaries (D8)
  if (typeof process.execPath === "string" && /lightcode(?:\.exe)?$/.test(process.execPath)) {
    const { Module } = await import("module")
    const path = await import("path")
    const sidecar = path.join(path.dirname(process.execPath), "node_modules")
    Module.globalPaths.unshift(sidecar)
  }
  ```

  - **NOTE**: `await import` at top-level is fine in Bun (supports top-level await).
  - If `Module.globalPaths` is not exposed in Bun, the fallback is a shell wrapper — see
    design.md D8.

- [ ] **2.14** Verify the preamble does NOT execute in `bun run dev` mode (where
      `process.execPath` is the `bun` binary, not `lightcode`).

### 2D — Phase 2 verification

- [ ] **2.15** From `packages/opencode`, run:

  ```bash
  rm -f /tmp/lightcode-phase2.db*
  OPENCODE_DB=/tmp/lightcode-phase2.db bun run ./src/index.ts stats
  ```

  Expected: database opens, 16/17 existing migrations run (the 17th is the current
  `embedding-recall` which will fail with `no such module: vec0`). **This failure is
  expected and will be fixed in Phase 4**.

- [ ] **2.16** Temporarily skip `embedding-recall` migration by setting
      `Flag.OPENCODE_SKIP_MIGRATIONS=1` and re-running. Verify stats command works end-to-end.
      Then unset.

**Exit criteria for Phase 2**:

- `rg "bun:sqlite" packages/opencode/src/storage` → zero matches.
- `rg "drizzle-orm/bun-sqlite" packages/opencode/src/storage` → zero matches.
- `db.ts` compiles without error.
- `db.bun.ts` compiles without error.
- A throwaway `lightcode stats` run against `/tmp/phase2.db` succeeds (skipping the
  vec0 migration).

## Phase 3 — Async-wide call-site migration (3–4 days)

Goal: convert all 90 `Database.use/transaction/effect` call-sites and all 202 Drizzle sync
calls to async. Audit concurrency per subsystem.

**Execution strategy**: work file by file, subsystem by subsystem. Run `bun run typecheck`
often to surface type errors that guide fixes. Each file is committed separately to make
review manageable.

### 3A — Memory subsystem (highest density)

- [ ] **3.1** `packages/opencode/src/memory/fts5-backend.ts` (11 calls):
  - Convert each `Database.use` / `Database.transaction` call to async.
  - If the containing function is an ordinary function, convert it to `async`.
  - If the containing function is an `Effect.gen` or `Effect.fn`, wrap the DB call in
    `yield* Effect.promise(() => Database.use(async (tx) => { ... }))`.
  - Hash-dedupe 15-min window query: verify the `.all()` call now returns `Promise<T[]>` and
    is properly awaited.
  - FTS5 reindex block: audit for `await` yield points between dependent statements.
  - Update JSDoc if any sync-mode claims.

- [ ] **3.2** `packages/opencode/src/memory/embedding-backend.ts` (5 calls):
  - Convert to async.
  - **NOTE**: do NOT rewrite the SQL queries in this phase. That happens in Phase 4. Only
    convert the surrounding `Database.use` + Drizzle call-site patterns to async.

- [ ] **3.3** `packages/opencode/src/memory/working-memory.ts` (7 calls):
  - Convert to async, with scope precedence chain (thread > agent > project > user >
    global_pattern). Each scope lookup in the chain is a separate `Database.use`. Audit
    whether multiple chain lookups can be collapsed into a single query (optimization
    opportunity, not required).

- [ ] **3.4** `packages/opencode/src/memory/handoff.ts` (6 calls):
  - Convert to async. Fork context atomicity invariant must be preserved.

- [ ] **3.5** `packages/opencode/src/memory/session-memory.ts` (4 calls):
  - Convert to async.

- [ ] **3.6** `packages/opencode/src/memory/provider.ts`:
  - Any `Database.use` calls → async.
  - The already-async-(from `remove-semantic-recall-shim`) `Memory.indexArtifact` and
    `Memory.searchArtifacts` may need no changes beyond verifying they still compile.

- [ ] **3.7** `packages/opencode/src/tool/recall.ts` (2 calls):
  - Convert to async.

### 3B — Session subsystem (second highest density)

- [ ] **3.8** `packages/opencode/src/session/om/record.ts` (14 calls, **largest file**):
  - Convert to async. Audit OM atomicity: `seal()` state machine transitions, `addBufferSafe`
    merge logic, observed-ids merging.
  - **Critical concurrency check**: the seal state machine uses sequential operations that
    depend on each other's results. Every `await` point must be scrutinized.

- [ ] **3.9** `packages/opencode/src/session/message-v2.ts` (5 calls):
  - Convert to async.

- [ ] **3.10** `packages/opencode/src/session/index.ts` (5 calls):
  - Convert to async.

- [ ] **3.11** `packages/opencode/src/session/todo.ts` (2 calls):
  - Convert to async.

- [ ] **3.12** `packages/opencode/src/session/prompt.ts`:
  - `indexSessionArtifacts` was already made async in `remove-semantic-recall-shim` — verify
    it still compiles with the new `Database` signature.
  - Any other `Database.use` calls in the file → async.

### 3C — Project / workspace / permission / share / sync

- [ ] **3.13** `packages/opencode/src/project/project.ts` (5 calls) → async.
- [ ] **3.14** `packages/opencode/src/control-plane/workspace.ts` (5 calls) → async.
- [ ] **3.15** `packages/opencode/src/sync/index.ts` (5 calls) → async.
- [ ] **3.16** `packages/opencode/src/share/share-next.ts` (2 calls) → async.
- [ ] **3.17** `packages/opencode/src/permission/index.ts` (1 call) → async.
- [ ] **3.18** `packages/opencode/src/worktree/index.ts` (1 call) → async.
- [ ] **3.19** `packages/opencode/src/server/projectors.ts` (1 call) → async.

### 3D — Account / events / CLI

- [ ] **3.20** `packages/opencode/src/account/repo.ts` (4 calls) → async.
- [ ] **3.21** `packages/opencode/src/cli/cmd/import.ts` (3 calls) → async.
- [ ] **3.22** `packages/opencode/src/cli/cmd/stats.ts` (1 call) → async.
- [ ] **3.23** `packages/opencode/src/cli/cmd/db.ts`:
  - Replace `import { Database as BunDatabase } from "bun:sqlite"` with libSQL client.
  - Any direct SQL operations → async.
- [ ] **3.24** `packages/opencode/src/dream/daemon.ts` (1 call) → async.

### 3E — `json-migration.ts` rewrite (complex, dedicated task)

- [ ] **3.25** `packages/opencode/src/storage/json-migration.ts`:
  - Change imports: `bun:sqlite` → `@libsql/client` (`Client` type), `drizzle-orm/bun-sqlite` →
    `drizzle-orm/libsql`.
  - Change the function signature from `export async function run(sqlite: Database, options?)`
    to `export async function run(client: Client, options?)`.
  - Replace the `sqlite.exec("BEGIN TRANSACTION")` + loop-of-inserts + `sqlite.exec("COMMIT")`
    pattern with `await client.batch(batchItems, "write")`.
  - Build `batchItems` array by converting each Drizzle `insert(table).values(arr)` call to its
    SQL form via `.toSQL()` + args. Use `InValue[]` per libSQL batch API.
  - The progress callback `step(label, count)` must still fire after each batch to preserve
    UX.
  - The 4 PRAGMAs (`journal_mode`, `synchronous=OFF`, `cache_size=10000`, `temp_store=MEMORY`)
    become `await client.execute("PRAGMA ...")` at the top.
  - Update caller in `packages/opencode/test/storage/json-migration.test.ts` and any CLI
    entrypoint that constructs the bun:sqlite `Database` directly.

### 3F — Phase 3 verification

- [ ] **3.26** Run `bun run typecheck` from `packages/opencode`. Expected: **zero errors**.

- [ ] **3.27** Run `rg "Database\.use\(.*=>[^a]" packages/opencode/src` (callbacks without
      `async`). Every result must either:
  - Be genuinely async-compatible (callback body has no DB calls), or
  - Be updated to `async (tx) =>`.

- [ ] **3.28** Run `rg "\\.all\\(\\)[^\\s.]|\\.get\\(\\)[^\\s.]|\\.run\\(\\)[^\\s.]|\\.values\\(\\)[^\\s.]"
packages/opencode/src`. Every result should be `await ...` or inside a larger `.then()` chain.

- [ ] **3.29** Run `rg "NotPromise" packages/opencode/src` → zero matches.

- [ ] **3.30** Run all tests that do NOT touch vec0 (use a filter or temporary skip for the
      `memory-vec` test directory): `bun test --test-name-pattern "^(?!.*vec0)"`. Expected: all
      pass. Failures are bugs introduced by the async conversion — fix before proceeding.

**Exit criteria for Phase 3**:

- `bun run typecheck` is clean.
- All 90 `Database.use/transaction/effect` call-sites updated.
- All 202 Drizzle sync calls awaited.
- Non-vec tests pass.
- `NotPromise` helper deleted.

## Phase 4 — Vector search reimplementation (~1 day)

Goal: replace `vec0` virtual tables with `F32_BLOB(384)` columns, rewrite `embedding-backend.ts`
with libSQL native queries, delete sqlite-vec branches.

- [ ] **4.1** Create the new Drizzle custom type file
      `packages/opencode/src/memory/vector-type.ts` with the `f32blob(dim)` helper (per design D9).

- [ ] **4.2** Update `packages/opencode/src/memory/memory.sql.ts` (or whichever `.sql.ts` file
      defines `MemoryArtifactsTable`):
  - Import `f32blob` from `./vector-type`.
  - Add `embedding: f32blob(384)()` column to the `memory_artifacts` table definition.
  - If there is a `memory_session_vectors` equivalent real table (not the virtual one), do
    the same there.

- [ ] **4.3** Run `bun run db generate --name libsql_native_vectors`:
  - Inspect the generated migration SQL.
  - Expected content: `ALTER TABLE memory_artifacts ADD COLUMN embedding F32_BLOB(384)`.
  - **Prepend manually** to the migration file:
    ```sql
    DROP TABLE IF EXISTS memory_artifacts_vec;
    --> statement-breakpoint
    DROP TABLE IF EXISTS memory_session_vectors;
    --> statement-breakpoint
    ```
  - **Append manually**:
    ```sql
    --> statement-breakpoint
    CREATE INDEX IF NOT EXISTS memory_artifacts_embedding_idx
      ON memory_artifacts (libsql_vector_idx(embedding))
      WHERE deleted_at IS NULL;
    ```
  - If `memory_session_vectors` is also needed, add the same pattern for its parent table.

- [ ] **4.4** Rewrite `packages/opencode/src/memory/embedding-backend.ts`:
  - Remove all SQL that references `memory_artifacts_vec` or `memory_session_vectors` virtual
    tables.
  - Remove the JOIN-after-KNN pattern.
  - Implement `index(artifact)`: single Drizzle insert with the `embedding` column set to a
    `Float32Array` (customType handles serialization).
  - Implement `search(query, scopes, limit)` with a single raw SQL query using
    `drizzle-orm`'s `sql` template:
    ```typescript
    const queryVecText = JSON.stringify(Array.from(queryEmbedding))
    const rows = await db.all(sql`
      SELECT id, content, scope_type, scope_id,
             vector_distance_cos(embedding, vector32(${queryVecText})) AS dist
      FROM memory_artifacts
      WHERE embedding IS NOT NULL
        AND deleted_at IS NULL
        AND (${scopesWhereClause})
      ORDER BY dist ASC
      LIMIT ${limit}
    `)
    ```
  - Build `scopesWhereClause` from the input `scopes` array using Drizzle's `or(...)` +
    `and(...)` helpers to preserve type safety where possible.
  - Target line count: ~70–80 (down from ~148).

- [ ] **4.5** Delete the tombstoned `memory_session_vectors` backend code if it exists
      separately. Verify by `rg "memory_session_vectors" packages/opencode/src`.

- [ ] **4.6** Update `packages/opencode/src/memory/hybrid-backend.ts` if it references the
      KNN return type — the new return type from `embedding-backend.ts` includes the full row
      (id, content, scope, dist), not just `{id, distance}`.

- [ ] **4.7** Run the migrations end-to-end with a fresh DB:

  ```bash
  rm -f /tmp/lightcode-phase4.db*
  OPENCODE_DB=/tmp/lightcode-phase4.db bun run ./src/index.ts stats
  ```

  Expected: all 18 migrations (17 original + 1 new `libsql_native_vectors`) apply cleanly.
  **The `embedding-recall` migration is STILL in the journal** and still fails with
  `no such module: vec0`. Options:
  - **Option A** (preferred): delete the `embedding-recall` migration folder entirely. Its
    tables are immediately dropped by the new migration anyway, and removing it simplifies
    the journal.
  - **Option B**: mark the `embedding-recall` migration SQL as a no-op (`SELECT 1;`) so it
    runs without errors but does nothing. Keeps the journal contiguous for audit purposes.

  **Decision**: go with **Option A** — delete the entire `migration/20260408100000_embedding-recall/`
  directory. The new migration replaces it.

- [ ] **4.8** Verify on the fresh DB:

  ```bash
  sqlite3 /tmp/lightcode-phase4.db ".schema memory_artifacts" | grep embedding
  sqlite3 /tmp/lightcode-phase4.db ".indices memory_artifacts"
  ```

  Expected: `embedding F32_BLOB(384)` column and `memory_artifacts_embedding_idx` index listed.

- [ ] **4.9** Write a smoke-test script in `/tmp/phase4-smoke.ts` (not committed) that:
  - Opens the DB via the new `db.bun.ts`.
  - Inserts 5 artifacts with known distinct embeddings.
  - Runs a query against one of them and asserts the top-1 result is the exact match
    (distance ≈ 0).
  - Runs a scope-filtered query and asserts the filter excluded the non-matching scopes.
  - Deletes `/tmp/phase4-smoke.ts` once it passes.

**Exit criteria for Phase 4**:

- `memory_artifacts.embedding F32_BLOB(384)` column exists in fresh DBs.
- `libsql_vector_idx` index exists.
- `embedding-backend.ts` no longer references `vec0`, `memory_artifacts_vec`, `MATCH ?`, or
  the JOIN pattern.
- `rg "vec0|memory_artifacts_vec|memory_session_vectors" packages/opencode/src` returns only
  the new migration SQL (if at all) and zero source file matches.
- Smoke test roundtrip passes (insert + query returns correct top-1).

## Phase 5 — Build pipeline (2–3 hours)

Goal: update `script/build.ts` to apply `external` + sidecar copy for libSQL, validate
compiled binary runs end-to-end.

- [ ] **5.1** In `packages/opencode/script/build.ts`, add a helper function near the top:

  ```typescript
  function libsqlPlatformPkg(item: BuildTarget): string {
    // Map build targets to @libsql/<platform> package names
    const map: Record<string, string> = {
      "darwin-arm64": "darwin-arm64",
      "darwin-x64": "darwin-x64",
      "linux-arm64-gnu": "linux-arm64-gnu",
      "linux-arm64-musl": "linux-arm64-musl",
      "linux-x64-gnu": "linux-x64-gnu",
      "linux-x64-musl": "linux-x64-musl",
      "win32-x64": "win32-x64-msvc",
    }
    const key = item.abi ? `${item.os}-${item.arch}-${item.abi}` : `${item.os}-${item.arch}`
    const pkg = map[key] ?? map[`${item.os}-${item.arch}`]
    if (!pkg) throw new Error(`No @libsql package for target ${key}`)
    return pkg
  }
  ```

- [ ] **5.2** Update BOTH `Bun.build` calls in `build.ts` (the `lightcode` build at line ~208
      and the `lightcode-dream-daemon` build at line ~236):
  - Add an `external` array:
    ```typescript
    external: [
      "libsql",
      "@libsql/client",
      "@libsql/core",
      "@libsql/hrana-client",
      "@libsql/isomorphic-ws",
      "@libsql/" + libsqlPlatformPkg(item),
      "@neon-rs/load",
      "detect-libc",
      "promise-limit",
      "js-base64",
      "cross-fetch",
    ],
    ```
  - Verify `autoloadPackageJson: true` remains set (it already is).

- [ ] **5.3** After the `Bun.build` calls, add a sidecar copy step:

  ```typescript
  // Copy libSQL sidecar packages next to the binary
  const libsqlPlatform = libsqlPlatformPkg(item)
  const sidecarRoot = path.resolve(dir, `dist/${name}/bin/node_modules`)
  const monoRoot = path.resolve(dir, "../..")

  // Version resolved from package.json
  const libsqlVer = pkg.dependencies["@libsql/client"]?.replace(/^[~^]/, "") ?? "0.17.2"

  const copyPkg = (pkgName: string, installedDirName: string) => {
    const src = path.resolve(monoRoot, `node_modules/.bun/${installedDirName}/node_modules/${pkgName}`)
    if (!fs.existsSync(src)) {
      throw new Error(`sidecar source missing: ${src}`)
    }
    const destPkgDir = path.dirname(path.join(sidecarRoot, pkgName))
    fs.mkdirSync(destPkgDir, { recursive: true })
    fs.cpSync(src, path.join(sidecarRoot, pkgName), { recursive: true, dereference: true })
  }

  copyPkg("@libsql/client", `@libsql+client@${libsqlVer}`)
  copyPkg("@libsql/core", `@libsql+core@${libsqlVer}`)
  copyPkg("@libsql/hrana-client" /* version */)
  copyPkg("@libsql/isomorphic-ws" /* version */)
  copyPkg(`@libsql/${libsqlPlatform}` /* version — platform-specific */)
  copyPkg("libsql" /* version */)
  copyPkg("@neon-rs/load" /* version */)
  copyPkg("detect-libc" /* version */)
  copyPkg("promise-limit" /* version */)
  copyPkg("js-base64" /* version */)
  copyPkg("cross-fetch" /* version */)

  console.log(`  → sidecar: copied libSQL (${libsqlPlatform}) + 10 deps`)
  ```

  - **NOTE**: the exact `installedDirName` format in `node_modules/.bun/` depends on Bun's
    hoisting. Inspect `ls node_modules/.bun/ | grep libsql` during implementation and hardcode
    the correct pattern. Bun typically uses `pkg@version` or `pkg-version` format.

- [ ] **5.4** Run a full cross-compile: `bun run build` (no `--single`). Expected: all 12
      targets produce binaries + `dist/<target>/bin/node_modules/` sidecars.

- [ ] **5.5** Build a single target for the host platform: `bun run build --single`. Expected:
  - Smoke test (`./dist/<target>/bin/lightcode --version`) passes.

- [ ] **5.6** Run the compiled binary end-to-end from a DIFFERENT directory (validates D8):

  ```bash
  mkdir /tmp/lightcode-bin-test && cd /tmp/lightcode-bin-test
  OPENCODE_DB=test.db /Users/dev/lightcodev2/packages/opencode/dist/opencode-darwin-arm64/bin/lightcode stats
  ```

  - If D8 (`Module.globalPaths`) works: the binary opens the DB, runs migrations, prints
    stats.
  - If it crashes with `Cannot find module '@libsql/client'`: D8 failed, fall back to a shell
    wrapper approach documented in design.md D8.

- [ ] **5.7** Verify vec0 is NOT loaded anywhere in the new binary:

  ```bash
  ./dist/<target>/bin/lightcode stats
  sqlite3 /tmp/lightcode-bin-test/test.db ".tables" | tr ' ' '\n' | grep -i vec
  ```

  Expected: zero matches. The only vector-related table is `memory_artifacts` with its
  `embedding` column.

- [ ] **5.8** Verify the new index is present:
  ```bash
  sqlite3 /tmp/lightcode-bin-test/test.db ".indices" | grep embedding
  ```
  Expected: `memory_artifacts_embedding_idx`.

**Exit criteria for Phase 5**:

- `bun run build --single` passes smoke test.
- Compiled binary runs from an arbitrary CWD and opens the DB successfully.
- `memory_artifacts.embedding` column created in the compiled-binary DB.
- No `vec0` references in the compiled binary's DB schema.
- Sidecar node_modules are ~9 MB per target.

## Phase 6 — Tests + docs + sanity (2 days)

Goal: all tests pass, docs updated, AGENTS.md updated, full regression suite green.

### 6A — Test migration

- [ ] **6.1** `packages/opencode/test/storage/json-migration.test.ts`:
  - Replace `new Database(":memory:")` with `createClient({ url: ":memory:" })`.
  - Replace `drizzle-orm/bun-sqlite` imports with `drizzle-orm/libsql`.
  - Convert test bodies to async.
  - Verify all assertions still pass.

- [ ] **6.2** `packages/opencode/test/memory/memory-core.test.ts` and related:
  - Audit each `Database.use` call — they now return Promises and must be awaited.
  - Convert test body functions to async where needed.

- [ ] **6.3** `packages/opencode/test/memory-vec/**`:
  - Full rewrite of the test setup to use `F32_BLOB(384)` column schema instead of `vec0`
    virtual table.
  - Any `CREATE VIRTUAL TABLE ... USING vec0` statements → `ALTER TABLE ... ADD COLUMN
embedding F32_BLOB(384)` + `CREATE INDEX ... libsql_vector_idx(embedding)`.
  - KNN queries → `vector_top_k` or `vector_distance_cos`.
  - Keep all test assertions (they test correctness, not implementation).

- [ ] **6.4** `packages/opencode/test/session/**`, `test/dream/**`, `test/om/**`, `test/sync/**`:
  - Audit for any `Database.use` call that was previously sync.
  - Apply the same async conversion pattern as production code.

- [ ] **6.5** Run `bun test` from `packages/opencode`. Expected: **all tests pass**. Any
      failure is a bug introduced by this change — fix before proceeding.

- [ ] **6.6** Run a targeted set of the highest-criticality tests multiple times (5x) to
      detect concurrency flakes:
  - `test/memory/memory-core-production.test.ts` (WM precedence, ctx.blocks ordering,
    permission gate)
  - `test/session/om/record.test.ts` (OM atomicity)
  - `test/storage/json-migration.test.ts` (bulk migration)

### 6B — Documentation

- [ ] **6.7** Update `packages/opencode/AGENTS.md`:
  - **Database section**: remove sync claims. Document that `Database.Client` is an
    `Effect.cached` and `Database.use/transaction/effect` are async.
  - **New section**: "Sidecar native deps" describing the `external` + sidecar copy pattern
    for future native deps.
  - **Effect rules**: confirm no new rules needed beyond what already exists.

- [ ] **6.8** Update `README.md`:
  - Tech stack mention of libSQL + vector search.
  - Install instructions note: tarball contains `lightcode` binary + `node_modules/` sidecar,
    must be extracted together.

- [ ] **6.9** Update `docs/feature-catalog.md`:
  - Storage layer description references libSQL instead of sqlite-vec.

- [ ] **6.10** Update `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`:
  - Section on storage layer.
  - Update any embedded diagrams that show `vec0` virtual tables.

- [ ] **6.11** Update `docs/autodream-architecture.md`:
  - Storage references.

- [ ] **6.12** Update `docs/SUPERSEDED.md`:
  - Add entry: `sqlite-vec` (superseded by libSQL native vectors in `migrate-storage-to-libsql-async`).

- [ ] **6.13** Create `docs/LIBSQL_MIGRATION_NOTES.md`:
  - Title: "libSQL Storage Migration Notes"
  - Sections:
    1. **Why libSQL**: brief architecture rationale (sync engine path, Escenario B/C).
    2. **The sidecar pattern**: why native deps need `--external` + `node_modules/` adjacent.
    3. **Async Database API**: `Database.use(async (tx) => ...)` is the new pattern.
    4. **Vector queries**: `vector_top_k` vs `vector_distance_cos`, when to use each.
    5. **Adding a future native dep**: checklist for the `build.ts` sidecar step.
    6. **Rollback**: how to revert to `bun:sqlite` if needed.
    7. **Known caveats**: CWD-relative binary resolution (D8), intMode="number" (Q3), etc.

### 6C — Final sanity grep sweep

- [ ] **6.14** `rg "bun:sqlite" packages/opencode` → zero matches.
- [ ] **6.15** `rg "drizzle-orm/bun-sqlite" packages/opencode` → zero matches.
- [ ] **6.16** `rg "sqlite-vec|sqliteVec" packages/opencode` → zero matches.
- [ ] **6.17** `rg "vec0|memory_artifacts_vec|memory_session_vectors" packages/opencode/src` → zero matches.
- [ ] **6.18** `rg "NotPromise" packages/opencode` → zero matches.
- [ ] **6.19** `rg "SemanticRecall" packages/opencode/src packages/opencode/test` → zero matches (should already be zero from `remove-semantic-recall-shim`).
- [ ] **6.20** `rg "enableExtensions" packages/opencode` → zero matches.
- [ ] **6.21** `rg "setCustomSQLite" packages/opencode` → zero matches.

### 6D — Final test + build verification

- [ ] **6.22** From `packages/opencode`:
  - `bun run typecheck` → passes.
  - `bun test` → all pass.
  - `bun run build --single` → passes + smoke test.
  - Compiled binary invoked from `/tmp/different-cwd/` opens DB, runs migrations, performs
    a vector insert + query roundtrip without errors.

- [ ] **6.23** Update the openspec change metadata if needed.

**Exit criteria for Phase 6 (= exit for the whole change)**:

- All grep sanity checks return zero matches.
- `bun run typecheck` clean.
- `bun test` all green.
- `bun run build --single` produces a working binary.
- Compiled binary validates the full end-to-end flow: migrate → insert artifact with
  embedding → semantic search → results returned via `vector_distance_cos`.
- All docs updated.
- `docs/LIBSQL_MIGRATION_NOTES.md` exists with the 7 sections listed.

## Post-merge follow-ups (out of scope for this change, track separately)

- Archive this change via `sdd-archive` workflow.
- Archive the related precursor changes: `embedding-recall`, `fix-sqlite-vec-bundling`,
  `remove-semantic-recall-shim` (all superseded by this migration).
- Create a new change `enable-libsql-embedded-replicas` that wires `syncUrl:` for Escenario B.
- Monitor the compiled binary's behavior in user reports for 1 week before recommending the
  release to wider audiences.
