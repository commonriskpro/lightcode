/**
 * Kitty graphics protocol capability detection.
 *
 * Sends a small probe image and waits for the terminal's response.
 * If the terminal responds with OK, Kitty graphics are supported.
 * Supports tmux passthrough mode.
 */

import { writer } from "./passthrough"

const PROBE_TIMEOUT = 2000

/** Probe the terminal for Kitty graphics protocol support. */
export async function detect(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false

    const cleanup = () => {
      if (done) return
      done = true
      stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      if (str.includes("_Gi=31;OK")) {
        cleanup()
        resolve(true)
      } else if (str.includes("_Gi=31;")) {
        cleanup()
        resolve(false)
      }
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve(false)
    }, PROBE_TIMEOUT)

    stdin.on("data", handler)

    // Send probe through passthrough wrapper if in tmux
    const write = writer(stdout)
    write("\x1b_Gi=31,s=1,v=1,a=q,t=d,f=32;AAAAAA==\x1b\\")
  })
}
