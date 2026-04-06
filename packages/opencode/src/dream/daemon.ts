import fs from "fs"

const sockPath = process.env.LIGHTCODE_SOCK_PATH ?? ""
const pidPath = process.env.LIGHTCODE_PID_PATH ?? ""
const projectDir = process.env.LIGHTCODE_PROJECT_DIR ?? ""
const serverURL = process.env.LIGHTCODE_SERVER_URL ?? ""

if (!sockPath) {
  console.error("Dream daemon: missing LIGHTCODE_SOCK_PATH")
  process.exit(1)
}

// Module-level state
let dreaming = false
let lastCompleted: number | undefined
let lastError: string | undefined

// Idle self-termination: 10 minutes
const IDLE_MS = 10 * 60 * 1000
let timer: ReturnType<typeof setTimeout>

function shutdown() {
  try {
    fs.unlinkSync(sockPath)
  } catch {}
  process.exit(0)
}

function resetTimer() {
  clearTimeout(timer)
  timer = setTimeout(shutdown, IDLE_MS)
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
          AutoDream.persistConsolidation(
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
    resetTimer()
    const url = new URL(req.url)

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, pid: process.pid })
    }

    if (url.pathname === "/trigger" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { focus?: string; model?: string; obs?: string }
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

console.log(`Dream daemon started (pid=${process.pid}, sock=${sockPath})`)
resetTimer()
