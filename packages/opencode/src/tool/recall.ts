import z from "zod"
import { Tool } from "./tool"
import { Database, and, eq, gte, lte } from "../storage/db"
import { MessageTable, PartTable } from "../session/session.sql"
import type { MessageID } from "../session/schema"

export const RecallTool = Tool.define("recall", {
  description:
    "Retrieve messages for an observation group. Use the range from <observation-group range='startId:endId'>.",
  parameters: z.object({
    range: z.string().describe("Message range in format 'startId:endId' from an observation group"),
  }),
  async execute(params, ctx) {
    const parts = params.range.split(":")
    if (parts.length !== 2)
      return { title: "recall", output: "Invalid range format. Expected 'startId:endId'.", metadata: {} }
    const [start, end] = parts as [string, string]

    const rows = (await Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(
          and(
            eq(MessageTable.session_id, ctx.sessionID),
            gte(MessageTable.id, start as MessageID),
            lte(MessageTable.id, end as MessageID),
          ),
        )
        .all(),
    )) as (typeof MessageTable.$inferSelect)[]

    if (!rows.length) return { title: "recall", output: "No messages found for this range.", metadata: {} }

    const budget = 16_000
    let out = ""
    for (const row of rows) {
      const role = row.data.role === "user" ? "User" : "Assistant"
      const msgParts = (await Database.use((db) =>
        db.select().from(PartTable).where(eq(PartTable.message_id, row.id)).all(),
      )) as (typeof PartTable.$inferSelect)[]
      const text = msgParts
        .filter((p) => (p.data as unknown as { type: string }).type === "text")
        .map((p) => (p.data as unknown as { text: string }).text)
        .join("\n")
      if (!text.trim()) continue
      const line = `[${role}]: ${text}\n\n`
      if (out.length + line.length > budget) {
        out += `[...truncated, ${rows.length} messages total]`
        break
      }
      out += line
    }

    return { title: "recall", output: out.trim() || "No text content in range.", metadata: {} }
  },
})
