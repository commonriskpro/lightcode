import { Tool } from "./tool"
import z from "zod"

const WORKFLOW_RUN_DESC = `Run a predefined workflow script.

Workflows are reusable automation sequences that combine multiple steps.
Use this to execute complex multi-step processes.`

const WORKFLOW_LIST_DESC = `List all available workflow scripts.

Shows available workflows with their descriptions and parameters.`

// Workflow definitions
interface Workflow {
  name: string
  description: string
  steps: WorkflowStep[]
}

interface WorkflowStep {
  name: string
  tool: string
  args: Record<string, any>
  condition?: string
}

// Predefined workflows
const PREDEFINED_WORKFLOWS: Record<string, Workflow> = {
  "analyze-codebase": {
    name: "analyze-codebase",
    description: "Full codebase analysis: structure, dependencies, and quality metrics",
    steps: [
      { name: "glob", tool: "glob", args: { pattern: "**/*.{ts,js,json}" } },
      { name: "read-package", tool: "read", args: { path: "package.json" } },
      { name: "list-files", tool: "bash", args: { command: "ls -la" } },
    ],
  },
  "test-coverage": {
    name: "test-coverage",
    description: "Run tests and generate coverage report",
    steps: [
      { name: "install-deps", tool: "bash", args: { command: "npm install" } },
      { name: "run-tests", tool: "bash", args: { command: "npm test -- --coverage" } },
    ],
  },
  "git-status-full": {
    name: "git-status-full",
    description: "Full git status with branch info and changes",
    steps: [
      { name: "status", tool: "bash", args: { command: "git status" } },
      { name: "branch", tool: "bash", args: { command: "git branch -vv" } },
      { name: "diff-staged", tool: "bash", args: { command: "git diff --staged" } },
    ],
  },
}

const workflows = new Map<string, Workflow>(Object.entries(PREDEFINED_WORKFLOWS))

/**
 * Tool for running workflow scripts
 */
export const WorkflowRunTool = Tool.define("workflow_run", async () => ({
  description: WORKFLOW_RUN_DESC,
  parameters: z.object({
    name: z.string().describe("Name of the workflow to run"),
    inputs: z.record(z.string(), z.any()).optional().describe("Input parameters for the workflow"),
  }),
  async execute(params, ctx): Promise<{ title: string; metadata: Record<string, any>; output: string }> {
    const workflow = workflows.get(params.name)

    if (!workflow) {
      return {
        title: "Workflow Not Found",
        metadata: { found: false, name: params.name, steps: undefined },
        output: [
          `Workflow "${params.name}" not found.`,
          "",
          "Available workflows:",
          ...Array.from(workflows.keys()).map((k) => `- ${k}`),
        ].join("\n"),
      }
    }

    const results: string[] = []
    results.push(`## Running workflow: ${workflow.name}`)
    results.push(`Description: ${workflow.description}`)
    results.push("")

    for (const step of workflow.steps) {
      results.push(`### Step: ${step.name}`)
      results.push(`Tool: ${step.tool}`)
      results.push(`Args: ${JSON.stringify(step.args)}`)
      results.push("")
      results.push(`[Would execute: ${step.tool} with ${JSON.stringify(step.args)}]`)
      results.push("")
    }

    return {
      title: "Workflow Executed",
      metadata: { found: true, name: params.name, steps: workflow.steps.length },
      output: results.join("\n"),
    }
  },
}))

/**
 * Tool for listing available workflows
 */
export const WorkflowListTool = Tool.define("workflow_list", async () => ({
  description: WORKFLOW_LIST_DESC,
  parameters: z.object({}),
  async execute(_params, _ctx) {
    const lines = ["## Available Workflows", ""]

    for (const [name, workflow] of workflows) {
      lines.push(`### ${name}`)
      lines.push(workflow.description)
      lines.push(`Steps: ${workflow.steps.length}`)
      lines.push("")
    }

    return {
      title: "Workflows",
      metadata: { count: workflows.size },
      output: lines.join("\n"),
    }
  },
}))
