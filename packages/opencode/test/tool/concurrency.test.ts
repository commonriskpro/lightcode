import { describe, test, expect } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"

describe("tool.concurrency", () => {
  describe("Tool.Info.concurrent flag", () => {
    test("defaults to undefined when not set", () => {
      const tool = Tool.define("test", {
        description: "test",
        parameters: z.object({}),
        async execute() {
          return { title: "", output: "", metadata: {} }
        },
      })
      expect(tool.concurrent).toBeUndefined()
    })

    test("preserves concurrent: true when set", () => {
      const tool: Tool.Info = {
        id: "read",
        concurrent: true,
        init: async () => ({
          description: "read",
          parameters: z.object({}),
          async execute() {
            return { title: "", output: "", metadata: {} }
          },
        }),
      }
      expect(tool.concurrent).toBe(true)
    })

    test("preserves concurrent: false when set", () => {
      const tool: Tool.Info = {
        id: "edit",
        concurrent: false,
        init: async () => ({
          description: "edit",
          parameters: z.object({}),
          async execute() {
            return { title: "", output: "", metadata: {} }
          },
        }),
      }
      expect(tool.concurrent).toBe(false)
    })
  })

  describe("promise-chain serializer", () => {
    // Replicates the serializer pattern from prompt.ts
    function makeSerializer() {
      let pending = Promise.resolve()
      function serialize<T>(fn: () => Promise<T>): Promise<T> {
        const next = pending.then(fn, fn)
        pending = next.then(
          () => {},
          () => {},
        )
        return next
      }
      return serialize
    }

    test("serializes concurrent calls to run sequentially", async () => {
      const serialize = makeSerializer()
      const order: number[] = []

      const a = serialize(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 30))
        order.push(2)
        return "a"
      })

      const b = serialize(async () => {
        order.push(3)
        await new Promise((r) => setTimeout(r, 10))
        order.push(4)
        return "b"
      })

      const c = serialize(async () => {
        order.push(5)
        return "c"
      })

      const results = await Promise.all([a, b, c])
      expect(results).toEqual(["a", "b", "c"])
      // a runs first (1,2), then b (3,4), then c (5)
      expect(order).toEqual([1, 2, 3, 4, 5])
    })

    test("safe tools run in parallel while unsafe serialize", async () => {
      const serialize = makeSerializer()
      const timeline: string[] = []

      const safe1 = (async () => {
        timeline.push("safe1-start")
        await new Promise((r) => setTimeout(r, 30))
        timeline.push("safe1-end")
        return "safe1"
      })()

      const safe2 = (async () => {
        timeline.push("safe2-start")
        await new Promise((r) => setTimeout(r, 20))
        timeline.push("safe2-end")
        return "safe2"
      })()

      const unsafe1 = serialize(async () => {
        timeline.push("unsafe1-start")
        await new Promise((r) => setTimeout(r, 10))
        timeline.push("unsafe1-end")
        return "unsafe1"
      })

      const unsafe2 = serialize(async () => {
        timeline.push("unsafe2-start")
        await new Promise((r) => setTimeout(r, 10))
        timeline.push("unsafe2-end")
        return "unsafe2"
      })

      const results = await Promise.all([safe1, safe2, unsafe1, unsafe2])
      expect(results).toEqual(["safe1", "safe2", "unsafe1", "unsafe2"])

      // Safe tools should start before any unsafe finishes
      const safe1Start = timeline.indexOf("safe1-start")
      const safe2Start = timeline.indexOf("safe2-start")
      expect(safe1Start).toBeLessThan(3)
      expect(safe2Start).toBeLessThan(3)

      // Unsafe tools must be sequential
      const unsafe1End = timeline.indexOf("unsafe1-end")
      const unsafe2Start = timeline.indexOf("unsafe2-start")
      expect(unsafe1End).toBeLessThan(unsafe2Start)
    })

    test("error in one serialized call does not block subsequent calls", async () => {
      const serialize = makeSerializer()
      const results: string[] = []

      const a = serialize(async () => {
        throw new Error("fail")
      }).catch((e: Error) => {
        results.push("error:" + e.message)
        return "caught"
      })

      const b = serialize(async () => {
        results.push("b-ran")
        return "b"
      })

      await Promise.all([a, b])
      expect(results).toContain("error:fail")
      expect(results).toContain("b-ran")
    })

    test("serializer handles rapid sequential calls", async () => {
      const serialize = makeSerializer()
      const results: number[] = []

      const promises = Array.from({ length: 20 }, (_, i) =>
        serialize(async () => {
          results.push(i)
          return i
        }),
      )

      const values = await Promise.all(promises)
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i))
      expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i))
    })

    test("serializer with zero-delay tasks preserves order", async () => {
      const serialize = makeSerializer()
      const order: number[] = []

      const promises = Array.from({ length: 100 }, (_, i) =>
        serialize(async () => {
          order.push(i)
        }),
      )

      await Promise.all(promises)
      for (let i = 0; i < 100; i++) {
        expect(order[i]).toBe(i)
      }
    })
  })
})
