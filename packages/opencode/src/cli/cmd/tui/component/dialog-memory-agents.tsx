import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogDreamModel } from "./dialog-dream-model"
import { DialogObserverModel } from "./dialog-observer-model"
import { DialogObserverThresholds } from "./dialog-observer-thresholds"

export function DialogMemoryAgents() {
  const sync = useSync()
  const dialog = useDialog()

  const observer = createMemo(() => {
    const exp = sync.data.config?.experimental as Record<string, unknown> | undefined
    return (exp?.observer_model as string) ?? "opencode/qwen3.6-plus-free"
  })

  const autodream = createMemo(() => {
    const exp = sync.data.config?.experimental as Record<string, unknown> | undefined
    return (exp?.autodream_model as string) ?? "opencode/qwen3.6-plus-free"
  })

  return (
    <DialogSelect
      title="Memory Atlas Agents"
      skipFilter={true}
      flat={true}
      options={[
        {
          value: "observer",
          title: "Observer Agent",
          description: "Configure the background observer model",
          footer: observer(),
        },
        {
          value: "reflector",
          title: "Reflector Agent",
          description: "Configure the reflector model (shared with Observer)",
          footer: observer(),
        },
        {
          value: "autodream",
          title: "AutoDream Agent",
          description: "Configure the hidden dream agent model used on idle sessions",
          footer: autodream(),
        },
        {
          value: "thresholds",
          title: "Observer Thresholds",
          description: "Tune trigger, backpressure, tool cap, and reflection limits",
        },
      ]}
      onSelect={(option) => {
        if (option.value === "observer") dialog.push(() => <DialogObserverModel />)
        if (option.value === "reflector") dialog.push(() => <DialogObserverModel />)
        if (option.value === "autodream") dialog.push(() => <DialogDreamModel />)
        if (option.value === "thresholds") dialog.push(() => <DialogObserverThresholds />)
      }}
    />
  )
}
