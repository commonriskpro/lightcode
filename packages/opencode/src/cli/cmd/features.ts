import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"

interface FeatureInfo {
  name: string
  key: string
  description: string
  type: "boolean"
  defaultValue: boolean
}

const FEATURES: FeatureInfo[] = [
  {
    name: "Tool Deferral",
    key: "tool_deferral.enabled",
    description: "Enable tool deferral mechanism (loads tools on-demand)",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Tool Search",
    key: "tool_deferral.search_tool",
    description: "Include ToolSearch tool for loading deferred tools",
    type: "boolean",
    defaultValue: true,
  },
  {
    name: "Agent Swarms",
    key: "agent_swarms",
    description: "Enable agent swarm tools (team_create, send_message, list_peers)",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Workflow Scripts",
    key: "workflow_scripts",
    description: "Enable workflow automation scripts",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Cron Jobs",
    key: "cron_jobs",
    description: "Enable scheduled task tools",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Web Browser",
    key: "web_browser",
    description: "Enable browser automation tool",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Context Inspection",
    key: "context_inspection",
    description: "Enable context inspection tool for debugging",
    type: "boolean",
    defaultValue: false,
  },
  {
    name: "Session Hooks",
    key: "session_hooks",
    description: "Enable session-scoped ephemeral hooks",
    type: "boolean",
    defaultValue: false,
  },
]

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".")
  let current = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}

function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.split(".")
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {}
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

export const FeaturesCommand = cmd({
  command: "features",
  describe: "list and manage experimental features",
  builder: (yargs: Argv) =>
    yargs.command(FeaturesListCommand).command(FeaturesEnableCommand).command(FeaturesDisableCommand).demandCommand(),
  async handler() {},
})

const FeaturesListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "List all experimental features",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      const experimental = config.experimental ?? {}

      console.log("\n📦 Experimental Features\n")

      for (const feature of FEATURES) {
        const currentValue = getNestedValue(experimental, feature.key)
        const isEnabled = currentValue === true
        const status = isEnabled ? "● enabled" : "○ disabled"
        const defaultNote =
          currentValue === undefined ? ` (default: ${feature.defaultValue ? "enabled" : "disabled"})` : ""

        console.log(`${status} ${feature.name}`)
        console.log(`   ${feature.description}${defaultNote}`)
        console.log(`   ${feature.key}`)
        console.log()
      }

      console.log("Use 'opencode features enable <name>' to enable a feature")
      console.log("Use 'opencode features disable <name>' to disable a feature")
      console.log()
    })
  },
})

export const FeaturesEnableCommand = cmd({
  command: "enable <name>",
  describe: "Enable an experimental feature",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "Feature name to enable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    const featureName = args.name as string

    // Normalize the input name to match feature key
    let matchedFeature: FeatureInfo | undefined
    for (const feature of FEATURES) {
      const normalized = feature.key.replace(/^experimental\./, "").replace(/[^a-z]/g, "")
      const inputNormalized = featureName.toLowerCase().replace(/[^a-z]/g, "")
      if (normalized === inputNormalized || feature.name.toLowerCase().replace(/\s/g, "") === inputNormalized) {
        matchedFeature = feature
        break
      }
    }

    if (!matchedFeature) {
      console.error(`Unknown feature: ${featureName}`)
      console.log("Available features:")
      for (const f of FEATURES) {
        console.log(`  - ${f.name}`)
      }
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      const experimental = config.experimental ?? {}

      setNestedValue(experimental, matchedFeature!.key, true)

      await Config.update({ experimental })

      console.log(`✓ Enabled: ${matchedFeature.name}`)
      console.log(`  Key: ${matchedFeature.key}`)
      console.log()
      console.log("Restart OpenCode for changes to take effect.")
    })
  },
})

export const FeaturesDisableCommand = cmd({
  command: "disable <name>",
  describe: "Disable an experimental feature",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "Feature name to disable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    const featureName = args.name as string

    // Normalize the input name to match feature key
    let matchedFeature: FeatureInfo | undefined
    for (const feature of FEATURES) {
      const normalized = feature.key.replace(/^experimental\./, "").replace(/[^a-z]/g, "")
      const inputNormalized = featureName.toLowerCase().replace(/[^a-z]/g, "")
      if (normalized === inputNormalized || feature.name.toLowerCase().replace(/\s/g, "") === inputNormalized) {
        matchedFeature = feature
        break
      }
    }

    if (!matchedFeature) {
      console.error(`Unknown feature: ${featureName}`)
      console.log("Available features:")
      for (const f of FEATURES) {
        console.log(`  - ${f.name}`)
      }
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      const experimental = config.experimental ?? {}

      setNestedValue(experimental, matchedFeature!.key, false)

      await Config.update({ experimental })

      console.log(`✓ Disabled: ${matchedFeature.name}`)
      console.log(`  Key: ${matchedFeature.key}`)
      console.log()
      console.log("Restart OpenCode for changes to take effect.")
    })
  },
})
