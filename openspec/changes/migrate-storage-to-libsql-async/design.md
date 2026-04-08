# Design — Migrate Storage to libSQL with Async Refactor

## Context

Lightcode's storage layer today uses `bun:sqlite` (the Bun-native SQLite driver), wrapped by
`drizzle-orm/bun-sqlite`, with `sqlite-vec` loaded as a runtime extension to provide vector
search. This stack works in `bun run dev` mode but fails in `bun build --compile` mode because
`sqlite-vec` uses `import.meta.resolve()` to locate its native `.dylib` / `.so` / `.dll` file,
and Bun's single-binary `$bunfs` virtual filesystem does not contain native assets. Every shipped
binary since the `embedding-recall` change is dead on first DB open.

Three paths were considered:

1. **Fix `sqlite-vec` bundling via `--external` + sidecar** (validated by POC 1, ~2h work). Fast
   fix. Does not unblock Escenario B/C (sync engine).
2. **Replace `sqlite-vec` with JS cosine over `BLOB` columns** (~3-4h work). Simple. Works with
   `bun --compile` out of the box. Does not unblock Escenario B/C either.
3. **Migrate the entire storage layer to libSQL** (this change). Unblocks the binary AND lays
   the foundation for Escenario B (embedded replicas) and Escenario C (Turso multi-tenant
   cloud) with zero additional storage work later. Requires an async-wide refactor of
   `Database` namespace and its 90+ call-sites.

The user explicitly chose path 3 based on the directive "hacer el trabajo una sola vez". This
change implements that choice.

## Non-Goals

- Enabling sync-engine features. `createClient({ url: "file:lightcode.db" })` only — no
  `syncUrl`, no `authToken`, no Turso Cloud wiring. That is Escenario B / C, separate changes.
- Changing the shape or semantics of `Memory.buildContext()`, `MemoryContext`, `PromptBlock`,
  or any memory API consumed by the TUI / CLI / tools.
- Changing FTS5 usage. `memory_artifacts_fts*` stays exactly as it is — libSQL inherits
  SQLite's FTS5 support natively.
- Archiving prior changes (`embedding-recall`, `fix-sqlite-vec-bundling`,
  `remove-semantic-recall-shim`). Those are separate archive steps after this ships.
- Adding encryption, observability, backup, or multi-tenant features. Pure single-DB local for
  now.
- Removing or refactoring any test coverage that is not directly tied to the storage driver.

## Investigation Summary

### POC 3 — Empirical validation of 5 blockers (executed Apr 8, 2026)

Results: **23/23 explicit tests passed + 16/17 real migrations replayed + sidecar binary
portable across directories**. Full evidence persisted in Engram under topic
`architecture/libsql-poc-validation`. Summary below, with line-level pointers for verification.

#### Blocker #1 — Native vector search parity with `sqlite-vec`

| Capability                                             | Verdict   | Evidence                                                                                                                               |
| ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `F32_BLOB(384)` column creation                        | ✅ passes | POC 3 test 1.1                                                                                                                         |
| `CREATE INDEX ... libsql_vector_idx(embedding)`        | ✅ passes | POC 3 test 1.2                                                                                                                         |
| `INSERT ... VALUES (..., vector32('[...]'))` text form | ✅ passes | POC 3 test 1.3 (batch of 4 inserts)                                                                                                    |
| `SELECT ... FROM vector_top_k('idx', vector32(?), K)`  | ✅ passes | POC 3 test 1.4 returned 3 rows                                                                                                         |
| `vector_distance_cos(embedding, vector32(?))`          | ✅ passes | POC 3 test 1.5 returned cosine distance values: `a1=−1.8e-8`, `a2=0.165`, `a3=0.288` (correct: `a1` is the query vector, distance ≈ 0) |
| **Pre-filter by scope in the same query as KNN** ⭐    | ✅ passes | POC 3 test 1.6: `WHERE scope_type='project' AND scope_id='p1' ORDER BY vector_distance_cos(...)` returned exactly 2 rows (`a1`, `a2`)  |

The pre-filter-in-same-query capability is the critical improvement over `sqlite-vec`. With
sqlite-vec, you KNN first against the virtual table, then JOIN to `memory_artifacts` to filter
by scope — so the top-K might not contain the rows you actually want. With libSQL, the filter
is part of the same query, so `LIMIT 5` returns the top 5 **within the correct scope**.

#### Blocker #2 — PRAGMAs, transactions, `:memory:` support

| Capability                             | Verdict   | Evidence                                                   |
| -------------------------------------- | --------- | ---------------------------------------------------------- |
| `PRAGMA journal_mode = WAL`            | ✅ passes | POC 3 test 2.1, returned `journal_mode: "wal"`             |
| `PRAGMA busy_timeout = 5000`           | ✅ passes | POC 3 test 2.2                                             |
| `PRAGMA foreign_keys = ON`             | ✅ passes | POC 3 test 2.3                                             |
| `PRAGMA wal_checkpoint(PASSIVE)`       | ✅ passes | POC 3 test 2.4, returned `{busy:0, log:0, checkpointed:0}` |
| `PRAGMA cache_size = -64000`           | ✅ passes | POC 3 test 2.5                                             |
| `PRAGMA synchronous = NORMAL`          | ✅ passes | POC 3 test 2.6                                             |
| `client.transaction("write")` + commit | ✅ passes | POC 3 test 2.7                                             |
| Transaction rollback                   | ✅ passes | POC 3 test 2.8 (insert rolled back, row count == 0)        |
| `createClient({ url: ":memory:" })`    | ✅ passes | POC 3 test 2.9                                             |
| `client.batch([...], "read")`          | ✅ passes | POC 3 test 2.10                                            |

