import z from "zod"
import type { Tool } from "./tool"
import { ToolRegistry } from "./registry"
import { Truncate } from "./truncate"

/**
 * ToolSearchTool - allows the LLM to discover and load deferred tool definitions on-demand.
 *
 * When tool_deferral is enabled, tools are marked as deferred (only hints sent to LLM).
 * If the LLM needs a deferred tool, it can call ToolSearch to load the full definition.
 */
export const ToolSearchTool: Tool.Info<
  z.ZodObject<{
    tool_name: z.ZodString
    reason: z.ZodOptional<z.ZodString>
  }>
> = {
  id: "tool_search",
  init: async () => ({
    description: [
      "Search for and load deferred tool definitions by name or description.",
      "",
      "Use this when you need a tool that was not attached to this message or when you receive",
      "a 'defer_loading' error indicating the tool was not fully loaded.",
      "",
      "The model will retry the original tool call after loading the tool definition.",
    ].join("\n"),
    parameters: z.object({
      tool_name: z.string().describe("The exact name of the tool to load (e.g., 'read', 'edit', 'bash')."),
      reason: z.string().optional().describe("Brief explanation of why this tool is needed."),
    }),
    async execute(args, ctx) {
      const { tool_name, reason } = args
      // Import ProviderID and ModelID
      const { ProviderID, ModelID } = await import("../provider/schema")
      const availableTools = await ToolRegistry.tools(
        { modelID: ModelID.make("gpt-4o"), providerID: ProviderID.make("openai") },
        { name: "build", permission: {} } as any,
      )

      const toolDef = availableTools.find((t) => t.id === tool_name)
      if (!toolDef) {
        return {
          title: "Tool Not Found",
          metadata: { found: false, tool_name },
          output: [
            `Tool '${tool_name}' was not found in the registry.`,
            "",
            "Available tools: " + availableTools.map((t) => t.id).join(", "),
          ].join("\n"),
        }
      }

      const truncated = await Truncate.output(toolDef.description, {}, ctx.extra?.agent as any)

      return {
        title: "Tool Loaded",
        metadata: { found: true, tool_name, loaded: true },
        output: [
          `Successfully loaded tool '${tool_name}'.`,
          "",
          "## Tool Definition",
          "",
          `**Description**: ${truncated.content}`,
          "",
          `**Parameters**: ${JSON.stringify(toolDef.parameters._def, null, 2)}`,
          "",
          reason ? `**Reason**: ${reason}` : "",
          "",
          "You can now retry the original tool call.",
        ].join("\n"),
      }
    },
  }),
}
