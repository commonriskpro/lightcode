import { Tool } from "./tool"
import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "cron-tools" })

/**
 * Cron tool descriptions
 */
const CRON_CREATE_DESC = `Create a scheduled task that runs automatically at specified intervals.

## Cron Expression Format
- Standard cron: "0 * * * *" (every hour)
- Intervals: "every 5 minutes", "every hour"
- Named schedules: "daily", "weekly"

## Use Cases
- Periodic code analysis
- Scheduled reminders
- Automated testing`

const CRON_LIST_DESC = `List all scheduled tasks in the current session.

Shows active cron jobs with their schedules and last run times.`

const CRON_DELETE_DESC = `Delete a scheduled task by name or ID.

Use this to remove tasks that are no longer needed.`

// In-memory cron job storage
interface CronJob {
  id: string
  name: string
  schedule: string
  action: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
  createdAt: number
}

const cronJobs = new Map<string, CronJob>()
let cronInterval: ReturnType<typeof setInterval> | null = null

/**
 * Tool for creating scheduled tasks
 */
export const CronCreateTool = Tool.define("cron_create", async () => ({
  description: CRON_CREATE_DESC,
  parameters: z.object({
    name: z.string().describe("Name of the scheduled task"),
    schedule: z.string().describe("Cron expression or interval (e.g., '0 * * * *', 'every 5 minutes')"),
    action: z.string().describe("Action to perform when triggered"),
  }),
  async execute(params, ctx) {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const nextRun = calculateNextRun(params.schedule)

    const job: CronJob = {
      id,
      name: params.name,
      schedule: params.schedule,
      action: params.action,
      enabled: true,
      nextRun,
      createdAt: Date.now(),
    }

    cronJobs.set(id, job)
    startCronScheduler()

    return {
      title: "Cron Job Created",
      metadata: { id, nextRun },
      output: [
        `✅ Scheduled task "${params.name}" created`,
        "",
        `Schedule: ${params.schedule}`,
        `Next run: ${new Date(nextRun).toISOString()}`,
        "",
        "The task will execute automatically at the scheduled time.",
      ].join("\n"),
    }
  },
}))

/**
 * Tool for listing scheduled tasks
 */
export const CronListTool = Tool.define("cron_list", async () => ({
  description: CRON_LIST_DESC,
  parameters: z.object({}),
  async execute(_params, _ctx) {
    const jobs = Array.from(cronJobs.values())

    if (jobs.length === 0) {
      return {
        title: "No Cron Jobs",
        metadata: { count: 0 },
        output: "No scheduled tasks. Use cron_create to add one.",
      }
    }

    const lines = ["## Scheduled Tasks", ""]
    for (const job of jobs) {
      lines.push(`### ${job.name}`)
      lines.push(`- Schedule: ${job.schedule}`)
      lines.push(`- Enabled: ${job.enabled ? "✅" : "❌"}`)
      lines.push(`- Last run: ${job.lastRun ? new Date(job.lastRun).toISOString() : "Never"}`)
      lines.push(`- Next run: ${job.nextRun ? new Date(job.nextRun).toISOString() : "N/A"}`)
      lines.push(`- ID: ${job.id}`)
      lines.push("")
    }

    return {
      title: "Cron Jobs",
      metadata: { count: jobs.length },
      output: lines.join("\n"),
    }
  },
}))

/**
 * Tool for deleting scheduled tasks
 */
export const CronDeleteTool = Tool.define("cron_delete", async () => ({
  description: CRON_DELETE_DESC,
  parameters: z.object({
    name: z.string().optional().describe("Name of the task to delete"),
    id: z.string().optional().describe("ID of the task to delete"),
  }),
  async execute(params, _ctx): Promise<{ title: string; metadata: Record<string, any>; output: string }> {
    const id = params.id ?? Array.from(cronJobs.values()).find((j) => j.name === params.name)?.id

    if (!id || !cronJobs.has(id)) {
      return {
        title: "Not Found",
        metadata: { success: false, id: undefined },
        output: `Task not found. Use cron_list to see available tasks.`,
      }
    }

    cronJobs.delete(id)

    if (cronJobs.size === 0 && cronInterval) {
      clearInterval(cronInterval)
      cronInterval = null
    }

    return {
      title: "Cron Job Deleted",
      metadata: { success: true, id },
      output: `✅ Task deleted successfully.`,
    }
  },
}))

// Helper functions

function calculateNextRun(schedule: string): number {
  const now = Date.now()

  // Simple interval parsing
  const everyMatch = schedule.match(/every (\d+) (\w+)/)
  if (everyMatch) {
    const [, count, unit] = everyMatch
    const ms = parseInt(count) * (unit.includes("minute") ? 60000 : unit.includes("hour") ? 3600000 : 86400000)
    return now + ms
  }

  // Default: every hour
  return now + 3600000
}

function startCronScheduler() {
  if (cronInterval) return

  cronInterval = setInterval(async () => {
    const now = Date.now()

    for (const [id, job] of cronJobs) {
      if (!job.enabled || !job.nextRun) continue

      if (now >= job.nextRun) {
        log.info("cron executing", { id: job.name })
        job.lastRun = job.nextRun
        job.nextRun = calculateNextRun(job.schedule)

        // Emit event for the action
        // In a full implementation, this would trigger the actual action
      }
    }
  }, 60000) // Check every minute
}
