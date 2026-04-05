import { describe, expect, test } from "bun:test"
import { Share } from "./share"

describe("Share", () => {
  test("builds persisted object key", () => {
    expect(Share.object("session/message/abc/msg-1")).toBe("share/session/message/abc/msg-1.json")
  })

  test("builds clear paths for all persisted session objects", () => {
    expect(Share.clear("abc")).toEqual({
      drop: ["share/session/message/abc/", "share/session/part/abc/"],
      del: "share/session/info/abc.json",
    })
  })
})
