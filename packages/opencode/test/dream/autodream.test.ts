import { describe, test, expect } from "bun:test"
import { AutoDream } from "../../src/dream"

describe("dream.autodream", () => {
  describe("dreaming state", () => {
    test("dreaming() returns false by default", () => {
      expect(AutoDream.dreaming()).toBe(false)
    })

    test("dreaming() returns boolean", () => {
      expect(typeof AutoDream.dreaming()).toBe("boolean")
    })
  })

  describe("run() error handling", () => {
    test("run() throws or rejects when no dir provided", async () => {
      // run() always throws when dir is missing — dreaming flag is always cleaned up
      await expect(AutoDream.run()).rejects.toThrow()
    })

    test("run() throws or rejects when focus provided but no dir", async () => {
      await expect(AutoDream.run("auth system")).rejects.toThrow()
    })

    test("dreaming() is false after failed run", async () => {
      await AutoDream.run().catch(() => {})
      expect(AutoDream.dreaming()).toBe(false)
    })
  })
})
