# Gentle-AI Feature Catalog for LightCode Integration

## Repository Overview

**gentle-ai** is a Go-based "ecosystem configurator" that injects skills, memory, workflows, MCP servers, personas, and per-phase model routing into 8 supported AI coding agents (Claude Code, OpenCode, Cursor, VS Code Copilot, Gemini CLI, Codex, Windsurf, Antigravity). The core value is NOT in the Go code — it is in the **markdown instruction files** (skills, orchestrator prompts, protocols) that are language-agnostic and directly portable.

---

## Feature Table

### 1. SDD (Spec-Driven Development) Workflow

| Feature                              | What It Does                                                                                                                                                                                                                                       | Source Location                                                      | Portable to TS CLI?                                     | Priority   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| **SDD Orchestrator**                 | Master coordinator prompt. Maintains thin thread, delegates to sub-agents. DAG: `proposal -> [specs, design] -> tasks -> apply -> verify -> archive`. Manages execution modes, artifact store, model assignments, skill injection, state recovery. | `internal/assets/generic/sdd-orchestrator.md` (218 lines)            | **YES** — pure markdown prompt                          | **HIGH**   |
| **SDD Init**                         | Detects project stack, testing capabilities, resolves Strict TDD mode, bootstraps persistence backend, builds skill registry.                                                                                                                      | `internal/assets/skills/sdd-init/SKILL.md` (354 lines)               | **YES**                                                 | **HIGH**   |
| **SDD Explore**                      | Investigates codebase before committing to a change. Reads code, compares approaches, returns structured analysis.                                                                                                                                 | `internal/assets/skills/sdd-explore/SKILL.md` (129 lines)            | **YES**                                                 | **HIGH**   |
| **SDD Propose**                      | Creates structured change proposal: intent, scope, capabilities, approach, risks, rollback plan. 450 word budget.                                                                                                                                  | `internal/assets/skills/sdd-propose/SKILL.md` (170 lines)            | **YES**                                                 | **HIGH**   |
| **SDD Spec**                         | Writes delta specs with RFC 2119 keywords and Given/When/Then scenarios. ADDED/MODIFIED/REMOVED. 650 word budget.                                                                                                                                  | `internal/assets/skills/sdd-spec/SKILL.md` (225 lines)               | **YES**                                                 | **HIGH**   |
| **SDD Design**                       | Technical design docs: architecture decisions, data flow (ASCII), file changes, interfaces, testing strategy. 800 word budget.                                                                                                                     | `internal/assets/skills/sdd-design/SKILL.md` (165 lines)             | **YES**                                                 | **HIGH**   |
| **SDD Tasks**                        | Phased task breakdown with hierarchical numbering. Foundation → core → integration → testing → cleanup. 530 word budget.                                                                                                                           | `internal/assets/skills/sdd-tasks/SKILL.md` (166 lines)              | **YES**                                                 | **HIGH**   |
| **SDD Apply**                        | Implements tasks following specs/design. Detects testing capabilities, resolves TDD mode. Marks tasks done.                                                                                                                                        | `internal/assets/skills/sdd-apply/SKILL.md` (156 lines)              | **YES**                                                 | **HIGH**   |
| **SDD Verify**                       | Quality gate. Runs tests, builds, coverage. Spec Compliance Matrix (COMPLIANT/FAILING/UNTESTED/PARTIAL). PASS/FAIL verdict.                                                                                                                        | `internal/assets/skills/sdd-verify/SKILL.md` (340 lines)             | **YES**                                                 | **HIGH**   |
| **SDD Archive**                      | Merges delta specs into main specs, moves change to dated archive. Completes SDD cycle.                                                                                                                                                            | `internal/assets/skills/sdd-archive/SKILL.md` (146 lines)            | **YES**                                                 | **MEDIUM** |
| **SDD Onboard**                      | Guided walkthrough: finds real improvement in codebase, walks through full cycle with narration.                                                                                                                                                   | `internal/assets/skills/sdd-onboard/SKILL.md` (213 lines)            | **YES**                                                 | **MEDIUM** |
| **Strict TDD Module**                | RED→GREEN→TRIANGULATE→REFACTOR. Safety net, assertion quality, banned patterns, mock hygiene, pure functions.                                                                                                                                      | `internal/assets/skills/sdd-apply/strict-tdd.md` (364 lines)         | **YES** — one of the most valuable assets               | **HIGH**   |
| **SDD Commands for OpenCode**        | 9 command definitions with YAML frontmatter and dynamic context injection.                                                                                                                                                                         | `internal/assets/opencode/commands/*.md` (9 files)                   | **YES** — directly portable to LightCode command system | **HIGH**   |
| **SDD Agent Overlay (Single Model)** | JSON config: orchestrator + 10 sub-agents with tool permissions and prompt files.                                                                                                                                                                  | `internal/assets/opencode/sdd-overlay-single.json`                   | **YES** — OpenCode format, LightCode can use directly   | **HIGH**   |
| **SDD Agent Overlay (Multi-Model)**  | Same with per-phase model routing via placeholders.                                                                                                                                                                                                | `internal/assets/opencode/sdd-overlay-multi.json`                    | **YES**                                                 | **HIGH**   |
| **OpenSpec Convention**              | File-based persistence: `openspec/config.yaml`, `specs/`, `changes/`, `archive/`.                                                                                                                                                                  | `internal/assets/skills/_shared/openspec-convention.md` (103 lines)  | **YES**                                                 | **MEDIUM** |
| **Persistence Contract**             | 4 modes (engram/openspec/hybrid/none), mode comparison, sub-agent context rules.                                                                                                                                                                   | `internal/assets/skills/_shared/persistence-contract.md` (144 lines) | **YES**                                                 | **MEDIUM** |
| **SDD Phase Common Protocol**        | Shared boilerplate: skill loading, artifact retrieval, persistence, return envelope format.                                                                                                                                                        | `internal/assets/skills/_shared/sdd-phase-common.md` (89 lines)      | **YES**                                                 | **HIGH**   |

