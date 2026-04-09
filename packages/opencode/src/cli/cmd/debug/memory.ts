import { cmd } from "../cmd"
import { bootstrap, userCwd } from "../../bootstrap"
import { HandoffFallback } from "@/memory/handoff-fallback"

const ReplayCommand = cmd({
  command: "replay",
  describe: "replay persisted handoff/fork fallback records",
  async handler() {
    await bootstrap(userCwd(), async () => {
      const out = await HandoffFallback.replay()
      console.log(
        JSON.stringify(
          {
            total: out.total,
            applied: out.applied,
            kept: out.kept,
            path: out.path,
          },
          null,
          2,
        ),
      )
    })
  },
})

export const MemoryCommand = cmd({
  command: "memory",
  describe: "memory recovery tools",
  builder: (yargs) => yargs.command(ReplayCommand).demandCommand(),
  handler: async () => {},
})
