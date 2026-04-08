# Proposal — Migrate Storage from `bun:sqlite` to libSQL with Async Refactor

## Intent

Replace `bun:sqlite` + `drizzle-orm/bun-sqlite` + `sqlite-vec` with `@libsql/client` +
`drizzle-orm/libsql` + libSQL's native vector search across the entire storage layer, converting
the `Database` namespace and all 90+ call-sites from sync to async. Ship a single-backend
architecture that unblocks compiled-binary distribution, restores Windows parity, and lays the
foundation for sync-engine features (Escenario B: embedded replicas between devices; Escenario C:
multi-tenant cloud) without rewriting the data layer again.

## Why Now

Three forces converge:

1. **Compiled binary is dead in production**: `bun build --compile` crashes on first DB open with
   `Cannot find module 'sqlite-vec-darwin-arm64/vec0.dylib' from '/$bunfs/root/src/index.js'`
   because Bun's `--compile` does not bundle native `.dylib` / `.so` / `.dll` assets, and
   `sqlite-vec`'s loader uses `import.meta.resolve()` against the `$bunfs` virtual FS where the
   binary does not exist. Every shipped artifact is broken until this is fixed.
2. **Sync engine trajectory requires libSQL**: roadmap includes Escenario B (sync between
   devices) in 6–12 months and Escenario C (multi-tenant cloud) in 18–24 months. The ONLY
   storage in the TypeScript ecosystem that covers this trajectory without requiring a full
   rewrite is libSQL (Embedded Replicas for B, Turso Cloud for C — same `@libsql/client` API for
   all three). Fixing `sqlite-vec` bundling today without migrating means **paying twice**: once
   to patch the bundling, once to rewrite the storage layer when B arrives.
3. **Empirical validation of 5/5 blockers**: POC 3 (executed Apr 8, 23/23 explicit tests + 16/17
   real migrations + portable sidecar binary) confirms libSQL is technically viable. No unknown
   unknowns remain. See `design.md` Investigation Summary for details.

The unification argument the user asked for — "una sola DB que soporte todo" — becomes literal
with libSQL: one driver, one native binding, one file, one vector search implementation, one
path forward for sync.

## Scope

### In scope

- **Driver migration**:
  - Replace `bun:sqlite` → `@libsql/client` across `db.bun.ts`, `json-migration.ts`, `cli/cmd/db.ts`.
  - Replace `drizzle-orm/bun-sqlite` → `drizzle-orm/libsql` across `db.ts`, `db.bun.ts`,
    `json-migration.ts`, `test/storage/json-migration.test.ts`.
  - Update `drizzle.config.ts` dialect from `"sqlite"` to `"turso"`.
  - Remove `sqlite-vec` + 5 platform packages (`sqlite-vec-darwin-arm64`, `-darwin-x64`,
    `-linux-arm64`, `-linux-x64`, `-windows-x64`) from `package.json`.
  - Add `@libsql/client`, `drizzle-orm` version bump if needed, and 8 `@libsql/*` platform
    packages to `package.json`.

- **Async-wide refactor of the `Database` namespace** (`packages/opencode/src/storage/db.ts`):
  - `Database.Client` goes from `lazy(() => sync)` to an `Effect`-based async initializer.
  - `Database.use`, `Database.transaction`, `Database.effect` accept async callbacks and return
    `Promise<T>` instead of `T`.
  - Remove the `NotPromise<T>` type helper that explicitly forbids async callbacks today.
  - Type `Transaction` goes from `SQLiteTransaction<"sync", void>` to
    `SQLiteTransaction<"async", ResultSet>`.
  - All PRAGMAs and init sequence in `db.bun.ts` become async.

- **Call-site migration** (measured: 90 call-sites of `Database.use/transaction/effect` across
  22 files, 202 Drizzle sync method calls across 73 files):
  - Effect-based callers: wrap in `yield* Effect.promise(() => Database.use(...))`.
  - Plain sync functions: propagate `async` up to the nearest Effect boundary or existing async
    caller.
  - Drizzle `.all()/.get()/.run()/.values()` calls: become `await`-ed.
  - Audit each `Database.transaction` body for concurrency correctness under async semantics
    (no interleaving issues introduced by `await` yield points).

