# Technical Spec: Batched LSP Diagnostics (End-of-Step)

## Problem

Each `edit`/`write`/`apply_patch` tool call triggers LSP diagnostics INLINE:

- `LSP.touchFile(path, true)` — notifies LSP server + WAITS for diagnostics
- `LSP.diagnostics()` — collects all diagnostics
- 150ms debounce + 3s hard timeout PER FILE PER LSP CLIENT

In a refactor touching 8 files = up to 24 seconds wasted on diagnostics that are
guaranteed to have errors (missing imports, types not yet updated, etc.).

## Current Code Path

```
EditTool.execute()
  ├─ write file
  ├─ format file
  ├─ LSP.touchFile(filePath, true)     ← BLOCKS 150ms-3s
  ├─ LSP.diagnostics()                 ← collects ALL diagnostics
  ├─ filter severity === 1
  └─ append <diagnostics> to output    ← per-tool, mid-step
```

## Trigger Points (current)

| Tool        | File                    | Lines   | Scope                |
| ----------- | ----------------------- | ------- | -------------------- |
| edit        | src/tool/edit.ts        | 145-154 | Same file only       |
| write       | src/tool/write.ts       | 55-71   | Same file + 5 others |
| apply_patch | src/tool/apply_patch.ts | 235-268 | All changed files    |
| multiedit   | src/tool/multiedit.ts   | 26-36   | N × edit cycles      |

## Solution: Defer to End-of-Step

### In tools: fire-and-forget touchFile

Change `LSP.touchFile(path, true)` → `LSP.touchFile(path, false)` in edit/write/apply_patch.
Remove inline `LSP.diagnostics()` calls. Tools return output WITHOUT diagnostics.

### In processor: accumulate + batch at finish-step

Add `editedFiles: Set<string>` to processor context. When a tool-result arrives for
an edit/write/patch tool, record the files. At `finish-step`, do ONE batched
`touchFile(true)` + `diagnostics()` for all edited files, emit as a diagnostic summary part.

### Architecture

```
BEFORE (per-tool):
  edit A → touchFile(A,true) → wait → diagnostics → output+diag
  edit B → touchFile(B,true) → wait → diagnostics → output+diag
  edit C → touchFile(C,true) → wait → diagnostics → output+diag
  finish-step

AFTER (end-of-step):
  edit A → touchFile(A,false) → output (no diag)
  edit B → touchFile(B,false) → output (no diag)
  edit C → touchFile(C,false) → output (no diag)
  finish-step → touchFile(A,B,C,true) → diagnostics → emit diag part
```

## Files Modified

| File                          | Change                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/tool/edit.ts:145`        | `touchFile(path, false)` — fire-and-forget, no inline diagnostics                                         |
| `src/tool/write.ts:55`        | `touchFile(filepath, false)`                                                                              |
| `src/tool/apply_patch.ts:238` | `touchFile(target, false)` for each changed file                                                          |
| `src/tool/multiedit.ts`       | No change (delegates to edit)                                                                             |
| `src/session/processor.ts`    | `editedFiles: Set<string>` on ctx (line 57); tracking at line 234-237; batch at finish-step lines 317-335 |

## Implementation Status

✅ **IMPLEMENTED** — all files changed as specified.

The processor tracks edited files via tool metadata:

- `meta?.filediff?.file` — for edit/multiedit
- `meta?.filepath` — for write/apply_patch

At `finish-step`, all accumulated files get a single `touchFile(file, true)` + `LSP.diagnostics()` call, and the results are emitted as `<diagnostics file="...">` parts.

> **Note on Trigger Points table above**: the line numbers in "Current Code Path" and "Trigger Points" sections reflect the pre-implementation state. Post-implementation, inline diagnostic blocks have been removed from edit/write/apply_patch. The authoritative current state is `processor.ts:317-335`.