### 2. Skills System

| Feature                     | What It Does                                                                                                                                                     | Source Location                                                | Portable?                                 | Priority   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- | ---------- |
| **Skill Registry**          | Scans skills, reads SKILL.md frontmatter, generates compact rules (5-15 line summaries), writes `.atl/skill-registry.md`, saves to engram.                       | `internal/assets/skills/skill-registry/SKILL.md` (201 lines)   | **YES**                                   | **HIGH**   |
| **Skill Resolver Protocol** | Matches skills by code/task context, injects as `## Project Standards (auto-resolved)`. Compaction safety, feedback loop.                                        | `internal/assets/skills/_shared/skill-resolver.md` (114 lines) | **YES**                                   | **HIGH**   |
| **Skill Creator**           | Meta-skill for creating new skills. Structure, frontmatter, naming, content guidelines, registration.                                                            | `internal/assets/skills/skill-creator/SKILL.md` (159 lines)    | **YES**                                   | **MEDIUM** |
| **Go Testing Skill**        | Table-driven tests, Bubbletea TUI testing, golden files.                                                                                                         | `internal/assets/skills/go-testing/SKILL.md` (355 lines)       | **NO** — Go-specific                      | **LOW**    |
| **Judgment Day**            | Parallel adversarial review: TWO blind judges, synthesis (Confirmed/Suspect/Contradiction), classify warnings, fix, re-judge. Convergence threshold, escalation. | `internal/assets/skills/judgment-day/SKILL.md` (350 lines)     | **YES** — one of the most creative skills | **HIGH**   |
| **Branch & PR Skill**       | Branch naming regex, PR body format, conventional commits, automated checks, label system.                                                                       | `internal/assets/skills/branch-pr/SKILL.md` (204 lines)        | **YES**                                   | **HIGH**   |
| **Issue Creation Skill**    | Bug report and feature request templates, required/optional fields, label system, maintainer workflow.                                                           | `internal/assets/skills/issue-creation/SKILL.md` (225 lines)   | **YES**                                   | **MEDIUM** |

### 3. Engram (Persistent Memory)

| Feature                        | What It Does                                                                                          | Source Location                                                   | Portable?                                                  | Priority   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| **Engram MCP Integration**     | Configures Engram MCP server. Resolves binary path, writes config per agent format.                   | `internal/components/engram/inject.go`, `setup.go`                | **PARTIALLY** — LightCode only needs one JSON config entry | **HIGH**   |
| **Engram Protocol**            | System prompt: proactive save triggers, search triggers, session close protocol, compaction recovery. | `internal/assets/claude/engram-protocol.md` (84 lines)            | **YES** — already in your AGENTS.md                        | **HIGH**   |
| **Engram Artifact Convention** | SDD artifact naming: `sdd/{change-name}/{artifact-type}`, topic_key for upserts, 2-step recovery.     | `internal/assets/skills/_shared/engram-convention.md` (128 lines) | **YES**                                                    | **MEDIUM** |

### 4. MCP Server Integrations

| Feature          | What It Does                                                                                                          | Source Location                        | Portable?                     | Priority |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- | -------- |
| **Context7 MCP** | Live framework/library docs via MCP. Remote: `https://mcp.context7.com/mcp` or local: `npx -y @upstash/context7-mcp`. | `internal/components/mcp/context7.go`  | **YES** — 1 JSON config entry | **HIGH** |
| **Engram MCP**   | Persistent memory MCP. Command: `engram mcp --tools=agent`.                                                           | `internal/components/engram/inject.go` | **YES** — 1 JSON config entry | **HIGH** |

