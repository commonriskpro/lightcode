import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { Flag } from "@/flag/flag"

interface Feature {
  id: string
  title: string
  description: string
  env?: string
  config?: string
  enabled: () => boolean
}

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Saving</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogFeature() {
  const sync = useSync()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})

  const features = createMemo((): Feature[] => {
    const cfg = sync.data.config
    const exp = cfg?.experimental
    const ov = overrides()
    return [
      {
        id: "deferred_tools",
        title: "Deferred Tools",
        description: "Lazy-load tools to reduce context usage",
        env: "OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS",
        config: "deferred_tools",
        enabled: () => ov.deferred_tools ?? (exp?.deferred_tools === true || Flag.OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS),
      },
      {
        id: "batch_tool",
        title: "Batch Tool",
        description: "Run multiple tools in parallel",
        config: "batch_tool",
        enabled: () => ov.batch_tool ?? exp?.batch_tool === true,
      },
      {
        id: "continue_loop_on_deny",
        title: "Continue on Deny",
        description: "Keep agent loop running when a tool call is denied",
        config: "continue_loop_on_deny",
        enabled: () => ov.continue_loop_on_deny ?? exp?.continue_loop_on_deny === true,
      },
      {
        id: "lsp_tool",
        title: "LSP Tool",
        description: "Language server diagnostics and hover",
        env: "OPENCODE_EXPERIMENTAL_LSP_TOOL",
        enabled: () => Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL,
      },
      {
        id: "plan_mode",
        title: "Plan Mode",
        description: "Plan before executing",
        env: "OPENCODE_EXPERIMENTAL_PLAN_MODE",
        enabled: () => Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE,
      },
      {
        id: "workspaces",
        title: "Workspaces",
        description: "Multi-workspace support",
        env: "OPENCODE_EXPERIMENTAL_WORKSPACES",
        enabled: () => Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
      },
      {
        id: "markdown",
        title: "Markdown Rendering",
        description: "Render markdown in responses",
        env: "OPENCODE_EXPERIMENTAL_MARKDOWN",
        enabled: () => Flag.OPENCODE_EXPERIMENTAL_MARKDOWN,
      },
      {
        id: "open_telemetry",
        title: "OpenTelemetry",
        description: "Telemetry spans for AI SDK calls",
        config: "openTelemetry",
        enabled: () => ov.openTelemetry ?? exp?.openTelemetry === true,
      },
    ]
  })

  const options = createMemo(() => {
    const current = loading()
    return features().map((f) => ({
      value: f.id,
      title: f.title,
      description: f.config ? f.description : `${f.description} (env only)`,
      footer: <Status enabled={f.enabled()} loading={current === f.id} />,
    }))
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        const feature = features().find((f) => f.id === option.value)
        if (!feature) return

        // Env-only features can't be toggled at runtime
        if (!feature.config) return

        setLoading(option.value)
        try {
          const cfg = sync.data.config
          const key = feature.config as keyof NonNullable<typeof cfg.experimental>
          const current = cfg?.experimental?.[key] === true
          const next = !current

          await sdk.client.config.update({
            config: {
              experimental: { [feature.config]: next },
            },
          })

          // Refresh config from server
          const result = await sdk.client.config.get({}, { throwOnError: true })
          if (result.data) {
            sync.set("config", result.data)
          }
          setOverrides((prev) => ({ ...prev, [feature.id]: next }))
        } catch (error) {
          console.error("Failed to toggle feature:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      title="Features"
      options={options()}
      keybind={keybinds()}
      onSelect={() => {
        // Don't close on select, only on escape
      }}
    />
  )
}
