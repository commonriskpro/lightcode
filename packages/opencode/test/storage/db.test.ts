import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const expected = ["latest", "beta"].includes(Installation.CHANNEL)
      ? path.join(Global.Path.data, "lightcode.db")
      : path.join(Global.Path.data, `lightcode-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
  })

  test("serializes concurrent writes", async () => {
    const out: string[] = []
    const a = Database.write(async () => {
      out.push("a:start")
      await Bun.sleep(25)
      out.push("a:end")
    })
    const b = Database.write(async () => {
      out.push("b:start")
      out.push("b:end")
    })

    await Promise.all([a, b])

    expect(out).toEqual(["a:start", "a:end", "b:start", "b:end"])
  })

  test("allows concurrent reads", async () => {
    const hit = Promise.withResolvers<void>()
    const hold = Promise.withResolvers<void>()
    let open = 0
    let max = 0

    const a = Database.read(async () => {
      open += 1
      max = Math.max(max, open)
      hit.resolve()
      await hold.promise
      open -= 1
    })
    const b = Database.read(async () => {
      await hit.promise
      open += 1
      max = Math.max(max, open)
      open -= 1
    })

    await hit.promise
    hold.resolve()
    await Promise.all([a, b])

    expect(max).toBe(2)
  })

  test("runs post-commit effects after releasing writer gate", async () => {
    const out: string[] = []

    await Database.write(async () => {
      Database.effect(async () => {
        await Database.read(async () => {
          out.push("effect:read")
        })
      })
      out.push("write:done")
    })

    expect(out).toEqual(["write:done", "effect:read"])
  })
})
