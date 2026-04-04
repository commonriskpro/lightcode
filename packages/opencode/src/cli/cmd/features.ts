import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"
import { allFlags, findFlag, FLAGS, get, mode, modePatch, MODES, set, type Mode } from "./features-model"

function printSection(title: string, flags: ReturnType<typeof allFlags>) {
  console.log(title)
  for (const item of flags) {
    console.log(`  - ${item.name}`)
    console.log(`    ${item.desc}`)
    console.log(`    experimental.${item.key}`)
  }
  console.log()
}

export const FeaturesCommand = cmd({
  command: "features",
  describe: "list and manage experimental modes and flags",
  builder: (yargs: Argv) =>
    yargs
      .command(FeaturesListCommand)
      .command(FeaturesModeCommand)
      .command(FeaturesEnableCommand)
      .command(FeaturesDisableCommand)
      .demandCommand(),
  async handler() {},
})

const FeaturesListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "List mode and experimental flags",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      const experimental = config.experimental ?? {}
      const current = mode(experimental)
      const currentMode = MODES.find((item) => item.mode === current)!

      console.log("\nExperimental Mode\n")
      console.log(`  ${currentMode.name}`)
      console.log(`  ${currentMode.desc}`)
      console.log()

      console.log("Available modes:")
      for (const item of MODES) {
        const active = item.mode === current ? "[x]" : "[ ]"
        console.log(`  ${active} ${item.mode}`)
      }
      console.log()

      printSection("Mode: xenova (experimental.tool_router.*)", FLAGS.xenova)
      printSection("Mode: deferred (experimental.tool_deferral.*)", FLAGS.deferred)
      printSection("Extra experimental tools", FLAGS.extra)

      const modeFlags = current === "deferred" ? FLAGS.deferred : current === "xenova" ? FLAGS.xenova : []
      if (modeFlags.length > 0) {
        console.log("Current mode flags:")
        for (const item of modeFlags) {
          const value = get(experimental, item.key)
          const enabled = value === true
          const note = value === undefined ? ` (default: ${item.defaultValue ? "enabled" : "disabled"})` : ""
          console.log(`  ${enabled ? "[x]" : "[ ]"} ${item.name}${note}`)
          console.log(`    experimental.${item.key}`)
        }
        console.log()
      }

      console.log("Extra flags:")
      for (const item of FLAGS.extra) {
        const value = get(experimental, item.key)
        const enabled = value === true
        const note = value === undefined ? ` (default: ${item.defaultValue ? "enabled" : "disabled"})` : ""
        console.log(`  ${enabled ? "[x]" : "[ ]"} ${item.name}${note}`)
        console.log(`    experimental.${item.key}`)
      }
      console.log()

      console.log("Use 'opencode features mode <vanilla|xenova|deferred>' to switch mode")
      console.log("Use 'opencode features enable <flag>' to enable a flag")
      console.log("Use 'opencode features disable <flag>' to disable a flag")
      console.log()
    })
  },
})

const FeaturesModeCommand = cmd({
  command: "mode <name>",
  describe: "Switch tool mode: vanilla, xenova, deferred",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "Mode name",
      type: "string",
      demandOption: true,
      choices: MODES.map((item) => item.mode),
    }),
  async handler(args) {
    const next = args.name as Mode
    await bootstrap(process.cwd(), async () => {
      const patch: any = { experimental: {} }
      for (const [key, value] of Object.entries(modePatch(next))) {
        set(patch.experimental, key, value)
      }
      await Config.update(patch)
      const label = MODES.find((item) => item.mode === next)!
      console.log(`✓ Mode: ${label.name}`)
      console.log(`  ${label.desc}`)
      console.log("  Restart OpenCode for changes to take effect.")
      console.log()
    })
  },
})

export const FeaturesEnableCommand = cmd({
  command: "enable <name>",
  describe: "Enable an experimental flag",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "Feature name to enable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    const name = args.name as string
    const matched = findFlag(name)

    if (!matched) {
      console.error(`Unknown flag: ${name}`)
      console.log("Available flags:")
      for (const item of allFlags()) {
        console.log(`  - ${item.name}`)
      }
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const patch: any = { experimental: {} }
      set(patch.experimental, matched.key, true)
      await Config.update(patch)
      console.log(`✓ Enabled: ${matched.name}`)
      console.log(`  Key: experimental.${matched.key}`)
      console.log()
      console.log("Restart OpenCode for changes to take effect.")
    })
  },
})

export const FeaturesDisableCommand = cmd({
  command: "disable <name>",
  describe: "Disable an experimental flag",
  builder: (yargs: Argv) =>
    yargs.positional("name", {
      describe: "Feature name to disable",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    const name = args.name as string
    const matched = findFlag(name)

    if (!matched) {
      console.error(`Unknown flag: ${name}`)
      console.log("Available flags:")
      for (const item of allFlags()) {
        console.log(`  - ${item.name}`)
      }
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const patch: any = { experimental: {} }
      set(patch.experimental, matched.key, false)
      await Config.update(patch)
      console.log(`✓ Disabled: ${matched.name}`)
      console.log(`  Key: experimental.${matched.key}`)
      console.log()
      console.log("Restart OpenCode for changes to take effect.")
    })
  },
})
