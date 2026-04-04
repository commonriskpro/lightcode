import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Process } from "../util/process"
import { which } from "../util/which"
import { lazy } from "../util/lazy"
import { MCP } from "../mcp"
import { Log } from "@/util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export namespace Engram {
  const log = Log.create({ service: "engram" })

  const VERSION = "1.11.0"
  const REPO = "Gentleman-Programming/engram"

  const PLATFORM = {
    "arm64-darwin": "darwin_arm64",
    "x64-darwin": "darwin_amd64",
    "arm64-linux": "linux_arm64",
    "x64-linux": "linux_amd64",
  } as const

  export const UnsupportedPlatformError = NamedError.create(
    "EngramUnsupportedPlatformError",
    z.object({ platform: z.string() }),
  )

  export const DownloadFailedError = NamedError.create(
    "EngramDownloadFailedError",
    z.object({ url: z.string(), status: z.number() }),
  )

  export const ExtractionFailedError = NamedError.create(
    "EngramExtractionFailedError",
    z.object({ filepath: z.string(), stderr: z.string() }),
  )

  const MCP_NAME = "engram"

  async function connected(): Promise<boolean> {
    try {
      const status = await MCP.status()
      return Object.entries(status).some(
        ([name, s]) => name.toLowerCase().includes(MCP_NAME) && s.status === "connected",
      )
    } catch {
      return false
    }
  }

  async function register(bin: string): Promise<void> {
    log.info("auto-registering engram MCP", { bin })
    await MCP.add(MCP_NAME, {
      type: "local" as const,
      command: [bin, "mcp", "--tools=agent"],
    })
  }

  async function download(): Promise<string> {
    const key = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
    const suffix = PLATFORM[key]
    if (!suffix) throw new UnsupportedPlatformError({ platform: key })

    const filename = `engram_${VERSION}_${suffix}.tar.gz`
    const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${filename}`

    log.info("downloading engram", { url })
    const response = await fetch(url)
    if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

    const buf = await response.arrayBuffer()
    const archive = path.join(Global.Path.bin, filename)
    await Filesystem.write(archive, Buffer.from(buf))

    const args = ["tar", "-xzf", archive, "--strip-components=0"]
    if (key.endsWith("-darwin")) args.push("--include=engram")
    if (key.endsWith("-linux")) args.push("--wildcards", "engram")

    const proc = Process.spawn(args, {
      cwd: Global.Path.bin,
      stderr: "pipe",
      stdout: "pipe",
    })
    const exit = await proc.exited
    if (exit !== 0) {
      const { text } = await import("node:stream/consumers")
      const stderr = proc.stderr ? await text(proc.stderr) : ""
      throw new ExtractionFailedError({ filepath: archive, stderr })
    }

    await fs.unlink(archive)

    const bin = path.join(Global.Path.bin, "engram")
    await fs.chmod(bin, 0o755)
    log.info("installed engram", { bin, version: VERSION })
    return bin
  }

  const state = lazy(async () => {
    // 1. Already connected as MCP client?
    if (await connected()) {
      log.info("engram MCP already connected")
      return { bin: "engram", registered: false }
    }

    // 2. In PATH?
    const system = which("engram")
    if (system) {
      const stat = await fs.stat(system).catch(() => undefined)
      if (stat?.isFile()) {
        await register(system)
        return { bin: system, registered: true }
      }
    }

    // 3. In cache?
    const cached = path.join(Global.Path.bin, "engram")
    if (await Filesystem.exists(cached)) {
      await register(cached)
      return { bin: cached, registered: true }
    }

    // 4. Download
    const bin = await download()
    await register(bin)
    return { bin, registered: true }
  })

  export async function ensure(): Promise<boolean> {
    try {
      await state()
      return true
    } catch (err) {
      log.warn("engram not available", { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  export async function bin(): Promise<string> {
    const s = await state()
    return s.bin
  }
}
