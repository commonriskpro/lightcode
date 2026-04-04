import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { Flag } from "@/flag/flag"
import { useToast } from "../ui/toast"
import { DialogDreamModel } from "./dialog-dream-model"
import { DialogObserverModel } from "./dialog-observer-model"

interface Feature {
  id: string
  title: string
  description: string
  env?: string
  config?: string
  /** Model config key — when set, Enter opens the model picker */
  modelConfig?: string
  enabled: () => boolean
  /** Current model string shown as subtitle when configured */
  currentModel?: () => string | undefined
}

function Status(props: { enabled: boolean; loading: boolean; model?: string }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Saving</span>
  }
  if (props.enabled) {
    return (
      <span>
        <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
        {props.model ? <span style={{ fg: theme.textMuted }}> · {props.model}</span> : null}
      </span>
    )
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogFeature() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
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

  function currentModel(key: string): string | undefined {
    const exp = sync.data.config?.experimental as Record<string, unknown> | undefined
    return exp?.[key] as string | undefined
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
      {
        id: "autodream",
        title: "AutoDream",
        description: "Consolidate session memory to Engram when idle",
        env: "OPENCODE_EXPERIMENTAL_AUTODREAM",
        config: "autodream",
        modelConfig: "autodream_model",
        enabled: () => isEnabled("autodream", Flag.OPENCODE_EXPERIMENTAL_AUTODREAM),
        currentModel: () => currentModel("autodream_model"),
      },
      {
        id: "observer",
        title: "Observer Memory",
        description: "Compress message history every 30k tokens (requires Engram)",
        config: "observer",
        modelConfig: "observer_model",
        enabled: () => isEnabled("observer", false),
        currentModel: () => currentModel("observer_model") ?? "google/gemini-2.5-flash",
      },
    ]
  })

  const options = createMemo(() => {
    const cur = loading()
    return features().map((f) => ({
      value: f.id,
      title: f.title,
      description: f.config
        ? f.modelConfig
          ? `${f.description} — enter to configure model`
          : f.description
        : `${f.description} (env only)`,
      footer: (
        <Status
          enabled={f.enabled()}
          loading={cur === f.id}
          model={f.enabled() && f.currentModel ? f.currentModel() : undefined}
        />
      ),
    }))
  })

  function openModelDialog(id: string) {
    if (id === "autodream") {
      dialog.replace(() => <DialogDreamModel />)
    } else if (id === "observer") {
      dialog.replace(() => <DialogObserverModel />)
    }
  }

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
          await sdk.client.global.config.update({
            config: {
              experimental: { [feature.config]: next },
            },
          })
          toast.show({
            title: feature.title,
            message: next ? "Enabled" : "Disabled",
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
      onSelect={(option) => {
        const feature = features().find((f) => f.id === option.value)
        if (feature?.modelConfig) {
          openModelDialog(feature.id)
        }
        // Features without modelConfig don't close on enter — only on escape
      }}
    />
  )
}
