import { describe, test, expect } from "bun:test"
import { Engram } from "../../src/dream/engram"

describe("dream.engram", () => {
  describe("setRegistrar", () => {
    test("accepts a custom registrar function", () => {
      let called = false
      Engram.setRegistrar(async () => {
        called = true
      })
      expect(called).toBe(false)
    })

    test("replacing registrar multiple times is safe", () => {
      Engram.setRegistrar(async () => {})
      Engram.setRegistrar(async () => {})
      Engram.setRegistrar(async () => {})
    })
  })

  describe("bin()", () => {
    test("returns undefined or string", () => {
      const result = Engram.bin()
      expect(result === undefined || typeof result === "string").toBe(true)
    })
  })

  describe("error types", () => {
    test("UnsupportedPlatformError has platform in data", () => {
      const err = new Engram.UnsupportedPlatformError({ platform: "s390x-aix" })
      expect(err.data.platform).toBe("s390x-aix")
      expect(err.name).toBe("EngramUnsupportedPlatformError")
    })

    test("DownloadFailedError has url and status in data", () => {
      const err = new Engram.DownloadFailedError({ url: "https://example.com", status: 404 })
      expect(err.data.url).toBe("https://example.com")
      expect(err.data.status).toBe(404)
      expect(err.name).toBe("EngramDownloadFailedError")
    })

    test("ExtractionFailedError has filepath and stderr in data", () => {
      const err = new Engram.ExtractionFailedError({
        filepath: "/tmp/engram.tar.gz",
        stderr: "tar: Error opening archive",
      })
      expect(err.data.filepath).toBe("/tmp/engram.tar.gz")
      expect(err.data.stderr).toContain("Error opening archive")
      expect(err.name).toBe("EngramExtractionFailedError")
    })

    test("errors are instanceof NamedError", () => {
      const err = new Engram.UnsupportedPlatformError({ platform: "test" })
      expect(err instanceof Error).toBe(true)
    })

    test("toObject() returns serializable form", () => {
      const err = new Engram.DownloadFailedError({ url: "https://x.com", status: 500 })
      const obj = err.toObject()
      expect(obj.name).toBe("EngramDownloadFailedError")
      expect(obj.data.url).toBe("https://x.com")
      expect(obj.data.status).toBe(500)
    })

    test("isInstance() type guard works", () => {
      const err = new Engram.UnsupportedPlatformError({ platform: "test" })
      expect(Engram.UnsupportedPlatformError.isInstance(err)).toBe(true)
      expect(Engram.DownloadFailedError.isInstance(err)).toBe(false)
    })
  })

  describe("ensure()", () => {
    test("returns boolean", async () => {
      const result = await Engram.ensure()
      expect(typeof result).toBe("boolean")
    })
  })
})