**All 6 PRAGMAs currently used in `db.ts` (lines 90–95) and the 4 additional PRAGMAs in
`json-migration.ts` (lines 49–52) work identically.**

Transaction behaviors: libSQL uses `"write"`, `"read"`, `"deferred"` as the three modes, not
the bun:sqlite `deferred/immediate/exclusive`. Mapping is: `immediate` and `exclusive` both map
to `"write"` in libSQL (both acquire the write lock at transaction start). `deferred` maps
directly to `"deferred"`. No caller in the current codebase uses `exclusive` specifically,
confirmed by grep in Phase 3 planning.

#### Blocker #3 — `drizzle-orm/libsql` + schema + real migrations

| Capability                                                  | Verdict         | Evidence                                                                                                                           |
| ----------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle(client)` wraps `@libsql/client`                    | ✅ passes       | POC 3 test 3.1                                                                                                                     |
| `sqliteTable` + `text()` + `integer()` snake-case schema    | ✅ passes       | POC 3 tests 3.2/3.3                                                                                                                |
| `db.select().from(x).limit(5)` returns `Promise<T[]>`       | ✅ passes       | POC 3 test 3.3, returned 5 rows                                                                                                    |
| `db.insert(x).values({...})` returns `Promise`              | ✅ passes       | POC 3 test 3.4                                                                                                                     |
| `db.all(sql\`...\`)` template literal with vector functions | ✅ passes       | POC 3 test 3.5                                                                                                                     |
| **All 17 existing lightcode migrations replayed on libSQL** | ✅ 16/17 passes | `20260408100000_embedding-recall` fails with `no such module: vec0` — **this is expected and is exactly the migration we replace** |

The 16 passing migrations created 25 tables including all the FTS5 shadow tables
(`memory_artifacts_fts*`), confirming FTS5 works identically. The list of created tables:
`account`, `account_state`, `control_account`, `event`, `event_sequence`, `memory_agent_handoffs`,
`memory_artifacts`, `memory_artifacts_fts`, `memory_artifacts_fts_config`, `memory_artifacts_fts_data`,
`memory_artifacts_fts_docsize`, `memory_artifacts_fts_idx`, `memory_fork_contexts`, `memory_links`,
`memory_working`, `message`, `part`, `permission`, `project`, `session`, `session_observation`,
`session_observation_buffer`, `session_share`, `todo`, `workspace`.

#### Blocker #4 — Drizzle `customType<F32_BLOB(384)>`

| Capability                                                              | Verdict   | Evidence       |
| ----------------------------------------------------------------------- | --------- | -------------- |
| `customType<Float32Array, Buffer>` declaration with `dataType()`        | ✅ passes | POC 3 test 4.1 |
| Drizzle insert with `Float32Array` via `toDriver: Buffer.from(.buffer)` | ✅ passes | POC 3 test 4.2 |
| Raw SQL with `vector32(JSON.stringify([...]))` text form                | ✅ passes | POC 3 test 4.3 |

Both serialization paths work. The raw `vector32()` text form is what POC 3 validated
end-to-end for the KNN queries, so `embedding-backend.ts` will use that pattern for vector
queries specifically. CRUD through Drizzle uses the `customType` pattern for type safety.

#### Blocker #5 — `bun build --compile` + sidecar + portability

1. **Compile**: `bun build poc.ts --compile --external libsql --external @libsql/client
--external @libsql/darwin-arm64 --compile-autoload-package-json --outfile compile-out`
   compiled successfully. `autoloadPackageJson: true` is mandatory for `--external` resolution.
2. **Without sidecar**: `./compile-out` crashed with
   `Cannot find module '@libsql/client' from '/$bunfs/root/compile-out'` — expected.
3. **With sidecar**: after copying 11 transitive packages to adjacent `node_modules/`, the
   binary ran and completed successfully: `OK: 2 rows` + `VECTOR OK: id=v1 dist=−1.99e-8`.
4. **Portability**: the entire directory (`compile-out` + `node_modules/`) was moved to a
   different absolute path (`/tmp/sidecar-test2/`) and ran identically. Nothing in the binary
   hardcodes install location.

**Transitive dependency tree of the libSQL sidecar** (discovered empirically by iterating
`Cannot find package X` errors until clean run):

```
node_modules/
├── @libsql/
│   ├── client/              ← main, entry
│   ├── core/                ← dep of client
│   ├── hrana-client/        ← dep of client, uses cross-fetch
│   ├── isomorphic-ws/       ← dep of hrana-client
│   └── darwin-arm64/        ← native .node (7.8 MB), platform-specific
├── @neon-rs/
│   └── load/                ← dep of libsql, resolves native binding
├── libsql/                  ← native wrapper, optionalDependencies include @libsql/<platform>
├── promise-limit/           ← transitive dep of @libsql/client
├── js-base64/               ← transitive dep
├── cross-fetch/             ← transitive dep of hrana-client
└── detect-libc/             ← transitive dep of libsql
```

Total: 11 packages, 9.0 MB on disk (7.8 MB is the native `.node` binding, the rest is ~1.2 MB
of JavaScript wrapper code).

**Version pins at the time of POC 3**: `@libsql/client@0.17.2`, `drizzle-orm@0.45.2`,
`@libsql/darwin-arm64@0.4.x`, `bun@1.3.11`.

### Current codebase — sync `Database` surface measurement

Exact counts from `rg` on `packages/opencode/src`:

| Pattern                                                   | Occurrences | Files affected |
| --------------------------------------------------------- | ----------- | -------------- |
| `Database.use \| Database.transaction \| Database.effect` | 90          | **21**         |
| `.all() \| .get() \| .run() \| .values()` (Drizzle sync)  | 202         | **73**         |
| `new Database(...)` from `bun:sqlite`                     | 3           | 3              |
| `drizzle-orm/bun-sqlite` imports                          | 6           | 4              |

The 21 files using `Database.use/transaction/effect`, sorted by call count:

```
src/session/om/record.ts             14
src/memory/fts5-backend.ts           11
src/memory/working-memory.ts          7
src/memory/handoff.ts                 6
src/sync/index.ts                     5
src/session/message-v2.ts             5
src/session/index.ts                  5
src/project/project.ts                5
src/memory/embedding-backend.ts       5
src/control-plane/workspace.ts        5
src/memory/session-memory.ts          4
src/account/repo.ts                   4
src/cli/cmd/import.ts                 3
src/tool/recall.ts                    2
src/share/share-next.ts               2
src/session/todo.ts                   2
src/worktree/index.ts                 1
src/server/projectors.ts              1
src/permission/index.ts               1
src/dream/daemon.ts                   1
src/cli/cmd/stats.ts                  1
```

### PRAGMAs in the current codebase

From `rg "PRAGMA"`:

**`src/storage/db.ts` lines 90–95** (run on first `Database.Client()` lazy init):

```sql
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
PRAGMA cache_size = -64000
PRAGMA foreign_keys = ON
PRAGMA wal_checkpoint(PASSIVE)
```

**`src/storage/json-migration.ts` lines 49–52** (run on the bulk JSON → SQLite migration):

```sql
PRAGMA journal_mode = WAL
PRAGMA synchronous = OFF
PRAGMA cache_size = 10000
PRAGMA temp_store = MEMORY
```

All 10 PRAGMAs are validated to work on libSQL (POC 3 Blocker #2 covers the 6 main ones;
`synchronous = OFF`, `cache_size = 10000` and `temp_store = MEMORY` are standard SQLite
PRAGMAs that libSQL inherits).

### Current `Database` namespace surface (from `src/storage/db.ts`)

```typescript
// Type — currently sync
export type Transaction = SQLiteTransaction<"sync", void>
type DbClient = SQLiteBunDatabase

// Lazy sync init
export const Client = lazy(() => {
  const db = init(Path)
  db.run("PRAGMA journal_mode = WAL")
  // ... 5 more PRAGMAs
  migrate(db, entries)
  return db
})

// Sync close
export function close() {
  Client().$client.close()
  Client.reset()
}

// Sync use/transaction/effect
export type TxOrDb = Transaction | DbClient
type NotPromise<T> = T extends Promise<any> ? never : T

export function use<T>(callback: (trx: TxOrDb) => T): T {
  /* sync */
}
export function effect(fn: () => any | Promise<any>) {
  /* ctx-tracked */
}
export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>, // ← explicitly forbids async
  options?: { behavior?: "deferred" | "immediate" | "exclusive" },
): NotPromise<T> {
  /* sync */
}
```

The `NotPromise<T>` type helper is a DELIBERATE guard inserted by a prior author to prevent
async transaction callbacks. It must be removed in this change, and every call-site has to
adapt.

## Decisions

### D1 — Use `@libsql/client` + `drizzle-orm/libsql`, NOT `better-sqlite3`

**Decision**: Migrate to `@libsql/client` as the sole database client, wrapped by
`drizzle-orm/libsql`.

**Alternatives considered**:

- **`better-sqlite3`**: is sync (like `bun:sqlite`), would avoid the async refactor. Rejected
  because it does NOT include the libSQL sync engine (it is a Node.js native binding for
  vanilla SQLite). It would not unblock Escenario B/C. It would also require its own native
  binding to work with `bun --compile` via sidecar (same amount of build pipeline work).
  Zero upside over `bun:sqlite` except being Node-compatible.
- **Keep `bun:sqlite` with sqlite-vec sidecar fix** (POC 1 validated). Rejected because it
  does not unblock Escenario B/C. Would require full rewrite later.
- **JS cosine over BLOB**: simple but same Escenario B/C limitation.

**Why libSQL wins**: the only option that covers local-today + sync-tomorrow + cloud-in-2-years
with **zero additional storage refactoring**. See POC 3 Blocker #3 for validation that
`drizzle-orm/libsql` wraps `@libsql/client` cleanly.

### D2 — Accept the async-wide refactor as a one-time cost

**Decision**: Convert the entire `Database` namespace and its 90+ call-sites from sync to
async in a single atomic change.

**Why**: `drizzle-orm/libsql` is `async`-only (`extends BaseSQLiteDatabase<'async', ResultSet,
TSchema>`, verified in drizzle-orm source). There is no sync adapter for libSQL. The only way
to use libSQL is async. Therefore the refactor is a prerequisite, not an option.

**Alternatives rejected**:

- **Partial migration**: keep some `Database` calls sync and some async. Rejected because the
  `Client` lazy init itself must become async, and every downstream consumer would need both
  sync and async variants. Dual-maintenance nightmare.
- **Wrapper that fakes sync over async**: would require blocking the event loop inside the
  Bun process, unsafe, loses the benefit of async I/O, defeats the point.

### D3 — `Database.Client` becomes an `Effect.cached` async initializer

**Decision**: Replace `lazy(() => sync)` with `Effect.cached(Effect.gen(function*(){...}))`
following the pattern documented in `packages/opencode/AGENTS.md` under "Effect.cached for
deduplication". The cached effect runs init + PRAGMAs + migrations exactly once across all
concurrent callers.

**Why**:

- The AGENTS.md explicitly recommends `Effect.cached` for exactly this deduplication pattern.
- `lazy()` is sync and cannot host `await` calls. Can't reuse.
- Every call-site already goes through `Database.use/transaction/effect`, which will be
  async, so `Client` being a cached `Effect<...>` composes naturally via `yield*`.

**Alternatives rejected**:

- **Top-level `await` at module load**: unreliable in Bun / Vite / test runners, causes import
  ordering issues, breaks `bun run dev` hot reload.
- **A `Promise` wrapped in `lazy()`**: every caller would have to `await Client()`, but
  `Database.use` currently passes `Client()` directly as `tx`. The `lazy()` would have to
  become an async getter, which complicates every call-site.

### D4 — `Database.use/transaction/effect` become `async` returning `Promise<T>`

**Decision**: All three functions accept async callbacks and return `Promise<T>`. The
`NotPromise<T>` type guard is deleted. Callers adapt.

**Why**: `@libsql/client` transaction API (`client.transaction("write") → LibsqlTransaction`)
is async. The callback inside `Database.transaction` must be able to `await` transaction
operations. Forcing callbacks to be sync is impossible with the libSQL API.

**Concurrency note**: every `await` inside a `Database.transaction` callback is a yield point
where another fiber/promise may interleave. Callers must NOT rely on synchronous ordering of
multiple operations inside the same transaction unless they explicitly `await` each step.
Phase 3 includes a concurrency audit of every non-trivial transaction body.

### D5 — `Database.transaction` behavior modes map to libSQL's 3 modes

**Decision**: Map the existing `{behavior?: "deferred" | "immediate" | "exclusive"}` option
to libSQL's `transaction(mode: "write" | "read" | "deferred")` as follows:

| bun:sqlite behavior | libSQL mode  | Rationale                                                                                       |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `undefined`         | `"write"`    | Current default behavior — transactions write, take write lock at commit time                   |
| `"deferred"`        | `"deferred"` | Direct equivalent — lock acquired lazily                                                        |
| `"immediate"`       | `"write"`    | libSQL write mode acquires write lock at transaction start, same semantics                      |
| `"exclusive"`       | `"write"`    | libSQL does not distinguish exclusive from write; acceptable because no caller uses `exclusive` |

**Grep verification** (run during Phase 3): `rg "exclusive" packages/opencode/src/**/*.ts` must
return zero results for `Database.transaction` callers. If any caller does use `exclusive`,
flag it in the change log and revisit.

### D6 — Vector search: replace `vec0` virtual tables with `F32_BLOB(384)` columns on real tables

**Decision**: Drop `memory_artifacts_vec` and `memory_session_vectors` virtual tables. Add
`embedding F32_BLOB(384)` columns directly to the corresponding real tables (`memory_artifacts`
and whatever the session vector parent is). Create `libsql_vector_idx` indexes with a
`WHERE deleted_at IS NULL` partial condition.

**New migration SQL skeleton** (indicative, final form in Phase 4):

```sql
DROP TABLE IF EXISTS memory_artifacts_vec;
DROP TABLE IF EXISTS memory_session_vectors;
ALTER TABLE memory_artifacts ADD COLUMN embedding F32_BLOB(384);
CREATE INDEX memory_artifacts_embedding_idx
  ON memory_artifacts (libsql_vector_idx(embedding))
  WHERE deleted_at IS NULL;
-- (session vectors column + index similarly)
```

**Why**:

- Eliminates the 2-statement write pattern (insert metadata → insert vector by ID) and replaces
  it with a single `INSERT` that includes the embedding.
- Eliminates the JOIN-after-KNN pattern: queries can `WHERE scope_type AND scope_id ORDER BY
vector_distance_cos(...) LIMIT N` in one statement. Validated by POC 3 test 1.6.
- Lets `embedding-backend.ts` shrink from ~148 lines (current) to ~70–80 lines.
- Simplifies schema: one fewer virtual table to understand, one fewer set of shadow tables in
  `sqlite_master`.

**Data loss risk**: the drop removes all existing embedding vectors. This is acceptable because:

1. The embedding bug from `remove-semantic-recall-shim` meant vectors were rarely populated in
   practice (writes bypassed `EmbeddingBackend`).
2. Vectors are derived data — they are recomputed on next index operation from the raw
   artifact content.
3. A one-time reindex loop in the migration could be added later if needed, but is explicitly
   out of scope.

### D7 — `--external` + sidecar `node_modules/` adjacent to binary

**Decision**: Pass `external: ["libsql", "@libsql/client", "@libsql/darwin-arm64", ...]` to
`Bun.build()` with `autoloadPackageJson: true`. After the build, copy the 11 libSQL packages
from `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/` into `dist/<target>/bin/node_modules/`.
At runtime, Bun resolves the external imports against the adjacent `node_modules/` directory.

**Evidence**: POC 3 Blocker #5 validated the full pipeline end-to-end with portability tests.

**Trade-off**: the binary MUST be invoked from its own directory (`cd /usr/local/bin &&
./lightcode ...`) or the resolution fails. This is a caveat from POC 1 (sqlite-vec) and POC 3
(libSQL) both. Mitigation: see D8.

**Alternatives rejected**:

- **Embed `.node` bytes via `with { type: "file" }` + runtime extract to `~/.cache/`**.
  Works but is more code, has cache invalidation concerns, introduces startup latency for
  file copy + chmod + hash, and requires a fallback when `$HOME` is read-only.
- **`better-sqlite3`**: same sidecar requirement (see D1).
- **Static linking libsql into the Bun runtime**: would require a custom Bun build, not
  feasible.

### D8 — Handle non-adjacent `cwd` via `Module.globalPaths` at entrypoint

**Decision**: At the very top of `packages/opencode/src/index.ts` (before any libSQL import),
prepend the binary's directory `node_modules/` to `Module.globalPaths`:

```typescript
import { Module } from "module"
import { dirname, join } from "path"
if (typeof process.execPath === "string" && process.execPath.endsWith("lightcode")) {
  Module.globalPaths.unshift(join(dirname(process.execPath), "node_modules"))
}
```

**Why**: users launch `lightcode` from arbitrary CWDs via `$PATH`. Without this, the binary
only works when run from its own directory (the `cd /usr/local/bin && ./lightcode` pattern).
Adding `node_modules/` to `Module.globalPaths` makes Bun/Node resolution find the sidecar
regardless of CWD.

**Validation approach**: Phase 5 includes a smoke test that runs the binary from `/tmp` (NOT
its own directory) and verifies it opens the DB correctly.

**Fallback if this doesn't work**: ship a shell wrapper script `lightcode` that does
`cd "$(dirname "$(readlink -f "$0")")" && exec ./lightcode-bin "$@"`, renaming the actual
binary to `lightcode-bin`. Documented here so the solution is not lost if D8 fails in
implementation.

### D9 — Drizzle `customType` for `F32_BLOB(384)` in schema files

**Decision**: Declare a shared `f32blob` helper in a new file (e.g.
`packages/opencode/src/memory/vector-type.ts`):

```typescript
import { customType } from "drizzle-orm/sqlite-core"

export const f32blob = (dim: number) =>
  customType<{ data: Float32Array; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dim})`
    },
    toDriver(value: Float32Array): Buffer {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    },
    fromDriver(value: Buffer): Float32Array {
      return new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4)
    },
  })