### 5. Per-Phase Model Routing

| Feature                    | What It Does                                                                                                           | Source Location                                                  | Portable?                                      | Priority   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- | ---------- |
| **Model Assignment Table** | Maps SDD phases to model tiers. Balanced: orchestrator=opus, explore=sonnet, design=opus, apply=sonnet, archive=haiku. | `internal/model/claude_model.go` (88 lines)                      | **YES** — config option                        | **HIGH**   |
| **Multi-Model Profiles**   | Named profiles (cheap/premium) with per-phase provider/model. Generates suffixed sub-agents.                           | `internal/model/types.go`, `internal/components/sdd/profiles.go` | **PARTIALLY**                                  | **MEDIUM** |
| **Provider Detection**     | Auto-detects available providers via OAuth creds, env vars, subscriptions. Filters to tool_call-capable models.        | `internal/opencode/models.go` (207 lines)                        | **PARTIALLY** — LightCode already handles this | **LOW**    |

### 6. Persona System

| Feature               | What It Does                                                                                                    | Source Location                                           | Portable?         | Priority   |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------- | ---------- |
| **Gentleman Persona** | Senior Architect mentor. Pushes back, explains WHY, construction analogies. Rioplatense Spanish / warm English. | `internal/assets/generic/persona-gentleman.md` (51 lines) | **YES**           | **MEDIUM** |
| **Neutral Persona**   | Same teacher personality, no regional language. Professional and direct.                                        | `internal/assets/generic/persona-neutral.md` (51 lines)   | **YES**           | **MEDIUM** |
| **Custom Persona**    | User brings own persona instructions.                                                                           | Config option                                             | **YES** — trivial | **LOW**    |

### 7. Presets & Configuration

| Feature            | What It Does                                                                           | Source Location      | Portable?                  | Priority   |
| ------------------ | -------------------------------------------------------------------------------------- | -------------------- | -------------------------- | ---------- |
| **Full Gentleman** | All components: Engram + SDD + Skills + Context7 + GGA + Persona + Permissions + Theme | `docs/components.md` | **YES** — concept portable | **MEDIUM** |
| **Ecosystem Only** | Core: Engram + SDD + Skills + Context7 + GGA                                           | Same                 | **YES**                    | **MEDIUM** |
| **Minimal**        | Engram + SDD skills only                                                               | Same                 | **YES**                    | **MEDIUM** |
| **Custom**         | User picks components individually                                                     | Same                 | **YES**                    | **LOW**    |

### 8. Infrastructure (Go-Specific, NOT Portable)

| Feature                     | Why Not Portable                                         |
| --------------------------- | -------------------------------------------------------- |
| **Bubbletea TUI**           | Go-specific. LightCode has SolidJS TUI.                  |
| **Pipeline Orchestration**  | Go infrastructure for multi-agent deployment.            |
| **8-Agent Adapters**        | LightCode only needs to configure itself.                |
| **File Merge System**       | Marker-based injection. Useful pattern but not needed.   |
| **Self-Update**             | LightCode has own distribution.                          |
| **Backup & Restore**        | Go infrastructure.                                       |
| **GGA (provider switcher)** | Separate Go binary. LightCode already handles providers. |
| **Kanagawa Theme**          | Visual theme for specific agents.                        |

---

## Key Insight

> **Everything valuable is pure markdown prompts.** The Go code is just the delivery mechanism. LightCode, being an OpenCode fork, can use the overlay JSONs and SKILL.md files directly without adapting any Go code.

## Top 10 Highest Priority for LightCode

| #   | Feature                       | Files to Copy                                                                                | Value                                |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | **SDD Workflow**              | 10 SKILL.md + orchestrator.md + 3 shared protocols + strict-tdd.md + 9 commands + 2 overlays | Structured development workflow      |
| 2   | **Judgment Day**              | 1 SKILL.md (350 lines)                                                                       | Parallel adversarial review          |
| 3   | **Skill Registry + Resolver** | 2 markdown files                                                                             | Smart skill injection for sub-agents |
| 4   | **Strict TDD Module**         | 1 markdown (364 lines)                                                                       | Thorough TDD enforcement             |
| 5   | **Per-Phase Model Routing**   | Config JSON + 3 presets                                                                      | Cost optimization                    |
| 6   | **Branch & PR Skill**         | 1 SKILL.md                                                                                   | PR quality enforcement               |
| 7   | **Context7 MCP**              | 1 JSON config entry                                                                          | Live framework docs                  |
| 8   | **Engram Protocol**           | Already in AGENTS.md                                                                         | Persistent memory                    |
| 9   | **SDD Agent Overlays**        | 2 JSONs                                                                                      | Ready-to-use agent configs           |
| 10  | **Persona System**            | 2 markdowns (51 lines each)                                                                  | Teaching-oriented persona            |
