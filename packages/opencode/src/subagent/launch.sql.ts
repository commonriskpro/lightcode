import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

export const SUBAGENT_LAUNCH_MODE = {
  FORK: "fork",
  HANDOFF: "handoff",
} as const

export type SubagentLaunchMode = (typeof SUBAGENT_LAUNCH_MODE)[keyof typeof SUBAGENT_LAUNCH_MODE]

export const SUBAGENT_LAUNCH_STATE = {
  PREPARING: "preparing",
  PREPARED: "prepared",
  STARTING: "starting",
  STARTED: "started",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const

export type SubagentLaunchState = (typeof SUBAGENT_LAUNCH_STATE)[keyof typeof SUBAGENT_LAUNCH_STATE]

export const SubagentLaunchTable = sqliteTable(
  "subagent_launch",
  {
    id: text().primaryKey(),
    parent_session_id: text().notNull(),
    parent_message_id: text().notNull(),
    child_session_id: text().notNull().unique(),
    agent: text().notNull(),
    mode: text().$type<SubagentLaunchMode>().notNull(),
    state: text().$type<SubagentLaunchState>().notNull(),
    description: text().notNull(),
    prompt: text().notNull(),
    model_id: text().notNull(),
    provider_id: text().notNull(),
    snapshot_json: text(),
    error: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [
    index("idx_subagent_launch_child").on(t.child_session_id),
    index("idx_subagent_launch_state").on(t.state),
    index("idx_subagent_launch_parent").on(t.parent_session_id),
  ],
)

export type SubagentLaunchRow = typeof SubagentLaunchTable.$inferSelect