```

Then in `memory/memory.sql.ts`:

```typescript
import { f32blob } from "./vector-type"
export const MemoryArtifactsTable = sqliteTable("memory_artifacts", {
  // ... existing columns
  embedding: f32blob(384)(),
})
```

**Why**:

- Drizzle's `customType` is the first-class way to add non-standard column types.
- Single source of truth for the dimension constant.
- Type-safe CRUD: TypeScript sees `Float32Array`, not opaque `Buffer`.
- POC 3 test 4.1 and 4.2 validated both the `dataType()` string and the `toDriver`/`fromDriver`
  serialization paths.

**Caveat**: For raw KNN queries (`SELECT ... vector_distance_cos(embedding, vector32(?))`),
we still use `vector32('[...]')` text form for the query-side vector because that is the
idiomatic libSQL syntax. The `customType` handles the column-side serialization.

### D10 — `lightcode.db` path stays the same, no rename

**Decision**: Keep the DB path exactly as it is today (`Global.Path.data/lightcode.db` and
`lightcode-<channel>.db`). Do NOT rename to `lightcode.libsql` or anything else.

**Why**:

- libSQL files are 100% backward-compatible with SQLite (libsql IS a SQLite fork). The file
  format is unchanged.
- Renaming would break existing users' data or require a migration script.
- The `.db` extension is accurate.
- POC 3 confirmed that libSQL opens a libSQL-created `.db` file AND can open SQLite-created
  files (we opened bun:sqlite files with libsql-client and vice versa in testing).

### D11 — `json-migration.ts` bulk-insert transaction becomes async-batched

**Decision**: Rewrite `JsonMigration.run()` to use `client.batch([...], "write")` for bulk
inserts instead of `sqlite.exec("BEGIN TRANSACTION") + db.insert().values().run() +
sqlite.exec("COMMIT")`. The new structure:

```typescript
const batches: string[] = [] // or BatchItem[]
for (const row of rows) batches.push(/* batch item */)
await client.batch(batches, "write") // atomic transaction + rollback on error
```

**Why**:

- libSQL does not expose raw `BEGIN TRANSACTION` / `COMMIT` via a fluent transaction API in
  the same way. `client.batch(...)` is the idiomatic way to do bulk atomic writes.
- `batch` is atomic: all succeed or all rollback. Same guarantee as the current `BEGIN/COMMIT`.
- Simpler code, less manual transaction management.

**Note**: the current `json-migration.ts` uses `db.insert(table).values(arr).onConflictDoNothing().run()`.
The Drizzle async API for this is the same but with `await` and returns a Promise. We'll use
the Drizzle fluent API for ergonomic builders, wrapped inside a `client.batch` for atomicity
— Drizzle's `.toSQL()` lets us build the SQL + args and hand them to `batch`.

### D12 — Keep `FTS5` unchanged

**Decision**: `memory_artifacts_fts` and its `_config`/`_data`/`_docsize`/`_idx` shadow tables
stay exactly as they are. FTS5 queries in `fts5-backend.ts` only need the async/`await`
refactor — no SQL changes.

**Why**: libSQL inherits FTS5 from SQLite upstream. POC 3 Blocker #3 confirmed FTS5 tables
are created and populated correctly by the existing migrations.

## Data Flow

### Before (sync + sqlite-vec + virtual tables)

```
Caller
  ↓ (sync)
