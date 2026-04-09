import { describe, expect, spyOn, test } from "bun:test"
import { stat } from "node:fs/promises"
import { HandoffFallback } from "../../src/memory/handoff-fallback"
import { Handoff } from "../../src/memory/handoff"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function handoff(parent: string, child: string) {
  return {
    parent_session_id: parent,
    child_session_id: child,
    context: "ctx",
    working_memory_snap: JSON.stringify([{ key: "k", value: "v" }]),
    observation_snap: "obs",
    metadata: JSON.stringify({ a: 1 }),
  }
}

function fork(parent: string, child: string) {
  return {
    parent_session_id: parent,
    session_id: child,
    context: JSON.stringify({ ctx: 1 }),
  }
}

async function exists(file: string) {
  return stat(file)
    .then(() => true)
    .catch(() => false)
}

describe("memory.handoff-fallback", () => {
  test("replay writes rows and clears file on success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const h = spyOn(Handoff, "writeHandoff").mockResolvedValue("hid")
        const f = spyOn(Handoff, "writeFork").mockResolvedValue()

        await HandoffFallback.append("handoff", handoff("p1", "c1"), new Error("busy"))
        await HandoffFallback.append("fork", fork("p2", "c2"), new Error("busy"))

        const out = await HandoffFallback.replay()
        expect(out.total).toBe(2)
        expect(out.applied).toBe(2)
        expect(out.kept).toBe(0)
        expect(h).toHaveBeenCalledTimes(1)
        expect(f).toHaveBeenCalledTimes(1)
        expect(await exists(out.path)).toBe(false)

        h.mockRestore()
        f.mockRestore()
      },
    })
  })

  test("replay keeps failed rows with incremented tries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const h = spyOn(Handoff, "writeHandoff").mockRejectedValue(new Error("still busy"))

        await HandoffFallback.append("handoff", handoff("p3", "c3"), new Error("first fail"))
        const out = await HandoffFallback.replay()

        expect(out.total).toBe(1)
        expect(out.applied).toBe(0)
        expect(out.kept).toBe(1)
        expect(await exists(out.path)).toBe(true)

        const txt = await Bun.file(out.path).text()
        const [line] = txt.trim().split("\n")
        const row = JSON.parse(line)
        expect(row.tries).toBe(1)
        expect(String(row.error)).toContain("still busy")

        h.mockRestore()
      },
    })
  })
})
