---
description: SDD model profiles — in TUI opens .opencode/sdd-models.jsonc; headless fallback is this hint
agent: build
subtask: false
---

In the **TUI**, **/sdd-models** opens an in-app screen: pick the **active profile**, then each **`sdd-*` agent** to choose a model with the same picker as **/models** (favorites, providers, search). The file `.opencode/sdd-models.jsonc` is updated on disk. Optional env **`OPENCODE_SDD_MODEL_PROFILE`** overrides `active`. See **docs/multi-mode-sdd.md**.
