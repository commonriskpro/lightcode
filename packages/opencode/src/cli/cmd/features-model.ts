export type Mode = "vanilla" | "xenova" | "deferred"

export const MODES = [
  {
    mode: "vanilla" as const,
    name: "Vanilla",
    desc: "No router, no deferral (all tools available)",
  },
  {
    mode: "xenova" as const,
    name: "Xenova",
    desc: "Offline router/intent path enabled",
  },
  {
    mode: "deferred" as const,
    name: "Deferred Tools",
    desc: "Load tool schemas on-demand via tool_search",
  },
]

export const FLAGS = {
  xenova: [
    {
      key: "tool_router.router_only",
      name: "Router Only",
      desc: "Strict routing (no no-match bundle)",
      defaultValue: false,
    },
    {
      key: "tool_router.keyword_rules",
      name: "Keyword Rules",
      desc: "Union regex keyword rules into router selection",
      defaultValue: false,
    },
    {
      key: "tool_router.local_intent_embed",
      name: "Local Intent Embed",
      desc: "Use local intent classification for routing",
      defaultValue: false,
    },
    {
      key: "tool_router.auto_tool_selection",
      name: "Auto Tool Selection",
      desc: "Automatic embed-based tool pick by score + token budget",
      defaultValue: false,
    },
    {
      key: "tool_router.fallback.enabled",
      name: "Fallback Expansion",
      desc: "Recover from empty router selection by expanding tools",
      defaultValue: true,
    },
  ],
  deferred: [
    {
      key: "tool_deferral.search_tool",
      name: "Tool Search",
      desc: "Expose tool_search for loading deferred schemas",
      defaultValue: true,
    },
  ],
  extra: [
    {
      key: "agent_swarms",
      name: "Agent Swarms",
      desc: "team_create / send_message / list_peers",
      defaultValue: false,
    },
    {
      key: "workflow_scripts",
      name: "Workflow Scripts",
      desc: "workflow_run / workflow_list",
      defaultValue: false,
    },
    {
      key: "cron_jobs",
      name: "Cron Jobs",
      desc: "cron_create / cron_list / cron_delete",
      defaultValue: false,
    },
    {
      key: "web_browser",
      name: "Web Browser",
      desc: "browser automation tool",
      defaultValue: false,
    },
    {
      key: "context_inspection",
      name: "Context Inspection",
      desc: "ctx_inspect tool",
      defaultValue: false,
    },
    {
      key: "session_hooks",
      name: "Session Hooks",
      desc: "ephemeral per-session hooks",
      defaultValue: false,
    },
  ],
}

export const MODE_KEYS = {
  vanilla: {
    "tool_router.enabled": false,
    "tool_deferral.enabled": false,
  },
  xenova: {
    "tool_router.enabled": true,
    "tool_deferral.enabled": false,
  },
  deferred: {
    "tool_router.enabled": false,
    "tool_deferral.enabled": true,
  },
}

export function get(obj: any, key: string) {
  let cur = obj
  for (const part of key.split(".")) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

export function set(obj: any, key: string, value: unknown) {
  const parts = key.split(".")
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (cur[part] == null || typeof cur[part] !== "object") cur[part] = {}
    cur = cur[part]
  }
  cur[parts[parts.length - 1]] = value
}

export function mode(exp: any): Mode {
  if (get(exp, "tool_deferral.enabled") === true) return "deferred"
  if (get(exp, "tool_router.enabled") === true) return "xenova"
  return "vanilla"
}

export function modePatch(next: Mode) {
  const patch: any = {}
  for (const [key, value] of Object.entries(MODE_KEYS[next])) {
    set(patch, key, value)
  }
  return patch
}

export function allFlags() {
  return [...FLAGS.xenova, ...FLAGS.deferred, ...FLAGS.extra]
}

export function findFlag(name: string) {
  const value = name.toLowerCase().replace(/[^a-z]/g, "")
  return allFlags().find((item) => {
    const key = item.key.replace(/[^a-z]/g, "")
    const label = item.name.toLowerCase().replace(/[^a-z]/g, "")
    return key === value || label === value
  })
}