Database.use((tx) => {
  tx.insert(memory_artifacts).values({...}).run()             // 1 sync stmt
  tx.run(`INSERT INTO memory_artifacts_vec VALUES (?, ?)`)    // 2 sync stmt
})
  ↓
bun:sqlite → sqlite-vec extension → disk

Read path (KNN):
  tx.run(`SELECT artifact_id FROM memory_artifacts_vec WHERE embedding MATCH ? AND k=?`)
    → returns [id, id, id]
  tx.select().from(memory_artifacts).where(inArray(id, ids)).all()
    → JOIN needed to get metadata
```

### After (async + libSQL native + inline column)

```
Caller
  ↓ (async)
await Database.use(async (tx) => {
  await tx.insert(memory_artifacts).values({...embedding: f32buf})                // 1 async stmt
})
  ↓
@libsql/client → libsql native → disk

Read path (KNN):
  await tx.all(sql`
    SELECT id, content, vector_distance_cos(embedding, vector32(${queryVec})) AS dist
    FROM memory_artifacts
    WHERE scope_type = ${scope} AND deleted_at IS NULL
    ORDER BY dist ASC
    LIMIT ${limit}
  `)
    → returns [{id, content, dist}, ...] — one query, metadata included
```

### Runtime binary resolution (sidecar)

```
User runs: lightcode chat
  ↓