- **Vector search reimplementation**:
  - New migration `<timestamp>_replace_vec0_with_libsql_native.sql` that drops the two virtual
    tables `memory_artifacts_vec` and `memory_session_vectors` and adds `embedding F32_BLOB(384)`
    columns directly to `memory_artifacts` and `memory_session_vectors`' real parent table,
    plus `libsql_vector_idx` indexes.
  - Rewrite `packages/opencode/src/memory/embedding-backend.ts` to query `vector_top_k` +
    `vector_distance_cos` with scope pre-filtering in a single query (eliminates the current
    JOIN-after-KNN pattern).
  - Update `packages/opencode/src/memory/*.sql.ts` schema files to declare embedding columns via
    a Drizzle `customType<Float32Array>` with `dataType() => "F32_BLOB(384)"`.
  - Delete the sqlite-vec-related branches in `db.bun.ts`: `enableExtensions: true`,
    `Database.setCustomSQLite(homebrewDylib)`, the Windows fallback warning, and the
    `sqliteVec.load(sqlite)` call.

- **Build pipeline** (`packages/opencode/script/build.ts`):
  - Add `external: ["libsql", "@libsql/client", ...]` to both `Bun.build` calls (main binary
    and dream daemon).
  - After each build, copy the 11 libSQL-related packages from `node_modules/.bun/<pkg>@<ver>/...`
    to `dist/<target>/bin/node_modules/`. The `tar -czf * ` in the release step picks them up
    automatically.
  - Per-target platform binding resolution: `@libsql/darwin-arm64`, `@libsql/darwin-x64`,
    `@libsql/linux-x64-gnu`, `@libsql/linux-x64-musl`, `@libsql/linux-arm64-gnu`,
    `@libsql/linux-arm64-musl`, `@libsql/win32-x64-msvc`.
  - `autoloadPackageJson: true` is already enabled (line 216 of current `build.ts`) and required
    for `--external` resolution against adjacent `node_modules/`.

- **Tests**:
  - Migrate all tests using `new Database(":memory:")` from `bun:sqlite` to
    `createClient({ url: ":memory:" })` from `@libsql/client`.
  - Convert sync test bodies that call `Database.use(...)` sync to async.
  - Adapt `test/memory-vec/` tests to use the new `F32_BLOB(384)` column schema instead of the
    `vec0` virtual table.
  - Keep the existing test organization and non-storage assertions untouched.

- **Documentation**:
  - Update `README.md`, `docs/feature-catalog.md`, `docs/LIGHTCODE_ARCHITECTURE_REFERENCE.md`,
    `docs/autodream-architecture.md`, and `docs/SUPERSEDED.md` to reference libSQL and the async
    `Database` API.
  - Update `packages/opencode/AGENTS.md` rules that describe `Database` as sync.
  - Create a short `docs/LIBSQL_MIGRATION_NOTES.md` for future contributors explaining the
    async patterns, the sidecar build step, and how to add future native deps.

### Out of scope

- **Enabling sync engine features (Escenarios B/C)**. This change lays the foundation but does
  NOT wire `syncUrl:` or Turso Cloud. That is a separate follow-up change.
- **Changing `Memory.buildContext()`, `MemoryContext`, `PromptBlock`, or any public memory API**.
  Only the storage layer changes; memory semantics are preserved.
- **Touching the historical `docs/LIGHTCODE_MEMORY_CORE_V1/V2/V3_*.md` specs**.
- **Removing or modifying FTS5 usage**. `memory_artifacts_fts*` stays exactly as it is — libSQL
  inherits SQLite's FTS5 support.
- **Archiving prior changes** (`embedding-recall`, `fix-sqlite-vec-bundling`,
  `remove-semantic-recall-shim`) — those are separate archive steps after this change ships.
- **Adding new tests for features that already have coverage**. Only migrate existing tests.
- **Adding encryption, sync, or multi-tenant features**. Kept as pure single-DB local for now.

