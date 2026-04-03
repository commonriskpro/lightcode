/**
 * Canonical **offline** estimates of per-tool definition size as sent to the model.
 *
 * **Includes:** UTF-8 byte length of the tool description string (from `packages/opencode/src/tool/*.txt`
 * where applicable) + JSON Schema byte length from **`z.toJSONSchema(parameters)`** (Zod 4, draft 2020-12 shape;
 * duplicated zod here to avoid importing heavy tool execute paths).
 *
 * **Does not include:** transport framing, provider-specific wrapping, or dynamic description expansion
 * at runtime (e.g. task/skill lists that grow with agents/skills). Task uses a **fixed** representative
 * `{agents}` block; skill uses a **medium** representative catalog blurb — see `notes` on those rows.
 *
 * **Token estimate:** `Math.ceil(utf8Bytes / 4)` — same character-based heuristic as `tool-router.ts` /
 * `prompt.ts` (not BPE).
 */

import { z } from "zod"
import READ_TXT from "../tool/read.txt"
import BASH_TXT from "../tool/bash.txt"
import GREP_TXT from "../tool/grep.txt"
import GLOB_TXT from "../tool/glob.txt"
import EDIT_TXT from "../tool/edit.txt"
import WRITE_TXT from "../tool/write.txt"
import WEBFETCH_TXT from "../tool/webfetch.txt"
import WEBSEARCH_TXT from "../tool/websearch.txt"
import CODESEARCH_TXT from "../tool/codesearch.txt"
import APPLY_PATCH_TXT from "../tool/apply_patch.txt"
import BATCH_TXT from "../tool/batch.txt"
import LSP_TXT from "../tool/lsp.txt"
import PLAN_EXIT_TXT from "../tool/plan-exit.txt"
import TASK_TXT from "../tool/task.txt"
import QUESTION_TXT from "../tool/question.txt"
import TODOWRITE_TXT from "../tool/todowrite.txt"
import { Truncate } from "../tool/truncate"

export type ToolCostBucket = "low" | "medium" | "high"

export type ToolCostRow = {
  id: string
  description_utf8_bytes: number
  description_est_tokens: number
  schema_json_bytes: number
  total_est_bytes: number
  total_est_tokens: number
  cost_rank: number
  bucket: ToolCostBucket
  /** Measurement caveats (dynamic tools, approximations). */
  notes?: string
}

/** Same heuristic as `tool-router.estimateTokens` / `prompt.estimateTokens`. */
export function estimateDefTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

function schemaJsonBytes(schema: z.ZodTypeAny): number {
  /** Zod 4 `toJSONSchema` matches JSON Schema draft 2020-12 (provider tool wire shape). */
  return utf8Bytes(JSON.stringify(z.toJSONSchema(schema)))
}

const BASH_DESC = BASH_TXT.replaceAll("${maxLines}", String(Truncate.MAX_LINES)).replaceAll(
  "${maxBytes}",
  String(Truncate.MAX_BYTES),
)

const TASK_AGENTS_CANON = [
  "- build: Primary build agent for implementation.",
  "- explore: Read-only exploration and search.",
  "- spec: Specification and planning agent.",
].join("\n")

const TASK_DESC = TASK_TXT.replace("{agents}", TASK_AGENTS_CANON)

/** Representative medium catalog (not empty, not huge). */
const SKILL_DESC_CANON = [
  "Load a specialized skill that provides domain-specific instructions and workflows.",
  "",
  "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
  "",
  "The skill will inject detailed instructions, workflows, and access to bundled resources into the conversation context.",
  "",
  'Tool output includes a `<skill_content name="...">` block with the loaded content.',
  "",
  "The following skills provide specialized sets of instructions for particular tasks",
  "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
  "",
  "- explore: Explore the codebase structure.",
  "- refactor: Refactoring workflows.",
  "- sdd-spec: Specification-driven development.",
].join("\n")

const pRead = z.object({
  filePath: z.string().describe("The absolute path to the file or directory to read"),
  offset: z.coerce.number().describe("The line number to start reading from (1-indexed)").optional(),
  limit: z.coerce.number().describe("The maximum number of lines to read (defaults to 2000)").optional(),
})

const pGrep = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
})

const pGlob = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
    ),
})

const pEdit = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
})

const pWrite = z.object({
  content: z.string().describe("The content to write to the file"),
  filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
})

const pWebfetch = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["text", "markdown", "html"])
    .default("markdown")
    .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
  timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
})

const pWebsearch = z.object({
  query: z.string().describe("The search query to look up on the web"),
})

const pCodesearch = z.object({
  query: z
    .string()
    .describe(
      "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
    ),
  tokensNum: z
    .number()
    .min(1000)
    .max(50000)
    .default(5000)
    .describe(
      "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
    ),
})

const pApplyPatch = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