process.execPath = /usr/local/bin/lightcode
  ↓
src/index.ts first line:
  Module.globalPaths.unshift(dirname(execPath) + "/node_modules")
  ↓
Bun resolves: import { createClient } from "@libsql/client"
  → looks in /usr/local/bin/node_modules/@libsql/client/ → found, loads
  → @libsql/client requires libsql → /usr/local/bin/node_modules/libsql/ → found
  → libsql requires @libsql/darwin-arm64/index.node → found, dlopen succeeds
```

### Build-time sidecar copy

```
script/build.ts
  for target in [darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64, ...]:
    1. Bun.build({
         external: ["libsql", "@libsql/client", ...],
         compile: { target, outfile: dist/<target>/bin/lightcode },
       })
    2. Copy 11 libsql packages from
       node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/
       to
       dist/<target>/bin/node_modules/<pkg>/
    3. For @libsql/<platform>, pick the one matching the target (not host)
    4. tar -czf opencode-<target>.tar.gz *  // includes binary + sidecar
```

## Files changed

| File                                                                 | Change type | What changes                                                                                                                      |
| -------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/package.json`                                     | **MODIFY**  | Remove `sqlite-vec` + 5 platform packages. Add `@libsql/client` + 7 `@libsql/*` platform packages. Bump `drizzle-orm` if needed.  |
| `packages/opencode/drizzle.config.ts`                                | **MODIFY**  | `dialect: "sqlite"` → `dialect: "turso"`                                                                                          |
| `packages/opencode/src/storage/db.ts`                                | **REWRITE** | Async `Database` namespace. `Effect.cached` init. Async `use/transaction/effect`. Remove `NotPromise<T>`. New `Transaction` type. |
| `packages/opencode/src/storage/db.bun.ts`                            | **REWRITE** | `@libsql/client` instead of `bun:sqlite`. Remove sqlite-vec load. Remove Homebrew dylib fallback. Remove Windows warning.         |
| `packages/opencode/src/storage/json-migration.ts`                    | **REWRITE** | Async bulk insert via `client.batch`. Async function signatures.                                                                  |
| `packages/opencode/src/cli/cmd/db.ts`                                | **MODIFY**  | Replace `import { Database as BunDatabase } from "bun:sqlite"` with `@libsql/client` usage.                                       |
| `packages/opencode/src/index.ts`                                     | **MODIFY**  | Prepend `Module.globalPaths.unshift(...)` for sidecar resolution (D8).                                                            |
| `packages/opencode/src/memory/vector-type.ts`                        | **NEW**     | `f32blob(dim)` custom Drizzle type.                                                                                               |
| `packages/opencode/src/memory/memory.sql.ts`                         | **MODIFY**  | Import `f32blob`, declare `embedding: f32blob(384)()` on `memory_artifacts`. Same for session vector parent if applicable.        |
| `packages/opencode/src/memory/embedding-backend.ts`                  | **REWRITE** | Use `vector_top_k` + `vector_distance_cos` with inline scope filter. Drop JOIN logic. Shrinks ~50%.                               |
| `packages/opencode/src/memory/fts5-backend.ts`                       | **MODIFY**  | Async `Database.use/transaction` calls propagated.                                                                                |
| `packages/opencode/src/memory/provider.ts`                           | **MODIFY**  | Async propagation for memory API surface.                                                                                         |
| `packages/opencode/src/memory/working-memory.ts`                     | **MODIFY**  | 7 `Database.use/transaction/effect` calls → async.                                                                                |
| `packages/opencode/src/memory/handoff.ts`                            | **MODIFY**  | 6 calls → async.                                                                                                                  |
| `packages/opencode/src/memory/session-memory.ts`                     | **MODIFY**  | 4 calls → async.                                                                                                                  |
| `packages/opencode/src/session/om/record.ts`                         | **MODIFY**  | 14 calls → async. **Highest volume file**.                                                                                        |
| `packages/opencode/src/session/message-v2.ts`                        | **MODIFY**  | 5 calls → async.                                                                                                                  |
| `packages/opencode/src/session/index.ts`                             | **MODIFY**  | 5 calls → async.                                                                                                                  |
| `packages/opencode/src/session/todo.ts`                              | **MODIFY**  | 2 calls → async.                                                                                                                  |
| `packages/opencode/src/sync/index.ts`                                | **MODIFY**  | 5 calls → async.                                                                                                                  |
| `packages/opencode/src/project/project.ts`                           | **MODIFY**  | 5 calls → async.                                                                                                                  |
| `packages/opencode/src/control-plane/workspace.ts`                   | **MODIFY**  | 5 calls → async.                                                                                                                  |
| `packages/opencode/src/account/repo.ts`                              | **MODIFY**  | 4 calls → async.                                                                                                                  |
| `packages/opencode/src/cli/cmd/import.ts`                            | **MODIFY**  | 3 calls → async.                                                                                                                  |
| `packages/opencode/src/tool/recall.ts`                               | **MODIFY**  | 2 calls → async.                                                                                                                  |
| `packages/opencode/src/share/share-next.ts`                          | **MODIFY**  | 2 calls → async.                                                                                                                  |
| `packages/opencode/src/worktree/index.ts`                            | **MODIFY**  | 1 call → async.                                                                                                                   |
| `packages/opencode/src/server/projectors.ts`                         | **MODIFY**  | 1 call → async.                                                                                                                   |
| `packages/opencode/src/permission/index.ts`                          | **MODIFY**  | 1 call → async.                                                                                                                   |
| `packages/opencode/src/dream/daemon.ts`                              | **MODIFY**  | 1 call → async.                                                                                                                   |
| `packages/opencode/src/cli/cmd/stats.ts`                             | **MODIFY**  | 1 call → async.                                                                                                                   |
| `packages/opencode/migration/<new-timestamp>_libsql_native_vectors/` | **NEW**     | Migration SQL: drop `memory_artifacts_vec` and `memory_session_vectors`, add `F32_BLOB(384)` columns + indexes.                   |
| `packages/opencode/script/build.ts`                                  | **MODIFY**  | `external` option on both `Bun.build` calls. Sidecar copy step for 11 libSQL packages, platform-specific `@libsql/<os>-<arch>`.   |
| `packages/opencode/test/storage/json-migration.test.ts`              | **MODIFY**  | `drizzle-orm/bun-sqlite` → `drizzle-orm/libsql`. Async test bodies.                                                               |
| `packages/opencode/test/memory/memory-*.test.ts`                     | **MODIFY**  | Async test bodies, await `Database.use` calls.                                                                                    |
| `packages/opencode/test/memory-vec/**`                               | **MODIFY**  | New schema (no vec0 virtual table), async API.                                                                                    |
| `packages/opencode/AGENTS.md`                                        | **MODIFY**  | Update "Database" section to reflect async API. Add note about sidecar build. Update Effect rules if needed.                      |
| `README.md`                                                          | **MODIFY**  | libSQL mention in tech stack, install instructions note about tarball contents.                                                   |
| `docs/feature-catalog.md`                                            | **MODIFY**  | Storage layer description.                                                                                                        |
| `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`                           | **MODIFY**  | Storage section.                                                                                                                  |
| `docs/autodream-architecture.md`                                     | **MODIFY**  | Storage references.                                                                                                               |
| `docs/SUPERSEDED.md`                                                 | **MODIFY**  | Add entry for sqlite-vec → libSQL.                                                                                                |
| `docs/LIBSQL_MIGRATION_NOTES.md`                                     | **NEW**     | Async Database patterns, sidecar build step, guide for future native deps.                                                        |

