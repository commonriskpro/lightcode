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

  describe("setModel", () => {
    test("accepts string model", () => {
      AutoDream.setModel("anthropic/claude-sonnet-4-20250514")
      // No error thrown
    })

    test("accepts undefined to clear model", () => {
      AutoDream.setModel(undefined)
      // No error thrown
    })

    test("accepts model with slash notation", () => {
      AutoDream.setModel("openai/gpt-4o")
      // No error thrown
    })
  })

  describe("setSDK", () => {
    test("accepts SDK-shaped object", () => {
      AutoDream.setSDK({
        session: {
          create: async () => ({ data: { id: "test" } }),
          promptAsync: async () => ({}),
          status: async () => ({ data: {} }),
        },
      })
      // No error thrown
    })
  })

  describe("run() error handling", () => {
    test("returns string on any failure", async () => {
      const result = await AutoDream.run()
      expect(typeof result).toBe("string")
    })

    test("returns string with focus parameter", async () => {
      const result = await AutoDream.run("auth system")
      expect(typeof result).toBe("string")
    })

    test("dreaming() is false after failed run", async () => {
      await AutoDream.run()
      expect(AutoDream.dreaming()).toBe(false)
    })
  })
})
