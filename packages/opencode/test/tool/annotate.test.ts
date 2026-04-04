import { describe, test, expect, beforeEach } from "bun:test"
import { NavigationError } from "../../src/tool/browser"
import { AnnotateTool, urlKey } from "../../src/tool/annotate"

// Re-export internals under test — these functions are package-internal,
// so we test observable behaviour via the tool's execute() output.

describe("urlKey", () => {
  test("strips query string and hash", () => {
    expect(urlKey("https://example.com/path?q=1#hash")).toBe("https://example.com/path")
  })

  test("preserves origin + pathname", () => {
    expect(urlKey("http://localhost:3000/foo/bar")).toBe("http://localhost:3000/foo/bar")
  })

  test("falls back to raw string on invalid URL", () => {
    expect(urlKey("not-a-url")).toBe("not-a-url")
  })
})

describe("NavigationError", () => {
  test("invalid_url produces readable message", () => {
    const err = new NavigationError("invalid_url", "ftp://bad")
    expect(err.message).toMatch(/Invalid URL/)
    expect(err.kind).toBe("invalid_url")
  })

  test("timeout produces readable message", () => {
    const err = new NavigationError("timeout", "https://slow.com")
    expect(err.message).toMatch(/Timed out/)
    expect(err.kind).toBe("timeout")
  })

  test("load_failed produces readable message", () => {
    const err = new NavigationError("load_failed", "https://gone.com")
    expect(err.message).toMatch(/Failed to load/)
    expect(err.kind).toBe("load_failed")
  })

  test("ftp:// url throws NavigationError with invalid_url", async () => {
    const { validateUrl } = await import("../../src/tool/browser")
    const err = (() => {
      try {
        validateUrl("ftp://bad")
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(NavigationError)
    expect((err as NavigationError).kind).toBe("invalid_url")
  })

  test("file:// url throws NavigationError with invalid_url", async () => {
    const { validateUrl } = await import("../../src/tool/browser")
    const err = (() => {
      try {
        validateUrl("file:///etc/passwd")
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(NavigationError)
    expect((err as NavigationError).kind).toBe("invalid_url")
  })

  test("bare string throws NavigationError with invalid_url", async () => {
    const { validateUrl } = await import("../../src/tool/browser")
    const err = (() => {
      try {
        validateUrl("not a url")
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(NavigationError)
    expect((err as NavigationError).kind).toBe("invalid_url")
  })
})

describe("AnnotateTool schema", () => {
  test("initialises with correct id", async () => {
    expect(AnnotateTool.id).toBe("annotate")
  })

  test("init() returns parameters and description", async () => {
    const def = await AnnotateTool.init()
    expect(def.description).toBeTruthy()
    expect(def.parameters).toBeTruthy()
  })

  test("action defaults to once", async () => {
    const def = await AnnotateTool.init()
    const parsed = def.parameters.parse({ url: "https://example.com" })
    expect(parsed.action).toBe("once")
  })

  test("mode defaults to picker", async () => {
    const def = await AnnotateTool.init()
    const parsed = def.parameters.parse({ url: "https://example.com" })
    expect(parsed.mode).toBe("picker")
  })

  test("headed defaults to true", async () => {
    const def = await AnnotateTool.init()
    const parsed = def.parameters.parse({ url: "https://example.com" })
    expect(parsed.headed).toBe(true)
  })
})

describe("AnnotateTool cancel when idle", () => {
  test("returns idle status without throwing", async () => {
    const def = await AnnotateTool.init()
    const ctx = {
      sessionID: "test",
      messageID: "msg",
      callID: "call",
      abort: new AbortController().signal,
      agent: "test",
      messages: [],
      metadata: () => {},
      ask: async () => {},
    } as never

    const result = await def.execute(
      {
        action: "cancel",
        mode: "picker",
        headed: false,
        elementScreenshots: false,
        fullPage: false,
        max: 10,
        wait: 0,
        closeOnComplete: true,
      },
      ctx,
    )
    const parsed = JSON.parse(result.output)
    expect(parsed.status).toBe("idle")
  })
})

describe("AnnotateTool complete without session", () => {
  test("throws meaningful error when no session is active", async () => {
    const def = await AnnotateTool.init()
    const ctx = {
      sessionID: "test",
      messageID: "msg",
      callID: "call",
      abort: new AbortController().signal,
      agent: "test",
      messages: [],
      metadata: () => {},
      ask: async () => {},
    } as never

    await expect(
      def.execute(
        {
          action: "complete",
          mode: "picker",
          headed: false,
          elementScreenshots: false,
          fullPage: false,
          max: 10,
          wait: 0,
          closeOnComplete: true,
        },
        ctx,
      ),
    ).rejects.toThrow("No live annotate session")
  })
})

describe("AnnotateTool once — invalid URL", () => {
  test("throws NavigationError for invalid URL", async () => {
    const def = await AnnotateTool.init()
    const ctx = {
      sessionID: "test",
      messageID: "msg",
      callID: "call",
      abort: new AbortController().signal,
      agent: "test",
      messages: [],
      metadata: () => {},
      ask: async () => {},
    } as never

    const err = await def
      .execute(
        {
          action: "once",
          url: "ftp://this.is.not.http",
          mode: "picker",
          headed: false,
          elementScreenshots: false,
          fullPage: false,
          max: 10,
          wait: 0,
          closeOnComplete: true,
        },
        ctx,
      )
      .catch((e) => e)

    expect(err).toBeInstanceOf(NavigationError)
    expect((err as NavigationError).kind).toBe("invalid_url")
  })
})