**Total files: ~45.** Mostly mechanical async propagation, ~5 files with substantive rewrites
(`db.ts`, `db.bun.ts`, `json-migration.ts`, `embedding-backend.ts`, `build.ts`).

## Concurrency audit checklist (Phase 3)

Every transaction body that currently relies on sync execution order must be checked. The
list, extracted from the 21 files with `Database.use/transaction/effect` calls, ranked by
complexity:

1. **`json-migration.ts:JsonMigration.run`** — bulk insert 7 entity types with FK dependencies,
   orphan detection, progress callbacks. Uses `sqlite.exec("BEGIN")` + multiple `.run()` +
   `sqlite.exec("COMMIT")`. **Highest complexity**.
2. **`session/om/record.ts`** — 14 calls, OM atomicity invariants, buffer merging, seal state
   machine. **Second highest**.
3. **`memory/fts5-backend.ts`** — 11 calls including FTS reindex on updates, hash dedupe
   window query. Must preserve the 15-minute dedupe guarantee.
4. **`memory/working-memory.ts`** — 7 calls, scope precedence chain, versioning.
5. **`memory/handoff.ts`** — 6 calls, fork context atomicity.
6. **`sync/index.ts`**, **`session/message-v2.ts`**, **`session/index.ts`**,
   **`project/project.ts`**, **`memory/embedding-backend.ts`**, **`control-plane/workspace.ts`**
   — 5 calls each.

