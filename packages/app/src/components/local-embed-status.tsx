import { createMemo, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

export function LocalEmbedStatusDropdown() {
  const sync = useGlobalSync()
  const language = useLanguage()

  const phase = createMemo(() => sync.data.router_embed.phase)
  const model = createMemo(() => sync.data.router_embed.model)
  const message = createMemo(() => sync.data.router_embed.message)

  const visible = createMemo(() => phase() !== "idle")

  const dotClass = createMemo(() => {
    const p = phase()
    if (p === "loading") return "bg-icon-warning-base"
    if (p === "ready") return "bg-icon-success-base"
    if (p === "error") return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  const summary = createMemo(() => {
    const p = phase()
    if (p === "loading") return language.t("titlebar.embed.loading")
    if (p === "ready") return language.t("titlebar.embed.ready")
    if (p === "error") return language.t("titlebar.embed.error")
    return ""
  })

  return (
    <Show when={visible()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0 pointer-events-auto"
          aria-label={language.t("titlebar.embed.aria")}
          title={summary()}
        >
          <div class="relative size-4 flex items-center justify-center">
            <Icon
              name={phase() === "loading" ? "download" : phase() === "ready" ? "circle-check" : "circle-x"}
              size="small"
            />
            <div class={`absolute -top-px -right-px size-1.5 rounded-full ${dotClass()}`} />
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="min-w-[260px] max-w-[min(360px,calc(100vw-32px))]">
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="!px-2 !py-1.5 text-12-regular text-text-weak">
                {language.t("titlebar.embed.trigger")}
              </DropdownMenu.GroupLabel>
              <div class="px-2 pb-2 text-12-regular text-text-strong">{summary()}</div>
              <Show when={model()}>
                {(id) => <div class="px-2 pb-2 font-mono text-11-regular text-text-weak break-all">{id()}</div>}
              </Show>
              <Show when={phase() === "error" && message()}>
                <div class="px-2 pb-2 text-11-regular text-icon-critical-base break-words">{message()}</div>
              </Show>
              <div class="px-2 pb-2 text-11-regular text-text-weaker">{language.t("titlebar.embed.detail")}</div>
            </DropdownMenu.Group>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