## Approach

Atomic commit. Six phases executed in order:

1. **Phase 1 — Dependencies & config** (1–2 h). Install `@libsql/client`, remove `sqlite-vec` +
   5 platform packages, add 7 `@libsql/*` platform packages, update `drizzle.config.ts`.

2. **Phase 2 — `db.bun.ts` + `db.ts` async rewrite** (1 day). Rewrite both files with
   `@libsql/client` + `drizzle-orm/libsql`. Convert `Database.Client` from `lazy()` sync to an
   Effect-cached async initializer. Propagate `async` to `use/transaction/effect`. Remove
   `NotPromise<T>`. Change `Transaction` type.

3. **Phase 3 — Async-wide call-site migration** (3–4 days). Work through the 22 files with
   `Database.use/transaction/effect` calls, then the 73 files with Drizzle sync calls. Group by
   subsystem (session, memory, project, sync, dream, account, event, etc.) to audit concurrency
   per domain. Cross-check each `Database.transaction` body for race conditions introduced by
   `await` yield points.

4. **Phase 4 — Vector search reimplementation** (1 day). Drop `memory_artifacts_vec` and
   `memory_session_vectors` virtual tables via new migration. Add `F32_BLOB(384)` columns
   directly. Rewrite `embedding-backend.ts` with pre-filtered `vector_distance_cos` queries.
   Update schema `.sql.ts` files with `customType`. Delete sqlite-vec platform branches in
   `db.bun.ts`.

5. **Phase 5 — Build pipeline** (2–3 h). Update `script/build.ts` with `external` + sidecar
   copy for the 11-package libSQL tree. Verify smoke test passes with vector insert + query
   inside compiled binary.

6. **Phase 6 — Tests + docs + sanity** (2 days). Migrate test suite, update docs, update
   `AGENTS.md`, run full typecheck + test suite, ripgrep for orphan references.

See `design.md` for the decision log, investigation details, blocker validation evidence from
POC 3, and the complete file-by-file change list.

## Success Criteria

- `rg "bun:sqlite" packages/opencode/src packages/opencode/test` returns **zero matches**.
- `rg "drizzle-orm/bun-sqlite" packages/opencode` returns **zero matches**.
- `rg "sqlite-vec|sqliteVec" packages/opencode` returns **zero matches**.
- `rg "NotPromise" packages/opencode/src/storage/db.ts` returns **zero matches**.
- `rg "vec0|memory_artifacts_vec|memory_session_vectors" packages/opencode/src` returns only the
  new migration SQL file (the `DROP`) and zero other references.
- `package.json` no longer lists `sqlite-vec` or any `sqlite-vec-*` platform packages; it lists
  `@libsql/client` and the 7 `@libsql/*` platform packages.
- `bun run build --single` produces a `lightcode` binary and `node_modules/` sidecar that
  together:
  - Open the database without crashing.
  - Apply all migrations (including the new vec0-replacement migration) successfully.
  - Create `memory_artifacts.embedding F32_BLOB(384)` column with `libsql_vector_idx` index.
  - Answer a semantic search query with at least one KNN result via `vector_top_k` +
    `vector_distance_cos`.
- `bun test` from `packages/opencode` passes with the migrated test suite.
- `bun typecheck` from `packages/opencode` passes with no errors.
- `Database.use(async (tx) => await ...)` works and is the new idiomatic pattern.
- The binary runs on macOS arm64, macOS x64, Linux x64, Linux arm64, and Windows x64 (the 5
  current build targets).
- `docs/LIBSQL_MIGRATION_NOTES.md` exists and documents the async `Database` API + the sidecar
  build step for future native deps.

## Risks

- **Concurrency regressions under async `Database.transaction`**. This is the #1 risk.
  Mitigation: audit each of the ~15 non-trivial transaction bodies (json-migration bulk insert,
  fts5-backend reindex, om atomic operations, session writes, etc.) manually. Validate that
  no `await` yield point introduces interleaving between operations that were previously
  guaranteed sequential by sync execution. Add debug logging during Phase 3 to catch any
  unexpected interleaving during integration testing.

