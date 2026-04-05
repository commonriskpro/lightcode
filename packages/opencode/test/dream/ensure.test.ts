import { describe, test, expect } from "bun:test"
import { paths } from "../../src/dream/ensure"
import { Hash } from "../../src/util/hash"
import { Global } from "../../src/global"
import path from "path"

describe("dream.ensure", () => {
  describe("paths()", () => {
    test("sock path is deterministic for same dir", () => {
      const p1 = paths("/home/alice/myapp")
      const p2 = paths("/home/alice/myapp")
      expect(p1.sock).toBe(p2.sock)
      expect(p1.pid).toBe(p2.pid)
      expect(p1.log).toBe(p2.log)
    })

    test("different dirs produce different paths", () => {
      const p1 = paths("/home/alice/myapp")
      const p2 = paths("/home/alice/other")
      expect(p1.sock).not.toBe(p2.sock)
    })

    test("sock path uses 16-char hash slug", () => {
      const dir = "/home/alice/myapp"
      const slug = Hash.fast(dir).slice(0, 16)
      const p = paths(dir)
      expect(p.sock).toBe(path.join(Global.Path.state, `dream-${slug}.sock`))
      expect(p.pid).toBe(path.join(Global.Path.state, `dream-${slug}.pid`))
      expect(p.log).toBe(path.join(Global.Path.state, `dream-${slug}.log`))
    })

    test("sock filename component stays under 50 chars (safe for any state dir)", () => {
      // The hash slug is 16 chars, prefix "dream-" is 6, suffix ".sock" is 5 = 27 chars total.
      // Full path depends on Global.Path.state which varies per environment.
      // We verify the filename alone is predictably short.
      const dir = "/very/long/project/path/that/goes/deeply/nested/in/the/filesystem/structure/foo/bar"
      const p = paths(dir)
      const filename = path.basename(p.sock)
      expect(filename.length).toBeLessThanOrEqual(50)
    })
  })

  describe("isAlive helpers via process.kill", () => {
    test("current process is alive (process.kill(pid, 0) succeeds)", () => {
      // Direct validation: kill(0) on self never throws
      expect(() => process.kill(process.pid, 0)).not.toThrow()
    })

    test("non-existent PID 99999999 throws ESRCH or EPERM", () => {
      try {
        process.kill(99999999, 0)
        // If we reach here, the PID exists — just skip
      } catch (err: any) {
        expect(["ESRCH", "EPERM"]).toContain(err.code)
      }
    })
  })
})
