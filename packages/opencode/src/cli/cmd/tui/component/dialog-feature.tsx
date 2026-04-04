import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { Flag } from "@/flag/flag"
import { useToast } from "../ui/toast"

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
  const toast = useToast()
  const [loading, setLoading] = createSignal<string | null>(null)

  // Local state tracks toggle results immediately without waiting for server roundtrip
  const [local, setLocal] = createSignal<Record<string, boolean>>({})

  function isEnabled(key: string, env: boolean): boolean {
    const l = local()
    if (key in l) return l[key]
    const exp = sync.data.config?.experimental as Record<string, unknown> | undefined
    return exp?.[key] === true || env
  }

  const features = createMemo((): Feature[] => {
    // Track reactive dependencies
    local()
    sync.data.config

    return [
      {
        id: "deferred_tools",
        title: "Deferred Tools",
        description: "Lazy-load tools to reduce context usage",
        env: "OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS",
        config: "deferred_tools",
        enabled: () => isEnabled("deferred_tools", Flag.OPENCODE_EXPERIMENTAL_DEFERRED_TOOLS),
      },
      {
        id: "batch_tool",
        title: "Batch Tool",
        description: "Run multiple tools in parallel",
        config: "batch_tool",
        enabled: () => isEnabled("batch_tool", false),
      },
      {
        id: "continue_loop_on_deny",
        title: "Continue on Deny",
        description: "Keep agent loop running when a tool call is denied",
        config: "continue_loop_on_deny",
        enabled: () => isEnabled("continue_loop_on_deny", false),
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
        enabled: () => isEnabled("openTelemetry", false),
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
        if (!feature.config) return

        const current = feature.enabled()
        const next = !current

        // Update local state immediately for responsive UI
        setLocal((prev) => ({ ...prev, [feature.config!]: next }))
        setLoading(option.value)

        try {
          await sdk.client.config.update({
            config: {
              experimental: { [feature.config]: next },
            },
          })
          toast.show({
            title: feature.title,
            message: next ? "Enabled — takes effect on next session" : "Disabled — takes effect on next session",
            variant: next ? "success" : "info",
            duration: 2000,
          })
        } catch (error) {
          setLocal((prev) => ({ ...prev, [feature.config!]: current }))
          toast.show({
            title: feature.title,
            message: `Failed to toggle: ${error instanceof Error ? error.message : "unknown error"}`,
            variant: "error",
            duration: 3000,
          })
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