For each of these, the audit asks: does the transaction body perform multiple mutations that
depend on each other's results, and would an interleaved async operation from another fiber
(running against the same `Database.Client`) break invariants?

`@libsql/client` transactions are serializable (one transaction at a time holds the write lock
in `"write"` mode), so **interleaving across transactions is not possible**. The risk is only
within a single transaction body where the caller has multiple `await` points. The fix when
needed is to chain `.then()` or sequence explicitly without yielding between related
operations.

## Risks (Beyond proposal.md)

Additional risks uncovered during design:

- **`import { Module } from "module"` might not work under Bun**. Node.js has
  `Module.globalPaths` but Bun may not expose it the same way. Mitigation in Phase 5: validate
  D8 empirically; if it fails, fallback to shell wrapper.

- **`drizzle-kit push` and `drizzle-kit generate` behavior with `dialect: "turso"`**. The
  `drizzle-kit` CLI itself is not tested by POC 3. Migration generation for new tables after
  this change might differ from the existing `sqlite` dialect. Mitigation in Phase 1: generate
  a throwaway migration after the dialect switch and diff the output to confirm.

- **`F32_BLOB(384)` columns participate in SELECT \* queries and return as large Buffers**.
  Naive queries like `SELECT * FROM memory_artifacts WHERE id = ?` would transfer 1.5 KB of
  vector bytes per row even if the caller only wants the metadata. Mitigation: audit
  `memory_artifacts` queries and add explicit column projection where hot paths exist. Phase 3
  task.

