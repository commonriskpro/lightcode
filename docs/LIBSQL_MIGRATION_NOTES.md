# libSQL Storage Migration Notes

## 1. Why libSQL

LightCode moved from Bun SQLite plus extension-based vectors to `@libsql/client` so the current local product path and the future sync path share the same storage engine.

## 2. The sidecar pattern

The compiled binary ships with an adjacent `node_modules/` sidecar that contains `@libsql/client`, `libsql`, and the platform-native bindings. Move or extract the whole directory together. Moving only the executable breaks runtime resolution.

## 3. Async Database API

The storage API is async now:

- `await Database.Client()`
- `await Database.read(async (db) => ...)`
- `await Database.write(async (db) => ...)`
- `await Database.tx(async (tx) => ...)`
- `await Database.close()`

`drizzle-orm/libsql` is async-only, so callers must respect the boundary.

`Database.use(...)` and `Database.transaction(...)` still exist as compatibility wrappers, but new code should use the explicit `read/write/tx` split.

## 3.1 Migration gotchas that were fixed in code

The tricky part was not just the DB client — it was every caller that still behaved as if storage-side effects were synchronous.

- `SyncEvent` had to await async projectors
- session callers like `session/index.ts` and `session/revert.ts` had to stop treating event/projector work as fire-and-forget
- async DB code inside transaction helpers had to stop leaking unresolved promises
- write ownership had to move to a coordinated in-process gate so subagent launch, OM, sync, and memory writes do not interleave unpredictably
- post-commit callbacks had to run after releasing the writer gate; keeping the lock during `Database.effect(...)` can deadlock follow-up reads and stall the main agent loop

If you migrate another path to libSQL, verify the whole call chain. Half-async code is how you get phantom state, missing projections, and race bugs.

## 4. Vector queries

LightCode now uses libSQL native vectors:

- durable artifact vectors live in `memory_artifacts.embedding`
- session recall vectors live in `memory_session_chunks.embedding`
- column type is `F32_BLOB(384)`

Use `vector_distance_cos(embedding, vector32(?))` when you need explicit ranking inside a filtered query. Use `libsql_vector_idx(embedding)` indexes to accelerate real-table vector lookups.

## 5. Adding a future native dep

Checklist:

1. mark the package as external in the build step
2. copy its runtime dependency tree beside the compiled binary
3. ensure entrypoint resolution can find the adjacent `node_modules/`
4. verify from a different working directory
5. document the sidecar requirement for users

## 6. Rollback

Rollback would require restoring the old driver, old migrations or compatibility migrations, and the old sync storage API. That is intentionally expensive; this migration was meant to avoid redoing storage later.

## 7. Known caveats

- `Database` is async across the board now.
- Compiled binaries depend on the sidecar `node_modules/` tree.
- `intMode: "number"` is required so libSQL returns JS numbers for integer columns.
- Old `sqlite-vec` virtual tables were removed and replaced by real-table vector columns.
