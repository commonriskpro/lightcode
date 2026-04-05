import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

async function withoutWatcher<T>(fn: () => Promise<T>) {
  if (process.platform !== "win32") return fn()
  const prev = process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
    else process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = prev
  }
}

async function fill(sessionID: SessionID, count: number, time = (i: number) => Date.now() + i) {
  const ids = [] as MessageID[]
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    await Session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: time(i) },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    })
  }
  return ids
}

describe("session messages endpoint", () => {
  test("returns cursor headers for older pages", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const ids = await fill(session.id, 5)
          const app = Server.Default()

          const a = await app.request(`/session/${session.id}/message?limit=2`)
          expect(a.status).toBe(200)
          const aBody = (await a.json()) as MessageV2.WithParts[]
          expect(aBody.map((item) => item.info.id)).toEqual(ids.slice(-2))
          const cursor = a.headers.get("x-next-cursor")
          expect(cursor).toBeTruthy()
          expect(a.headers.get("link")).toContain('rel="next"')

          const b = await app.request(`/session/${session.id}/message?limit=2&before=${encodeURIComponent(cursor!)}`)
          expect(b.status).toBe(200)
          const bBody = (await b.json()) as MessageV2.WithParts[]
          expect(bBody.map((item) => item.info.id)).toEqual(ids.slice(-4, -2))

          await Session.remove(session.id)
        },
      }),
    )
  })

  test("keeps full-history responses when limit is omitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const ids = await fill(session.id, 3)
          const app = Server.Default()

          const res = await app.request(`/session/${session.id}/message`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as MessageV2.WithParts[]
          expect(body.map((item) => item.info.id)).toEqual(ids)

          await Session.remove(session.id)
        },
      }),
    )
  })

  test("rejects invalid cursors and missing sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const app = Server.Default()

          const bad = await app.request(`/session/${session.id}/message?limit=2&before=bad`)
          expect(bad.status).toBe(400)

          const miss = await app.request(`/session/ses_missing/message?limit=2`)
          expect(miss.status).toBe(404)

          await Session.remove(session.id)
        },
      }),
    )
  })

  test("does not truncate large legacy limit requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          await fill(session.id, 520)
          const app = Server.Default()

          const res = await app.request(`/session/${session.id}/message?limit=510`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as MessageV2.WithParts[]
          expect(body).toHaveLength(510)

          await Session.remove(session.id)
        },
      }),
    )
  })
})

describe("session.prompt_async error handling", () => {
  test("prompt_async publishes a session error when detached prompt fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await withoutWatcher(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const app = Server.Default()
          const err = new Error("prompt exploded")
          const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(err)
          const publish = spyOn(Bus, "publish").mockResolvedValue()

          const res = await app.request(`/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
          })

          expect(res.status).toBe(204)
          for (let i = 0; i < 20 && publish.mock.calls.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 0))
          }

          expect(prompt).toHaveBeenCalled()
          expect(publish).toHaveBeenCalledWith(Session.Event.Error, {
            sessionID: session.id,
            error: { name: "UnknownError", data: { message: "prompt exploded" } },
          })

          await Session.remove(session.id)
        },
      }),
    )
  })
})
