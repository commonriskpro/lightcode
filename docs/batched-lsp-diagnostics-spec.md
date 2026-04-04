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

## Files to Modify

| File                       | Change                                                   |
| -------------------------- | -------------------------------------------------------- |
| `src/tool/edit.ts`         | touchFile(path, false), remove diagnostics block         |
| `src/tool/write.ts`        | touchFile(path, false), remove diagnostics block         |
| `src/tool/apply_patch.ts`  | touchFile(path, false), remove diagnostics block         |
| `src/tool/multiedit.ts`    | No change (delegates to edit)                            |
| `src/session/processor.ts` | Add editedFiles to ctx, batch diagnostics at finish-step |
