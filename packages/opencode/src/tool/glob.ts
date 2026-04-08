import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("Glob pattern to match files against"),
    path: z.string().optional().describe("Directory to search in"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const limit = 100
    const files = []
    let truncated = false
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
      signal: ctx.abort,
    })) {
      if (files.length >= limit) {
        truncated = true
        break
      }
      const full = path.resolve(search, file)
      const stats = Filesystem.stat(full)?.mtime.getTime() ?? 0
      files.push({
        path: full,
        mtime: stats,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        )
      }
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
