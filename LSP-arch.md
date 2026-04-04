LSP Diagnostics: Complete Code Path Analysis
1. THE TRIGGER MECHANISM (per-tool, inline in execute())
Diagnostics are triggered synchronously inside each tool's execute() function, at the very end, AFTER the file write completes. There is NO post-execute hook, NO file watcher trigger, and NO end-of-step batching. It is purely inline.
Edit Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/edit.ts)
- Lines 145-154: After the file is written/formatted (line 110-121), the edit tool calls:
    await LSP.touchFile(filePath, true)        // line 145
  const diagnostics = await LSP.diagnostics() // line 146
    Then it filters for severity === 1 (errors only) on the edited file and appends <diagnostics> XML to the output string (line 154).
- Scope: Only reports errors for the SINGLE edited file (lines 148-154). Does NOT report errors in other files.
Write Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/write.ts)
- Lines 55-71: Same pattern but broader scope:
    await LSP.touchFile(filepath, true)         // line 55
  const diagnostics = await LSP.diagnostics()  // line 56
    Then iterates ALL files in diagnostics (line 59), reports the edited file's errors first (line 66), then up to MAX_PROJECT_DIAGNOSTICS_FILES = 5 other files (lines 69-71).
- Scope: Reports errors across the project, capped at 5 other files.
Apply Patch Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/apply_patch.ts)
- Lines 235-268: Touches EACH changed file sequentially:
    for (const change of fileChanges) {
    if (change.type === "delete") continue
    await LSP.touchFile(target, true)  // line 238
  }
  const diagnostics = await LSP.diagnostics()  // line 240
    Then reports errors per changed file (lines 257-268).
- Scope: Per-changed-file within the patch. All files touched before a single diagnostics() call.
MultiEdit Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/multiedit.ts)
- Lines 26-36: Delegates to EditTool.execute() in a sequential loop. This means EACH edit within a multiedit triggers its own touchFile + diagnostics cycle. The multi-edit returns the LAST edit's output (line 43), which includes the last edit's diagnostics.
Read Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/read.ts)
- Line 219: LSP.touchFile(filepath, false) -- fire-and-forget, NO diagnostic wait. Just warms the LSP client.
Batch Tool (/Users/dev/lightcodev2/packages/opencode/src/tool/batch.ts)
- Line 134: Runs tools in parallel via Promise.all. Each inner tool (edit, write, etc.) independently calls touchFile + diagnostics. No batching coordination.
---
2. HOW THE LSP SYSTEM WORKS
LSP Client (/Users/dev/lightcodev2/packages/opencode/src/lsp/client.ts)
Diagnostics are PUSHED by the LSP server (not pulled). The client subscribes to them:
- Line 53: connection.onNotification("textDocument/publishDiagnostics", ...) -- the LSP server pushes diagnostic notifications whenever it finishes analyzing.
- Line 52: Diagnostics are stored in a Map<string, Diagnostic[]>() keyed by normalized file path.
- Line 60: Each push overwrites the previous diagnostics for that file path.
- Line 61-62: Special case for TypeScript: if the file is being opened for the first time (!exists) AND the server is "typescript", the Bus event is suppressed. This prevents premature resolution of waitForDiagnostics before TypeScript sends its full semantic diagnostics (TypeScript sends syntax diagnostics first, then semantic diagnostics in a second push).
- Line 62: Bus.publish(Event.Diagnostics, ...) fires after each push, which unblocks waitForDiagnostics.
notify.open() (lines 149-204) -- this is what touchFile ultimately calls:
- If the file was already opened (version exists): sends workspace/didChangeWatchedFiles (type 2 = Changed) + textDocument/didChange with full text replacement.
- If the file is new: sends workspace/didChangeWatchedFiles (type 1 = Created) + textDocument/didOpen with full content + deletes existing diagnostics for that path (line 194) to force a fresh diagnostic push.
waitForDiagnostics() (lines 210-238) -- the blocking wait mechanism:
- Subscribes to Bus for Event.Diagnostics matching the file path and server ID.
- Uses a 150ms debounce (DIAGNOSTICS_DEBOUNCE_MS, line 17) to allow follow-up diagnostics (e.g., TypeScript sends syntax first, then semantic).
- Has a 3-second timeout (withTimeout(..., 3000), line 217) that silently resolves on timeout (.catch(() => {}), line 233).
LSP Index (/Users/dev/lightcodev2/packages/opencode/src/lsp/index.ts)
touchFile (lines 357-371):
const clients = yield* getClients(input)
yield* Effect.promise(() =>
  Promise.all(
    clients.map(async (client) => {
      const wait = waitForDiagnostics ? client.waitForDiagnostics({path: input}) : Promise.resolve()
      await client.notify.open({ path: input })
      return wait
    }),
  )
)
Key: It sets up the waitForDiagnostics promise BEFORE calling notify.open, so the Bus subscription is in place before the LSP server could respond.
diagnostics() (lines 373-384):
Collects diagnostics from ALL running LSP clients and merges them into a single Record<string, Diagnostic[]>. This means a single LSP.diagnostics() call returns diagnostics from TypeScript, ESLint, Biome, etc. all merged together.
---
3. THE COMPLETE CODE PATH (edit tool example)
EditTool.execute()
  |
  |- Filesystem.write(filePath, content)        [edit.ts:110]
  |- Format.file(filePath)                      [edit.ts:111]
  |- Bus.publish(File.Event.Edited, ...)        [edit.ts:112]
  |- Bus.publish(FileWatcher.Event.Updated, ...)  [edit.ts:113]
  |- FileTime.read(...)                         [edit.ts:121]
  |
  |- LSP.touchFile(filePath, true)              [edit.ts:145]
  |    |
  |    |- getClients(filePath) -- spawns/reuses LSP server(s) for this file type
  |    |- For EACH client:
  |    |    |- client.waitForDiagnostics({path}) -- sets up Bus subscription with 150ms debounce
  |    |    |- client.notify.open({path})
  |    |    |    |- Reads file content from disk
  |    |    |    |- Sends workspace/didChangeWatchedFiles notification
  |    |    |    |- Sends textDocument/didChange (or didOpen if first time)
  |    |    |    |
  |    |    |    |-- LSP server processes, pushes textDocument/publishDiagnostics --
  |    |    |    |
  |    |    |- onNotification handler fires:
  |    |    |    |- diagnostics.set(filePath, params.diagnostics)
  |    |    |    |- Bus.publish(Event.Diagnostics, ...)
  |    |    |
  |    |    |- waitForDiagnostics resolves (after 150ms debounce or 3s timeout)
  |    |- Promise.all resolves when ALL clients finish
  |
  |- LSP.diagnostics()                          [edit.ts:146]
  |    |- Collects diagnostics Maps from all clients
  |    |- Merges into Record<string, Diagnostic[]>
  |
  |- Filter severity === 1 (errors only)        [edit.ts:149]
  |- Append <diagnostics> XML to output         [edit.ts:154]
  |- Return { output, metadata: { diagnostics } } [edit.ts:157-165]
