# Tasks — Fix `sqlite-vec` Bundling in Compiled Binary

Single atomic commit. Order matters.

## Phase 1 — `build.ts` per-target asset embedding

- [ ] **T1** In `packages/opencode/script/build.ts`, add a helper at the top:

  ```ts
  function vecLoaderSource(os: string, arch: string) {
    const ext = os === "win32" ? "dll" : os === "darwin" ? "dylib" : "so"
    const bunOs = os === "win32" ? "windows" : os
    const pkg = `sqlite-vec-${bunOs}-${arch}`
    const dylibPath = path.resolve(
      dir,
      `node_modules/.bun/${pkg}@${pkg.dependencies?.[`sqlite-vec`] ?? "0.1.9"}/node_modules/${pkg}/vec0.${ext}`,
    )
    return `import dylib from ${JSON.stringify(dylibPath)} with { type: "file" }\nexport default dylib\n`
  }
  ```

  Adjust to read the actual installed version from `pkg.dependencies["sqlite-vec"]` (currently
  `"0.1.9"`).

- [ ] **T2** In the `for (const item of targets)` loop, before the `Bun.build({...})` call:
  - Compute `vecSource = vecLoaderSource(item.os, item.arch)`.
  - Add `"vec-loadable.gen.ts": vecSource` to the `files` map of the **first** `Bun.build`
    call (the one for `lightcode`, not `lightcode-dream-daemon`).
  - Add `"vec-loadable.gen.ts"` to the `entrypoints` array of that same call so Bun resolves
    and embeds it.

- [ ] **T3** Verify the path resolution by listing the file before the build:
  ```ts
  if (!fs.existsSync(dylibPath)) {
    throw new Error(`vec0.${ext} not found at ${dylibPath} for target ${item.os}-${item.arch}`)
  }
  ```
  Place this guard inside `vecLoaderSource` or right after calling it.

## Phase 2 — `db.bun.ts` runtime extraction

- [ ] **T4** Convert `init(path: string)` to `async function init(path: string)`.

- [ ] **T5** Add a top-level helper inside `db.bun.ts`:

  ```ts
  async function loadVec(sqlite: Database) {
    const vec = await import("./vec-loadable.gen.ts" as any).catch(() => null)
    if (!vec) {
      const sv = await import("sqlite-vec")
      sv.load(sqlite)
      return
    }
    const bunfsPath = vec.default as string
    const bytes = await Bun.file(bunfsPath).bytes()
    const xx = await (await import("xxhash-wasm")).default()
    const hash = xx.h64ToString(bytes)
    const ext = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so"
    const cacheRoot = process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache")
    const cacheDir = path.join(cacheRoot, "lightcode", "sqlite-vec")
    const cached = path.join(cacheDir, `vec0-${hash}.${ext}`)
    if (!existsSync(cached)) {
      try {
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(cached, bytes)
        chmodSync(cached, 0o755)
      } catch {
        const tmp = path.join(tmpdir(), `lightcode-vec0-${hash}.${ext}`)
        if (!existsSync(tmp)) {
          writeFileSync(tmp, bytes)
          chmodSync(tmp, 0o755)
        }
        sqlite.loadExtension(tmp)
        return
      }
    }
    sqlite.loadExtension(cached)
  }
  ```

- [ ] **T6** In `init`, replace `sqliteVec.load(sqlite)` with `await loadVec(sqlite)`.

- [ ] **T7** Update the imports at the top of `db.bun.ts`:
  - Remove `import * as sqliteVec from "sqlite-vec"` (now lazy via `import()` in fallback).
  - Add `import { existsSync, mkdirSync, writeFileSync, chmodSync } from "fs"`.
  - Add `import os from "os"` (or use the existing `homedir`/`tmpdir` if already imported).
  - Add `import path from "path"`.
  - Add `import { tmpdir } from "os"`.

- [ ] **T8** Drop the `:memory:` early-return path inside `loadVec` if it conflicts. The
      current code in `init` keeps the `isMemory` branch BEFORE calling `sqliteVec.load`, so
      `loadVec` is only ever invoked for file-backed databases. Verify that branch survives.

## Phase 3 — Caller updates

- [ ] **T9** Find every caller of `init` from `db.bun.ts` (search both direct imports and the
      `#db` import alias):

  ```
  rg "from \"#db\"" packages/opencode/src
  rg "from \".*storage/db" packages/opencode/src
  ```

  For each caller, ensure the call site `await`s `init(...)`. Most likely there is exactly
  one caller in `storage/db.ts` (or similar) — convert it to `async` and propagate `await`
  through any layer until you reach an Effect-based or already-async parent.

- [ ] **T10** If the call site is inside `Effect.gen`, use
      `yield* Effect.promise(() => init(path))`.

## Phase 4 — Sanity checks

- [ ] **T11** `bun run typecheck` from `packages/opencode` — must pass without errors.
      (Note: dev-mode `vec-loadable.gen.ts` does not exist, so the dynamic import returns null.
      TypeScript needs `as any` on the import path to suppress the missing-module error.)

- [ ] **T12** `rg "sqliteVec" packages/opencode/src` — should only show the lazy `import()`
      inside `loadVec`. No top-level `import * as sqliteVec`.

- [ ] **T13** `rg "vec-loadable.gen" packages/opencode` — should match only `db.bun.ts` and
      `script/build.ts`.

- [ ] **T14** Run `bun run build --single` from `packages/opencode`. Expected:
  - The build completes without errors.
  - The smoke test (`<binary> --version`) passes.
  - No `Cannot find module 'sqlite-vec-...'` error.

- [ ] **T15** Run the compiled binary against a fresh database directory and confirm:
  - It opens without crashing.
  - `XDG_CACHE_HOME/lightcode/sqlite-vec/vec0-<hash>.<ext>` (or `~/.cache/lightcode/sqlite-vec/...`)
    is created.
  - A second run does NOT rewrite the file (touch its mtime, run again, mtime unchanged).

## Phase 5 — Validation against `embedding-recall` pipeline

- [ ] **T16** With the compiled binary, trigger a session that hits `Memory.indexArtifact()`
      (any normal user interaction with autosave on). Then query `Memory.searchArtifacts("...")`
      via the same binary and confirm it returns results from the embedding side, not just FTS5.
      Smoke-only — no automated test required for this change.