const pBatch = z.object({
  tool_calls: z
    .array(
      z.object({
        tool: z.string().describe("The name of the tool to execute"),
        parameters: z.object({}).loose().describe("Parameters for the tool"),
      }),
    )
    .min(1, "Provide at least one tool call")
    .describe("Array of tool calls to execute in parallel"),
})

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const pLsp = z.object({
  operation: z.enum(operations).describe("The LSP operation to perform"),
  filePath: z.string().describe("The absolute or relative path to the file"),
  line: z.number().int().min(1).describe("The line number (1-based, as shown in editors)"),
  character: z.number().int().min(1).describe("The character offset (1-based, as shown in editors)"),
})

const pPlanExit = z.object({})

const pTask = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

const pSkill = z.object({
  name: z.string().describe("The name of the skill from available_skills (e.g. 'explore', ...)"),
})

const pTodo = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().describe("Brief description of the task"),
        status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
        priority: z.string().describe("Priority level of the task: high, medium, low"),
      }),
    )
    .describe("The updated todo list"),
})

/** Simplified question schema (full tool uses Question.Info — size is in the same ballpark). */
const pQuestion = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        header: z.string().optional(),
        custom: z.boolean().optional(),
        options: z
          .array(
            z.object({
              label: z.string(),
              description: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .describe("Questions to ask"),
})

const pBash = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  workdir: z
    .string()
    .describe(
      `The working directory to run the command in. Defaults to /workspace. Use this instead of 'cd' commands.`,
    )
    .optional(),
  description: z
    .string()
    .describe(
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    ),
})

function row(
  id: string,
  description: string,
  schema: z.ZodTypeAny,
  notes?: string,
): Omit<ToolCostRow, "cost_rank" | "bucket"> {
  const dBytes = utf8Bytes(description)
  const sBytes = schemaJsonBytes(schema)
  const total = dBytes + sBytes
  return {
    id,
    description_utf8_bytes: dBytes,
    description_est_tokens: estimateDefTokens(description),
    schema_json_bytes: sBytes,
    total_est_bytes: total,
    total_est_tokens: Math.ceil(total / 4),
    notes,
  }
}

function bucketFor(total: number): ToolCostBucket {
  if (total < 2_200) return "low"
  if (total < 5_500) return "medium"
  return "high"
}

let _catalog: ToolCostRow[] | undefined

/** Sorted by `total_est_bytes` descending; `cost_rank` 1 = largest on-wire estimate. */
export function getToolCostCatalog(): ToolCostRow[] {
  if (_catalog) return _catalog
  const raw: Omit<ToolCostRow, "cost_rank" | "bucket">[] = [
    row("read", READ_TXT, pRead),
    row("bash", BASH_DESC, pBash),
    row("grep", GREP_TXT, pGrep),
    row("glob", GLOB_TXT, pGlob),
    row("edit", EDIT_TXT, pEdit),
    row("write", WRITE_TXT, pWrite),
    row("webfetch", WEBFETCH_TXT, pWebfetch),
    row("websearch", WEBSEARCH_TXT, pWebsearch),
    row("codesearch", CODESEARCH_TXT, pCodesearch),
    row("apply_patch", APPLY_PATCH_TXT, pApplyPatch),
    row("batch", BATCH_TXT, pBatch),
    row("lsp", LSP_TXT, pLsp),
    row("plan_exit", PLAN_EXIT_TXT, pPlanExit),
    row(
      "task",
      TASK_DESC,
      pTask,
      "Description uses fixed agent list; live task tool injects real agents (size varies).",
    ),
    row(
      "skill",
      SKILL_DESC_CANON,
      pSkill,
      "Live skill tool prepends dynamic skill list to description; this is a medium representative.",
    ),
    row(
      "question",
      QUESTION_TXT,
      pQuestion,
      "Question tool schema is complex; this mirrors the rough JSON Schema size.",
    ),
    row("todowrite", TODOWRITE_TXT, pTodo),
  ]
  const sorted = [...raw].sort((a, b) => b.total_est_bytes - a.total_est_bytes)
  _catalog = sorted.map((r, i) => ({
    ...r,
    cost_rank: i + 1,
    bucket: bucketFor(r.total_est_bytes),
  }))
  return _catalog
}

export function costByToolId(): Map<string, ToolCostRow> {
  const m = new Map<string, ToolCostRow>()
  for (const r of getToolCostCatalog()) m.set(r.id, r)
  return m
}

/** Fallback for unknown tool ids (matches eval harness `dummyTool` one-line description). */
export function fallbackToolCost(id: string): ToolCostRow {
  const description = `Tool ${id}`
  const dBytes = utf8Bytes(description)
  const sBytes = 120
  const total = dBytes + sBytes
  return {
    id,
    description_utf8_bytes: dBytes,
    description_est_tokens: estimateDefTokens(description),
    schema_json_bytes: sBytes,
    total_est_bytes: total,
    total_est_tokens: estimateDefTokens(description) + Math.ceil(sBytes / 4),
    cost_rank: 999,
    bucket: "low",
    notes: "Synthetic fallback (eval dummy tool shape)",
  }
}

export function costForToolId(id: string): ToolCostRow {
  return costByToolId().get(id) ?? fallbackToolCost(id)
}