---
### 4. THE STEP LIFECYCLE (Processor)
**File**: `/Users/dev/lightcodev2/packages/opencode/src/session/processor.ts`
The processor handles LLM stream events. The relevant events are:
- **`tool-call`** (line 174): Records that a tool is running, checks for doom loops.
- **`tool-result`** (line 215): Stores the completed tool's output (which already contains diagnostics baked in).
- **`finish-step`** (line 267): Updates usage/tokens/cost, captures snapshot patch, triggers summary. **There is NO diagnostic aggregation here.**
The processor does NOT:
- Intercept tool results to add diagnostics.
- Have any "after all tools complete" hook.
- Batch diagnostics at step boundaries.
- Touch the LSP system at all.
Diagnostics are entirely self-contained within each tool's `execute()` return value. By the time `tool-result` fires in the processor, the diagnostic XML is already embedded in `value.output.output`.
---
5. SUMMARY OF KEY FINDINGS
Aspect	Finding
Trigger point	Inside each tool's execute(), AFTER file write, BEFORE return
Mechanism	LSP.touchFile(path, true) then LSP.diagnostics()
Push vs Pull	PUSH: LSP server pushes textDocument/publishDiagnostics notifications
Blocking	waitForDiagnostics blocks with 150ms debounce + 3s hard timeout
Per-file vs Batched	PER-TOOL-CALL. Each edit/write/patch triggers its own touch+diagnostics cycle
Scope (edit)	Only same-file errors (severity === 1)
Scope (write)	Same file + up to 5 other project files with errors
Scope (apply_patch)	Touches all changed files, then one diagnostics() call for all
MultiEdit	N sequential edit calls = N touch+diagnostics cycles
Batch tool	Parallel tool calls, each independently triggers diagnostics
Processor/step lifecycle	No diagnostic awareness. Output arrives pre-baked.
Post-execute hook	None exists
---
6. WHERE TO INTERCEPT FOR END-OF-STEP BATCHING
There are several viable interception points:
Option A: finish-step handler in processor.ts (line 267)
- /Users/dev/lightcodev2/packages/opencode/src/session/processor.ts, lines 267-319.
- This fires after all tool calls in a step complete. You could collect all file paths that were edited during the step, do a single touchFile + diagnostics() call, and inject a synthetic diagnostic part into the message.
- Requires: removing touchFile(path, true) + diagnostics() from each tool, and instead having tools register which files they edited (via ctx.metadata() or a step-level accumulator).
Option B: Between tool-result events and before finish-step
- In the processor's handleEvent, after the last tool-result and before finish-step, you could batch all pending diagnostic checks.
- Challenge: You don't know which tool-result is the last one until finish-step arrives.
Option C: Defer in the tools themselves
- Change LSP.touchFile(path, true) to LSP.touchFile(path, false) (fire-and-forget, like read.ts does on line 219) in edit/write/apply_patch.
- Move diagnostics collection to a new step in finish-step handler.
- The tools would still return their normal output, and diagnostics would be appended as a separate message part after the step completes.
Option D: Add a step-level context/accumulator
- Extend ProcessorContext (processor.ts line 47) with a pendingDiagnosticFiles: Set<string>.
- In tool-result handler, check if the tool was an edit/write/patch tool and add files to the set.
- In finish-step handler, if pendingDiagnosticFiles.size > 0, do a single batched touchFile + diagnostics() and inject results.
Recommended approach: Option C + D combined. Remove the blocking touchFile(path, true) from tools, replace with touchFile(path, false). Accumulate edited file paths via tool metadata. In finish-step, do one batched LSP.diagnostics() call and emit a diagnostic summary part. This eliminates per-tool blocking (150ms debounce + 3s timeout per file per LSP client) and consolidates all diagnostic output.