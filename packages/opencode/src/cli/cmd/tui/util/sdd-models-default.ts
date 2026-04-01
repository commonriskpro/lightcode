/** Display order in `/profile` (SDD agents): matches gentle-ai `.opencode/opencode.jsonc` / pipeline (orchestrator first). */
export const SDD_AGENT_PROFILE_ORDER = [
  "sdd-orchestrator",
  "sdd-init",
  "sdd-explore",
  "sdd-propose",
  "sdd-spec",
  "sdd-design",
  "sdd-tasks",
  "sdd-apply",
  "sdd-verify",
  "sdd-archive",
] as const

/** Names shipped with the default template — not removable via the TUI. */
export const SDD_BUILTIN_PROFILE_NAMES = ["balanced", "quality", "economy"] as const

export function isSddBuiltinProfile(name: string) {
  return (SDD_BUILTIN_PROFILE_NAMES as readonly string[]).includes(name)
}

/** Sort key for profile dialog: known `sdd-*` agents follow gentle-ai order; unknown agents last, then by name. */
export function sddAgentProfileRank(name: string): number {
  const list = SDD_AGENT_PROFILE_ORDER as readonly string[]
  const i = list.indexOf(name)
  if (i >= 0) return i
  return list.length
}

/** Default `.opencode/sdd-models.jsonc` when created from the TUI via `/profile`. */
export const SDD_MODELS_DEFAULT = `{
  "active": "balanced",
  "profiles": {
    "balanced": {},
    "quality": {},
    "economy": {}
  }
}
`
