import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

export namespace Editor {
  /** Open an existing file in VISUAL/EDITOR (blocking). Suspends the TUI while the editor runs. */
  export async function openPath(opts: { filepath: string; renderer: CliRenderer }): Promise<void> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    try {
      const parts = editor.split(" ")
      const proc = Process.spawn([...parts, opts.filepath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
      })
      await proc.exited
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }

  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    try {
      const parts = editor.split(" ")
      const proc = Process.spawn([...parts, filepath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
      })
      await proc.exited
      const content = await Filesystem.readText(filepath)
      return content || undefined
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }
}
