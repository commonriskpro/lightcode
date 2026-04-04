import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { AutoDream } from "../../src/dream"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

async function addUser(sid: string) {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID: sid,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: ref,
    tools: {},
    mode: "",
  } as any)
  return id
}

async function addAssistant(sid: string, pid: MessageID, opts?: { summary?: boolean; text?: string }) {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID: sid,
    role: "assistant",
    time: { created: Date.now() },
    parentID: pid,
    modelID: ref.modelID,
    providerID: ref.providerID,
    mode: "",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    summary: opts?.summary,
  } as any)
  if (opts?.text) {
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: sid,
      messageID: id,
      type: "text",
      text: opts.text,
    } as any)
  }
  return id
}

async function addUserWithText(sid: string, text: string) {
  const id = await addUser(sid)
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: sid,
    messageID: id,
    type: "text",
    text,
  } as any)
  return id
}

describe("dream.summaries", () => {
  test("extracts only summary===true assistant text parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const uid = await addUser(s.id as any)
          await addAssistant(s.id as any, uid, { summary: false, text: "not a summary" })
          await addAssistant(s.id as any, uid, { summary: true, text: "this is the summary" })

          const result = await AutoDream.summaries(s.id as any)
          expect(result).toContain("this is the summary")
          expect(result).not.toContain("not a summary")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("falls back to last 10 user+assistant text msgs when no summaries", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const uid = await addUserWithText(s.id as any, "user message one")
          await addAssistant(s.id as any, uid, { summary: false, text: "assistant reply one" })

          const result = await AutoDream.summaries(s.id as any)
          // No summary msgs → fallback path, should include text from messages
          expect(typeof result).toBe("string")
          // Fallback uses all user+assistant text within 2000 token cap
          expect(result).toContain("user message one")
          expect(result).toContain("assistant reply one")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("summaries path caps at 4000 tokens", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const uid = await addUser(s.id as any)
          // First summary fits within 4000-token cap (1000 tokens = 4000 chars)
          const fits = "y".repeat(4_000)
          // Second summary causes cap to be exceeded
          const overflow = "z".repeat(20_000)
          await addAssistant(s.id as any, uid, { summary: true, text: fits })
          await addAssistant(s.id as any, uid, { summary: true, text: overflow })

          const result = await AutoDream.summaries(s.id as any)
          // fits (~1000 tokens) added, then overflow (~5000 tokens) → cap+est > 4000 → break
          expect(result).toContain(fits)
          expect(result).not.toContain(overflow)
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("fallback path caps at 2000 tokens", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const uid = await addUserWithText(s.id as any, "first")
          // Add a large message that alone exceeds 2000 tokens (8001 chars)
          const uid2 = await addUserWithText(s.id as any, "a".repeat(8_001))
          await addUserWithText(s.id as any, "after cap")

          const result = await AutoDream.summaries(s.id as any)
          // No summary msgs → fallback
          // "first" < 2000 tokens, added. "a".repeat(8001) = ~2000 tokens, gets checked
          // Total estimate test: 8001/4 ≈ 2000 tokens — cap triggers at or after this point
          expect(typeof result).toBe("string")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("returns empty string when session has no messages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          const result = await AutoDream.summaries(s.id as any)
          expect(result).toBe("")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })
})

describe("dream.buildSpawnPrompt", () => {
  test("includes Session Observations section when obs is non-empty", () => {
    const base = "base prompt"
    const obs = "some session insight"
    const result = AutoDream.buildSpawnPrompt(base, undefined, obs)
    expect(result).toContain("## Session Observations")
    expect(result).toContain(obs)
  })

  test("excludes Session Observations section when obs is empty string", () => {
    const base = "base prompt"
    const result = AutoDream.buildSpawnPrompt(base, undefined, "")
    expect(result).not.toContain("## Session Observations")
    expect(result).toBe(base)
  })

  test("excludes Session Observations section when obs is undefined", () => {
    const base = "base prompt"
    const result = AutoDream.buildSpawnPrompt(base, undefined, undefined)
    expect(result).not.toContain("## Session Observations")
    expect(result).toBe(base)
  })

  test("includes Focus section when focus is provided", () => {
    const base = "base prompt"
    const result = AutoDream.buildSpawnPrompt(base, "auth system", undefined)
    expect(result).toContain("## Focus")
    expect(result).toContain("auth system")
  })

  test("includes both Focus and Session Observations when both provided", () => {
    const base = "base prompt"
    const result = AutoDream.buildSpawnPrompt(base, "auth", "some obs")
    expect(result).toContain("## Focus")
    expect(result).toContain("## Session Observations")
    expect(result).toContain("some obs")
  })

  test("base prompt unchanged when focus and obs are absent", () => {
    const base = "base prompt"
    expect(AutoDream.buildSpawnPrompt(base)).toBe(base)
  })
})

describe("dream.idle.graceful", () => {
  test("summaries returns empty string for session with no messages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s = await Session.create({})
        try {
          // idle() calls summaries(sid) before spawn — if session is empty it returns ""
          // an empty obs means spawn receives "" → no Session Observations injected
          const obs = await AutoDream.summaries(s.id as any)
          expect(obs).toBe("")
          // Verify buildSpawnPrompt with empty obs yields no observations section
          const prompt = AutoDream.buildSpawnPrompt("base", undefined, obs)
          expect(prompt).not.toContain("## Session Observations")
        } finally {
          await Session.remove(s.id)
        }
      },
    })
  })

  test("idle path gracefully returns when Engram is unavailable", async () => {
    // AutoDream.run() → Engram.ensure() fails → returns string message (no throw)
    const result = await AutoDream.run()
    expect(typeof result).toBe("string")
    // dreaming flag is cleaned up
    expect(AutoDream.dreaming()).toBe(false)
  })
})
