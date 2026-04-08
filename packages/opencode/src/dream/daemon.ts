import fs from "fs"
import { Database, eq } from "../storage/db"
import { ObservationTable } from "../session/session.sql"
import { SessionTable } from "../session/session.sql"

const sockPath = process.env.LIGHTCODE_SOCK_PATH ?? ""
const pidPath = process.env.LIGHTCODE_PID_PATH ?? ""
const projectDir = process.env.LIGHTCODE_PROJECT_DIR ?? ""
// serverURL is read dynamically so /trigger can update it at runtime
let serverURL = process.env.LIGHTCODE_SERVER_URL ?? ""

if (!sockPath) {
  console.error("Dream daemon: missing LIGHTCODE_SOCK_PATH")
  process.exit(1)
}

// Module-level state
let dreaming = false
let lastCompleted: number | undefined
let lastError: string | undefined

// Periodic dream interval — 1 hour by default, configurable via env
const DREAM_INTERVAL_MS = Number(process.env.LIGHTCODE_DREAM_INTERVAL_MS ?? 60 * 60 * 1000)

function shutdown() {
  try {
    fs.unlinkSync(sockPath)
  } catch {}
  process.exit(0)
}

// SIGTERM handler — clean up socket, exit
process.on("SIGTERM", () => {
  try {
    fs.unlinkSync(sockPath)
  } catch {}
  process.exit(0)
})

async function retry<T>(fn: () => Promise<T>, maxMs: number): Promise<T> {
  const start = Date.now()
  let delay = 100
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (Date.now() - start + delay > maxMs) throw err
      await Bun.sleep(delay)
      delay = Math.min(delay * 2, 5000)
    }
  }
}

async function doDream(focus?: string, model?: string, obs?: string) {
  try {
    if (!serverURL) throw new Error("LIGHTCODE_SERVER_URL not set")
    console.log("dream daemon trigger", {
      serverURL,
      projectDir,
      focus: focus ?? null,
      model: model ?? null,
      obsChars: obs?.length ?? 0,
    })

    // Import helpers from index.ts (pure functions + writeState)
    const [{ AutoDream }, { default: PROMPT }] = await Promise.all([import("./index"), import("./prompt.txt")])
    const prompt = AutoDream.buildSpawnPrompt(PROMPT, focus, obs)

    const dir = encodeURIComponent(projectDir)
    const qs = projectDir ? `?directory=${dir}` : ""

    // 1. Create dream session — retry for up to 30s if server not ready yet
    const createRes = await retry(
      () =>
        fetch(`${serverURL}/session${qs}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: focus ? `Dream: ${focus}` : "AutoDream consolidation",
          }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.text().catch(() => "")
            throw new Error(`session create ${r.status}${body ? `: ${body}` : ""}`)
          }
          return r
        }),
      30_000,
    )

    const info = (await createRes.json()) as { id: string }
    const sessionID = info.id
    if (!sessionID) throw new Error("session create: no id")

    // 2. Resolve model
    const resolved = model ?? "google/gemini-2.5-flash"
    const parts = resolved.split("/")
    const providerID = parts[0]
    const modelID = parts.slice(1).join("/")

    // 3. Fire prompt async
    await fetch(`${serverURL}/session/${sessionID}/prompt_async${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: { providerID, modelID },
        agent: "dream",
        parts: [{ type: "text", text: prompt }],
      }),
    })

    // 4. Poll for completion — every 2s, up to 300 iterations (10 min)
    for (let i = 0; i < 300; i++) {
      await Bun.sleep(2_000)
      try {
        const r = await fetch(`${serverURL}/session/status${qs}`)
        const data = (await r.json()) as Record<string, { type: string }>
        if (!data[sessionID] || data[sessionID].type === "idle") break
      } catch {}
    }

    // 5. Capture dream output and persist to native memory artifacts (V2).
    //    After the dream session completes, fetch its messages, extract the last
    //    assistant text, and call persistConsolidation() so it lands in memory_artifacts.
    //    This closes the V1 gap where dream output evaporated after session completion.
    try {
      const msgsRes = await fetch(`${serverURL}/session/${sessionID}/message${qs}`)
      if (msgsRes.ok) {
        const msgsData = (await msgsRes.json()) as Array<{
          role: string
          parts: Array<{ type: string; text?: string }>
        }>
        const lastAssistant = [...msgsData].reverse().find((m) => m.role === "assistant")
        const outputText = lastAssistant?.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join("\n")
          .trim()

        if (outputText && outputText.length > 50) {
          await AutoDream.persistConsolidation(
            projectDir,
            focus ? `Dream: ${focus}` : `AutoDream consolidation ${new Date().toISOString().slice(0, 10)}`,
            outputText,
            `dream/${new Date().toISOString().slice(0, 10)}`,
          )
          console.log("dream output persisted to native memory", { sessionID, chars: outputText.length })
        }
      }
    } catch (captureErr) {
      // Non-fatal — dream completed, capture failure does not block state write
      console.warn("dream output capture failed (non-fatal)", {
        error: captureErr instanceof Error ? captureErr.message : String(captureErr),
      })
    }

    // 6. Write state
    await AutoDream.writeState({ lastConsolidatedAt: Date.now(), lastSessionCount: 0 })

    lastCompleted = Date.now()
    lastError = undefined
    console.log("dream completed", { sessionID })
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error("dream daemon error:", lastError)
  } finally {
    dreaming = false
  }
}

