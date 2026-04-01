# Skill Registry

**Orchestrator use only.** Read this registry once per session to resolve skill paths, then pass pre-resolved paths directly to each sub-agent's launch prompt. Sub-agents receive the path and load the skill directly — they do NOT read this registry.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When building AI chat features - breaking changes from v4 | ai-sdk-5 | `/Users/saturno/.config/opencode/skills/ai-sdk-5/SKILL.md` |
| Auditing open issues or PRs, triaging the backlog, reviewing contributor submissions as a maintainer, or applying triage to any GitHub repo | backlog-triage | `/Users/saturno/.config/opencode/skills/backlog-triage/SKILL.md` |
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | `/Users/saturno/.copilot/skills/branch-pr/SKILL.md` |
| When building REST APIs with Django - ViewSets, Serializers, Filters | django-drf | `/Users/saturno/.config/opencode/skills/django-drf/SKILL.md` |
| When writing C# code, | dotnet | `/Users/saturno/.config/opencode/skills/dotnet/SKILL.md` |
| When editing Go files in installer/internal/tui/, working on TUI screens, or adding new UI features | gentleman-bubbletea | `/Users/saturno/.config/opencode/skills/gentleman-bubbletea/SKILL.md` |
| When editing files in installer/e2e/, writing E2E tests, or adding platform support | gentleman-e2e | `/Users/saturno/.config/opencode/skills/gentleman-e2e/SKILL.md` |
| When editing installer | gentleman-installer | `/Users/saturno/.config/opencode/skills/gentleman-installer/SKILL.md` |
| When editing files in installer/internal/system/, adding OS support, or modifying command execution | gentleman-system | `/Users/saturno/.config/opencode/skills/gentleman-system/SKILL.md` |
| When editing files in installer/internal/tui/trainer/, adding exercises, modules, or game mechanics | gentleman-trainer | `/Users/saturno/.config/opencode/skills/gentleman-trainer/SKILL.md` |
| When writing Go tests, using teatest, or adding test coverage | go-testing | `/Users/saturno/Documents/openedit2/gentle-ai/skills/go-testing/SKILL.md` |
| When user asks to release, bump version, update homebrew, or publish a new version | homebrew-release | `/Users/saturno/.config/opencode/skills/homebrew-release/SKILL.md` |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | `/Users/saturno/.copilot/skills/issue-creation/SKILL.md` |
| When user asks to create an epic, large feature, or multi-task initiative | jira-epic | `/Users/saturno/.config/opencode/skills/jira-epic/SKILL.md` |
| When user asks to create a Jira task, ticket, or issue | jira-task | `/Users/saturno/.config/opencode/skills/jira-task/SKILL.md` |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | `/Users/saturno/.copilot/skills/judgment-day/SKILL.md` |
| When user asks to write a comment, reply, review, message, or update in any async communication channel — GitHub, Jira, Slack, Discord, or similar | maintainer-voice | `/Users/saturno/.config/opencode/skills/maintainer-voice/SKILL.md` |
| When working with Next | nextjs-15 | `/Users/saturno/.config/opencode/skills/nextjs-15/SKILL.md` |
| When writing E2E tests - Page Objects, selectors, MCP workflow | playwright | `/Users/saturno/.config/opencode/skills/playwright/SKILL.md` |
| When user wants to review PRs (even if first asking what's open), analyze issues, or audit PR/issue backlog | pr-review | `/Users/saturno/.config/opencode/skills/pr-review/SKILL.md` |
| When writing Python tests - fixtures, mocking, markers | pytest | `/Users/saturno/.config/opencode/skills/pytest/SKILL.md` |
| When writing React components - no useMemo/useCallback needed | react-19 | `/Users/saturno/.config/opencode/skills/react-19/SKILL.md` |
| When creating or editing releases, passing markdown to `gh release create/edit`, or writing shell commands that include backticks | release-note-safety | `/Users/saturno/.config/opencode/skills/release-note-safety/SKILL.md` |
| When hardening a repo, setting up maintainer workflow, tightening contribution gates, auditing repo health, adding issue/PR templates, or transforming a loose repo into a structured OSS-grade project | repo-hardening | `/Users/saturno/.config/opencode/skills/repo-hardening/SKILL.md` |
| When writing Angular components, services, templates, or making architectural decisions about component placement | scope-rule-architect-angular | `/Users/saturno/.config/opencode/skills/angular/SKILL.md` |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | `/Users/saturno/Documents/openedit2/gentle-ai/skills/skill-creator/SKILL.md` |
| When building a presentation, slide deck, course material, stream web, or talk slides | stream-deck | `/Users/saturno/.config/opencode/skills/stream-deck/SKILL.md` |
| When styling with Tailwind - cn(), theme variables, no var() in className | tailwind-4 | `/Users/saturno/.config/opencode/skills/tailwind-4/SKILL.md` |
| When reviewing technical exercises, code assessments, candidate submissions, or take-home tests | technical-review | `/Users/saturno/.config/opencode/skills/technical-review/SKILL.md` |
| When writing TypeScript code - types, interfaces, generics | typescript | `/Users/saturno/.config/opencode/skills/typescript/SKILL.md` |
| When using Zod for validation - breaking changes from v3 | zod-4 | `/Users/saturno/.config/opencode/skills/zod-4/SKILL.md` |
| When managing React state with Zustand | zustand-5 | `/Users/saturno/.config/opencode/skills/zustand-5/SKILL.md` |

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| agents.md | `/Users/saturno/Documents/openedit2/agents.md` | Index — references paths below |
| build.ts | `/Users/saturno/Documents/openedit2/packages/sdk/js/script/build.ts` | Referenced by agents.md |
| AGENTS.md | `/Users/saturno/Documents/openedit2/AGENTS.md` | Index — references paths below |
