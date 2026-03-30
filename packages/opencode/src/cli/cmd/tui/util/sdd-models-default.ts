/** Names shipped with the default template — not removable via the TUI. */
export const SDD_BUILTIN_PROFILE_NAMES = ["balanced", "quality", "economy"] as const

export function isSddBuiltinProfile(name: string) {
  return (SDD_BUILTIN_PROFILE_NAMES as readonly string[]).includes(name)
}

/** Default `.opencode/sdd-models.jsonc` when created from the TUI via `/sdd-models`. */
export const SDD_MODELS_DEFAULT = `{
  "active": "balanced",
  "profiles": {
    "balanced": {},
    "quality": {},
    "economy": {}
  }
}
`
