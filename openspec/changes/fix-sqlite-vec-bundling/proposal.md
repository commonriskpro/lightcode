# Proposal — Fix `sqlite-vec` Bundling in Compiled Binary

## Intent

Make `sqlite-vec`'s native loadable extension (`vec0.dylib` / `vec0.so` / `vec0.dll`) work
inside the `bun build --compile` single-file binary across all 12 build targets, by embedding
the per-target native asset and extracting it to a per-version cache directory at startup.

## Why Now

The `embedding-recall` change introduced `sqlite-vec` via
`packages/opencode/src/storage/db.bun.ts`. Local `bun run dev` works because `import.meta.resolve()`
inside the `sqlite-vec` loader resolves to the real `node_modules` path on disk. The compiled
binary crashes immediately on startup with:

```
Cannot find module 'sqlite-vec-darwin-arm64/vec0.dylib' from '/$bunfs/root/src/index.js'
```

Two reasons this happens:

1. `bun build --compile` only embeds JavaScript/TypeScript modules detected by static analysis.
   It does NOT bundle native shared libraries (`.dylib` / `.so` / `.dll`) unless they are
   explicitly imported with `with { type: "file" }`.
2. Even if Bun knew the path, the `sqlite-vec` package's `index.mjs` calls
   `import.meta.resolve("sqlite-vec-<os>-<arch>/vec0.<ext>")` at runtime — that resolution
   happens inside the `$bunfs` virtual filesystem, where the native library does not exist.

The compiled binary is the only thing users actually run. Until this is fixed, **the entire
embedding pipeline (HybridBackend, RRF, fastembed) is dead in every shipped artifact.**

## Scope

### In scope

- Modify `packages/opencode/script/build.ts` to:
  - Per build target, generate a virtual `vec-loadable.gen.ts` file that imports the correct
    platform-specific native library with `with { type: "file" }`.
  - Pass that virtual file via `Bun.build({ files })` so it is embedded in the `$bunfs`.
- Modify `packages/opencode/src/storage/db.bun.ts` to:
  - Import the generated `vec-loadable.gen.ts` to get the embedded asset's `$bunfs` path.
  - Extract the asset to a per-version cache directory (`XDG_CACHE_HOME/lightcode/sqlite-vec/`)
    once on first startup.
  - Call `sqlite.loadExtension(<extracted-path>)` instead of `sqliteVec.load(sqlite)`.
  - Fall back to `sqliteVec.load(sqlite)` when the generated file is absent (i.e. `bun run dev`).
- Add a small helper that hashes the embedded `.dylib` content and skips re-extraction when
  the cached file already matches.

### Out of scope

- Removing the `sqlite-vec` package dependency.
- Touching `db.node.ts` (the `node:sqlite` fallback path doesn't load `sqlite-vec`).
- Cross-compiling the native library ourselves (we keep using upstream platform packages).
- Bumping `sqlite-vec` to a newer version.
- Any change to `EmbeddingBackend`, `HybridBackend`, or memory pipeline behavior.

## Approach

Single atomic commit. Order:

1. **`build.ts` — generate the virtual file per target.** For each `target` in the build loop,
   compute the absolute path to the corresponding native library inside
   `node_modules/.bun/sqlite-vec-<os>-<arch>@<version>/node_modules/sqlite-vec-<os>-<arch>/vec0.<ext>`
   and emit a generated TS file:

   ```ts
   import dylib from "<absolute-path>" with { type: "file" }
   export default dylib
   ```

   Pass it via `files: { "vec-loadable.gen.ts": <generated source> }` and add it as an
   entrypoint so Bun resolves the asset import.

2. **`db.bun.ts` — runtime extraction.** Convert `init(path)` to:
   - Try to dynamically import `./vec-loadable.gen.ts`. If it exists, the default export is the
     `$bunfs` path of the embedded asset.
   - Read the asset bytes via `Bun.file(<bunfs path>).bytes()`.
   - Compute a content hash (xxhash, already a dep).
   - Resolve cache dir via `XDG_CACHE_HOME ?? ~/.cache` + `lightcode/sqlite-vec/`.
   - If `<cache>/vec0-<hash>.<ext>` does not exist, write it (`fs.writeFileSync` + `chmod 0755`).
   - Call `sqlite.loadExtension(<cache file>)`.
   - On any error from the above (including `vec-loadable.gen.ts` not present), fall back to
     `sqliteVec.load(sqlite)` for `bun run dev`.

3. **Smoke test** — `script/build.ts` already runs `<binary> --version` after building for the
   current platform. The current crash blocks this smoke test. Once the fix lands, the smoke
   test passes implicitly. No new test infrastructure required.

See `design.md` for the investigation, decision log, and exact file-by-file changes.

## Success Criteria

- `bun run build --single` produces a `lightcode` binary that runs `--version` successfully on
  the current platform.
- The compiled binary opens the database, loads `vec0.<ext>`, and answers a query that hits
  the `memory_artifacts_vec` virtual table without throwing `Cannot find module`.
- `XDG_CACHE_HOME/lightcode/sqlite-vec/vec0-<hash>.<ext>` is created on first run and reused
  on subsequent runs.
- `bun run dev` continues to work without any new files on disk (fallback path active).
- All 12 cross-compile targets in `script/build.ts` produce binaries with their own
  platform-correct embedded `.dylib`/`.so`/`.dll` (verified by smoke test on at least the
  current platform; cross-target verification deferred to CI/release).

## Risks

- **Embedded asset bloats the binary by ~700KB per target.** Acceptable: the Linux GLIBC binary
  is already ~150MB. One extra `.dylib` is noise.
- **`dlopen()` cannot read from `$bunfs`.** This is the entire reason we extract to disk; the
  cache step is mandatory, not optional.
- **First-run latency from extraction.** ~5–10ms one time per version per host. Subsequent
  startups skip the write because the hashed filename already exists.
- **Cache dir permission failures** (e.g. read-only `$HOME`). Mitigated by falling back to a
  `os.tmpdir()` extraction path with the same hash filename. Documented in `design.md` D3.
- **`sqlite-vec` upstream changes its loader strategy.** Out of scope; we'd react in a future
  change.
- **`vec-loadable.gen.ts` import in `db.bun.ts` triggers a Bun static-analysis warning during
  `bun run dev`.** Mitigated by wrapping in a `try` and using a dynamic `import()` so the
  missing file is non-fatal.

## Rollback

Single `git revert` restores `db.bun.ts` to `sqliteVec.load(sqlite)` and removes the
`build.ts` changes. The `embedding-recall` change continues to work in `bun run dev` mode.
The compiled binary goes back to crashing on startup — same state as today.
