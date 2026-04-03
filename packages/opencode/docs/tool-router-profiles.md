# Tool router: recommended profiles and copy-paste config

Offline router + optional **exposure** (what tool definitions are attached after routing). Defaults in code stay **conservative**; use these snippets in **`opencode.json` / `opencode.jsonc`** under `experimental.tool_router`.

## Quick picks

| Goal | Profile | `exposure_mode` |
|------|---------|-----------------|
| **Regression / CI** | **A — safe** | `per_turn_subset` |
| **Daily testing (recommended)** | **B — main experiment** | `subset_plus_memory_reminder` |
| **Unlock once, keep callable** | **C — session accumulative** | `session_accumulative_callable` |
| **Empty selection recovery stress** | **D — aggressive recovery** | `subset_plus_memory_reminder` + `recover_empty_without_signal` |

## Harness presets (`script/router-eval.ts`)

Same ideas as below, runnable with `--profile safe|experiment|session_accumulative|aggressive_recovery` (see `package.json` scripts `router:eval:reviewed:*`).

- **`--exposure-mode`** after `--profile` overrides only `exposure_mode`.
- **Pass/fail** in eval is still from **router `selected` ids**; exposure changes **attached defs + reminder + memory** metrics.

---

## PROFILE A — safe default

Minimal surprise; matches **`defaultEvalRouterConfig`** / reviewed gate expectations.

```jsonc
"experimental": {
  "tool_router": {
    "enabled": true,
    "mode": "hybrid",
    "keyword_rules": false,
    "local_intent_embed": true,
    "local_embed": true,
    "exposure_mode": "per_turn_subset",
    "fallback": {
      "enabled": true,
      "max_expansions_per_turn": 1,
      "expand_to": "full",
      "recover_empty_without_signal": false
    }
  }
}
```

---

## PROFILE B — main experiment (balanced)

**Recommended for daily manual testing:** keyword **RULES** union + intent/embed + reminder line for unlocked tools (not necessarily re-attached).

```jsonc
"experimental": {
  "tool_router": {
    "enabled": true,
    "mode": "hybrid",
    "keyword_rules": true,
    "local_intent_embed": true,
    "local_embed": true,
    "exposure_mode": "subset_plus_memory_reminder",
    "fallback": {
      "enabled": true,
      "max_expansions_per_turn": 1,
      "expand_to": "full",
      "recover_empty_without_signal": false
    }
  }
}
```

---

## PROFILE C — unlock once, keep callable

Union of **router output** with **prior session callable** ids (still ∩ permissions). Grows monotonically until a new session.

```jsonc
"experimental": {
  "tool_router": {
    "enabled": true,
    "mode": "hybrid",
    "keyword_rules": true,
    "local_intent_embed": true,
    "local_embed": true,
    "exposure_mode": "session_accumulative_callable",
    "fallback": {
      "enabled": true,
      "max_expansions_per_turn": 1,
      "expand_to": "full",
      "recover_empty_without_signal": false
    }
  }
}
```

---

## PROFILE D — aggressive recovery (B + flag)

Same as B, but **`recover_empty_without_signal: true`**: may expand when the router returns **empty** even **without** intent/rule/sticky signal. Use for experiments; can attach more tools on weak prompts.

```jsonc
"experimental": {
  "tool_router": {
    "enabled": true,
    "mode": "hybrid",
    "keyword_rules": true,
    "local_intent_embed": true,
    "local_embed": true,
    "exposure_mode": "subset_plus_memory_reminder",
    "fallback": {
      "enabled": true,
      "max_expansions_per_turn": 1,
      "expand_to": "full",
      "recover_empty_without_signal": true
    }
  }
}
```

---

## Practical flags (short)

| Flag | Effect |
|------|--------|
| **`keyword_rules`** | `false` (default): intent + embeddings + policy. `true`: also union **regex RULES** in `tool-router.ts` (create file, edit, shell, …). |
| **`local_intent_embed`** | Hybrid: classify intent vs prototypes (incl. **conversation**); merge tools before RULES; conversation tier → no tools. |
| **`fallback.enabled`** | If router would attach **no** tools (non-conversation), **expand** to allowed pool (see `expand_to`). |
| **`fallback.recover_empty_without_signal`** | If `true`, also recover when empty **and** there was no routing signal (stricter cases / router_only). |

---

## Manual multi-turn checklist (chat)

1. **Conversation** → then **read** → **write** → **edit** → **bash** → **web** → **codesearch** in separate turns.  
2. **Inspect:** `debug_request` / logs; assistant fields **`toolExposureUnlockedIds`**, **`toolExposureSessionCallableIds`** (see `tool-exposure.ts`).  
3. **Reminder** (B): text line listing unlocked ids **without** necessarily attaching defs. **Callable** (C): merged tool **defs** can stay larger across turns.

---

## One-command comparisons (offline)

```bash
# Reviewed dataset, compare exposure cost (router pass rate unchanged)
bun run script/router-eval.ts -- --reviewed --compare-exposure per_turn_subset session_accumulative

# Same with harness profile B (keyword_rules + fallback + subset reminder)
bun run script/router-eval.ts -- --reviewed --profile experiment --compare-exposure per_turn_subset subset_plus_memory_reminder
```

See **`docs/router-eval.md`** for all CLI flags and **`router:eval:scenarios`** for multi-turn scenario battery.
