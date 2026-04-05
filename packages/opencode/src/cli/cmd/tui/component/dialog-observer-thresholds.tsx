import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "../ui/toast"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

interface Threshold {
  key: string
  title: string
  description: string
  default: string
  placeholder: string
}

const THRESHOLDS: Threshold[] = [
  {
    key: "observer_message_tokens",
    title: "Observer Trigger",
    description: "Message tokens before Observer fires (default: adaptive {min:80000,max:140000})",
    default: "",
    placeholder: 'e.g. 100000 or {"min":80000,"max":140000}',
  },
  {
    key: "observer_block_after",
    title: "Observer Backpressure",
    description: "Ceiling where the main loop waits for OM to catch up (default: 180000)",
    default: "180000",
    placeholder: "e.g. 180000",
  },
  {
    key: "observer_reflection_tokens",
    title: "Reflector Trigger",
    description: "Observation tokens before Reflector compresses (default: 120000)",
    default: "120000",
    placeholder: "e.g. 120000",
  },
  {
    key: "observer_max_tool_result_tokens",
    title: "Tool Result Cap",
    description: "Max tokens per tool result sent to Observer (default: 2000)",
    default: "2000",
    placeholder: "e.g. 2000",
  },
  {
    key: "last_messages",
    title: "Message Safety Cap",
    description: "Max messages in LLM tail before first Observer cycle (default: 80)",
    default: "80",
    placeholder: "e.g. 80",
  },
  {
    key: "observer_prev_tokens",
    title: "Previous Observations Budget",
    description: "Tokens of prior observations passed to Observer (default: 2000)",
    default: "2000",
    placeholder: "e.g. 2000",
  },
]

function currentValue(exp: Record<string, unknown> | undefined, key: string): string {
  const val = exp?.[key]
  if (val === undefined || val === null) return ""
  if (typeof val === "object") return JSON.stringify(val)
  return String(val)
}

export function DialogObserverThresholds() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

  const exp = createMemo(() => sync.data.config?.experimental as Record<string, unknown> | undefined)

  const options = createMemo(() =>
    THRESHOLDS.map((t) => {
      const val = currentValue(exp(), t.key)
      return {
        value: t.key,
        title: t.title,
        description: t.description,
        footer: (
          <span>
            {val ? (
              <span style={{ fg: "#a6e3a1" }}>{val}</span>
            ) : (
              <span style={{ fg: "#6c7086" }}>default ({t.default || "adaptive"})</span>
            )}
          </span>
        ),
      }
    }),
  )

  async function save(key: string, raw: string) {
    const trimmed = raw.trim()
    let parsed: unknown

    if (!trimmed) {
      // Empty = reset to default (set to undefined)
      parsed = undefined
    } else if (trimmed.startsWith("{")) {
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        toast.show({
          title: "Invalid JSON",
          message: 'Use {"min":20000,"max":50000}',
          variant: "error",
          duration: 3000,
        })
        return
      }
    } else {
      const n = parseInt(trimmed, 10)
      if (isNaN(n) || n <= 0) {
        toast.show({
          title: "Invalid value",
          message: "Must be a positive integer or JSON range",
          variant: "error",
          duration: 3000,
        })
        return
      }
      parsed = n
    }

    try {
      await sdk.client.global.config.update({
        config: { experimental: { [key]: parsed } },
      })
      const t = THRESHOLDS.find((x) => x.key === key)!
      toast.show({
        title: t.title,
        message: parsed === undefined ? "Reset to default" : `Set to ${trimmed}`,
        variant: "success",
        duration: 2000,
      })
    } catch (err) {
      toast.show({
        title: "Error",
        message: err instanceof Error ? err.message : "unknown error",
        variant: "error",
        duration: 3000,
      })
    }
  }

  function onSelect(option: DialogSelectOption<string>) {
    const t = THRESHOLDS.find((x) => x.key === option.value)!
    const cur = currentValue(exp(), t.key)
    dialog.push(() => (
      <DialogPrompt
        title={t.title}
        placeholder={t.placeholder}
        value={cur || t.default}
        onConfirm={(val) => {
          void save(t.key, val)
          dialog.clear()
        }}
      />
    ))
  }

  return <DialogSelect title="Observer Thresholds" options={options()} onSelect={onSelect} />
}