- **Schema diffs between `sqlite` and `turso` dialect in drizzle-kit**. `drizzle-kit generate`
  with `dialect: "turso"` may produce slightly different SQL than `"sqlite"` for some edge
  cases. Mitigation: POC 3 already replayed 16/17 existing migrations successfully on libSQL.
  Any new migration generated after this change will use the new dialect, but existing
  migrations are immutable and already validated.

- **`lazy()` → async pattern change in `Database.Client`**. The current `lazy()` is sync and
  runs `init(Path)` + 6 PRAGMAs + 17 migrations synchronously on first access. Converting to
  async means the first caller pays the full init cost behind an `await`, and any subsequent
  sync caller path (e.g. `Database.close()` which currently uses `Client().$client.close()`)
  needs to become async. Mitigation: use `Effect.cached` from the existing `src/effect/`
  helpers per the repo's AGENTS.md guidance; `Database.close()` becomes async too.

- **Sidecar tarball bloat**. The 11-package libSQL sidecar adds ~9 MB per build target
  (~7.8 MB is the native `.node` binding, ~1.2 MB is the JS wrapper packages). Multiplied by
  the 12 build targets, that is ~108 MB of extra release assets. Acceptable: the existing
  Linux GLIBC binary is already ~125 MB, so per-target total becomes ~134 MB. Still a
  reasonable download size for a developer tool.

- **`cwd`-relative resolution of adjacent `node_modules/`**. POC 1 (sqlite-vec sidecar)
  confirmed that the binary MUST be executed from its own directory or Bun fails to resolve
  the adjacent `node_modules/`. POC 3 confirmed the same behavior with libSQL sidecar and
  validated portability when the entire `bin/` directory is moved. Mitigation: wrap the
  binary in a shell launcher (`#!/bin/sh` with `cd "$(dirname "$0")"; exec ./lightcode-bin "$@"`)
  OR use `Module.globalPaths.push(path.dirname(process.execPath) + "/node_modules")` at the
  top of `src/index.ts` before any libSQL import. This sub-decision is documented in
  `design.md` D7.

- **Libsql-core API mismatches with `bun:sqlite` edge cases**. `PRAGMA
wal_checkpoint(PASSIVE)`, `transaction` behaviors, `:memory:` support, and all 6 standard
  PRAGMAs were validated by POC 3. Anything more exotic (e.g. `PRAGMA table_xinfo`, user-defined
  functions) may require translation. Mitigation: grep the codebase for all `PRAGMA` usage
  during Phase 2 and validate each one against libSQL docs.

- **Binary distribution channels (Homebrew, scoop, direct tarball) need to handle the
  `node_modules/` sidecar directory**. Mitigation: current release script already uses
  `tar -czf ${key}.tar.gz *` which glob-matches anything in `dist/<target>/bin/`, so the
  sidecar is picked up automatically. Only the install instructions in the README may need
  a note that the tarball contains multiple files.

- **Broken binary window during the 8–10 day implementation**. The user has explicitly
  accepted this trade-off. Dev mode (`bun run dev`) continues to work throughout because it
  uses on-disk `node_modules/` and never hits the `$bunfs` path.

## Rollback

Single `git revert` restores:

- `bun:sqlite` + `drizzle-orm/bun-sqlite` imports across the 3 affected files.
- Sync `Database.Client = lazy(() => ...)` and sync `use/transaction/effect`.
- `NotPromise<T>` helper.
- `sqlite-vec` + 5 platform packages in `package.json`.
- `vec0` virtual tables via reversing the new migration (safe because the old
  `embedding-recall` migration is still in the journal above it).
- `drizzle.config.ts` dialect back to `"sqlite"`.
- Original `script/build.ts` without the sidecar copy step.

The compiled binary goes back to crashing on DB open — same state as today. Dev mode continues
to work. No data loss because the SQL schema changes are additive (new columns) plus drops of
virtual tables which hold derived data that gets regenerated on next index operation.