// HTTP server over Unix socket
Bun.serve({
  unix: sockPath,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, pid: process.pid })
    }

    if (url.pathname === "/trigger" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        focus?: string
        model?: string
        obs?: string
        serverURL?: string
      }
      // Allow callers to refresh the server URL (e.g. after a server restart)
      if (body.serverURL) serverURL = body.serverURL
      if (dreaming) return Response.json({ ok: true, queued: true })
      dreaming = true
      void doDream(body.focus, body.model, body.obs)
      return Response.json({ ok: true })
    }

    if (url.pathname === "/status") {
      return Response.json({ dreaming, lastCompleted, lastError, serverURL })
    }

    return new Response("not found", { status: 404 })
  },
})

// Probe whether the LightCode server is reachable right now.
// Used to decide if the dreaming animation should be visible in the TUI.
// Best-effort: any error means the server is considered down.
async function serverAlive(): Promise<boolean> {
  if (!serverURL) return false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1_000)
    const r = await fetch(`${serverURL}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

// Collect OM observations for the current project directly from SQLite.
// No HTTP round-trip — the daemon has the DB path available and opens it once.
// Falls back to empty string on any error (best-effort, dream is non-critical).
function collectProjectObsFromDB(): string {
  try {
    // JOIN session_observation ← session WHERE session.directory = projectDir
    // Only include sessions with meaningful observation content (>= 1000 tokens)
    const rows = Database.use((db) =>
      db
        .select({
          observations: ObservationTable.observations,
          reflections: ObservationTable.reflections,
          current_task: ObservationTable.current_task,
          observation_tokens: ObservationTable.observation_tokens,
        })
        .from(ObservationTable)
        .innerJoin(SessionTable, eq(ObservationTable.session_id, SessionTable.id))
        .where(eq(SessionTable.directory, projectDir))
        .all(),
    )

    const parts: string[] = []
    for (const row of rows) {
      if (!row.observation_tokens || row.observation_tokens < 1000) continue
      const acc: string[] = []
      if (row.current_task) acc.push(`<current-task>\n${row.current_task}\n</current-task>`)
      if (row.reflections) acc.push(`<reflections>\n${row.reflections}\n</reflections>`)
      else if (row.observations) acc.push(`<observations>\n${row.observations}\n</observations>`)
      if (acc.length) parts.push(acc.join("\n\n"))
    }

    return parts.join("\n\n---\n\n")
  } catch (err) {
    console.warn("daemon: collectProjectObsFromDB failed", { error: err instanceof Error ? err.message : String(err) })
    return ""
  }
}

// Periodic scheduler: fire dream every DREAM_INTERVAL_MS.
// Reads observations directly from SQLite — no dependency on the server being up.
// If the server IS reachable, the dreaming flag propagates via the unix socket so
// the TUI shows the dream animation while the daemon is working.
async function scheduledDream() {
  if (dreaming) return
  try {
    const obs = collectProjectObsFromDB()
    if (!obs) return // no sessions with OM content — nothing to dream about

    // If the server is alive but we don't have its URL yet, skip the dream —
    // the server will call /trigger manually when it's ready.
    const alive = await serverAlive()
    if (!alive && !serverURL) return

    dreaming = true
    void doDream(undefined, undefined, obs)
  } catch (err) {
    console.warn("scheduled dream skipped", { error: err instanceof Error ? err.message : String(err) })
  }
}

setInterval(scheduledDream, DREAM_INTERVAL_MS)

console.log(`Dream daemon started (pid=${process.pid}, sock=${sockPath}, interval=${DREAM_INTERVAL_MS}ms)`)
