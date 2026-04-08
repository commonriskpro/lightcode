import z from "zod"
import { Tool } from "./tool"

export const InvalidTool = Tool.define("invalid", {
  description: "Do not use",
  parameters: z.object({
    tool: z.string(),
    error: z.string(),
  }),
  async execute(params) {
    return {
      title: "Invalid Tool",
      output: `Tool "${params.tool}" is not available or was called with invalid arguments: ${params.error}. Do not retry this tool call — use one of the available tools instead.`,
      metadata: {},
    }
  },
})