- **The `Effect` runtime's InstanceState cleanup may need updates**. `db.ts`'s `close()`
  currently does `Client().$client.close()` — when `Client` is an `Effect.cached`, close
  becomes `await client.close()`. The existing `Instance` lifecycle hooks need to integrate.
  Mitigation: follow the `InstanceState.make` closure + `Effect.addFinalizer` pattern
  documented in `packages/opencode/AGENTS.md`.

- **Migration journal compatibility**: drizzle-kit stores a journal of applied migrations. If
  the dialect change causes drizzle to re-run migrations or bail out, we have a problem.
  Mitigation in Phase 1: verify the journal format is dialect-agnostic (it's JSON with
  timestamps, not dialect-specific SQL). The repo uses a custom `migrations()` function in
  `db.ts` that reads folders directly, not `_journal.json`, so this is low risk.

- **Linux musl vs glibc builds**: libsql ships separate `@libsql/linux-x64-gnu` and
  `@libsql/linux-x64-musl` packages. Current `build.ts` distinguishes via `item.abi`. The
  sidecar copy must pick the correct variant per target. Mitigation: explicit per-target
  platform resolution table in `build.ts`.

- **Windows sidecar behavior**: on Windows, Bun's compiled binary uses `B:/~BUN/root/` as the
  `$bunfs` prefix. The adjacent `node_modules/` resolution needs to work on Windows.
  POC 3 only tested macOS arm64. Phase 5 must include a cross-platform smoke test —
  at minimum build and verify the Linux binary, and document that Windows validation
  happens in CI before release.

## Open questions (to resolve during implementation)

- **Q1**: Does `@libsql/client` preserve `LibsqlTransaction` across `await` points within a
  single transaction? I.e. if I do `await tx.execute(...)` twice inside `Database.transaction`,
  is it the same SQL connection? **Expected**: yes (libSQL transactions hold a connection
  until commit/rollback/close). **Verify in Phase 2**.

- **Q2**: Does `drizzle-orm/libsql`'s `db.transaction(callback)` wrap raw `client.transaction()`
  or does it implement its own? **Expected**: wraps raw. **Verify by reading
  `drizzle-orm/src/libsql/session.ts`**.

- **Q3**: Is there a BigInt return type mismatch? `bun:sqlite` returns JS `number` for
  `INTEGER`, `@libsql/client` returns `BigInt` unless `intMode: "number"` is set on
  `createClient`. **Decision**: set `intMode: "number"` to match current behavior. Document
  in `db.bun.ts`.

- **Q4**: Migration DROP of `memory_artifacts_vec` — does it also drop its shadow tables
  (`memory_artifacts_vec_chunks`, `_rowids`, `_vector_chunks00`)? **Expected**: yes,
  `DROP TABLE` on a virtual table removes shadow tables. **Verify in Phase 4**.

- **Q5**: `FTS5` MATCH queries — do they need any syntax change on libSQL? **Expected**:
  no (FTS5 is inherited unchanged). **Verify in Phase 3 fts5-backend.ts testing**.
