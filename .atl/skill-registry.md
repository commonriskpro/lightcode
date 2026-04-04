# Skill Registry — lightcodev2

**Generated**: 2026-04-04
**Project**: lightcodev2
**Source**: ~/.config/opencode/skills/ (user-level)

## Project Conventions

| File                        | Role                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| AGENTS.md                   | Root conventions: naming enforcement, style guide, testing rules |
| packages/opencode/AGENTS.md | Package-level: DB schema, Effect rules, InstanceState patterns   |

### Key Constraints (from AGENTS.md)

- Single-word variable names (MANDATORY for agent code)
- No destructuring — dot notation
- No `try/catch` — use Effect error channels
- No `else` — early returns
- `const` over `let`, ternaries over reassignment
- Tests run from `packages/opencode` only (guard: do-not-run-tests-from-root)
- Type check: `bun typecheck` (uses tsgo, not tsc)

---

## Available Skills

### SDD Workflow

| Skill       | Trigger                                   |
| ----------- | ----------------------------------------- |
| sdd-init    | Initialize SDD in a project               |
| sdd-explore | Explore/investigate ideas before a change |
| sdd-propose | Create change proposal                    |
| sdd-spec    | Write delta specifications                |
| sdd-design  | Technical design document                 |
| sdd-tasks   | Break down into implementation tasks      |
| sdd-apply   | Implement tasks from a change             |
| sdd-verify  | Validate implementation vs specs          |
| sdd-archive | Archive completed change                  |
| sdd-onboard | End-to-end SDD walkthrough                |

### Language & Framework

| Skill      | Trigger                                                 |
| ---------- | ------------------------------------------------------- |
| typescript | TypeScript strict patterns, types, interfaces, generics |
| ai-sdk-5   | Vercel AI SDK 5 patterns — breaking changes from v4     |
| react-19   | React 19 + React Compiler patterns                      |
| nextjs-15  | Next.js 15 App Router                                   |
| angular    | Angular 20+ Scope Rule + Screaming Architecture         |
| tailwind-4 | Tailwind CSS 4 patterns                                 |
| zod-4      | Zod 4 validation — breaking changes from v3             |
| zustand-5  | Zustand 5 state management                              |
| django-drf | Django REST Framework                                   |
| dotnet     | .NET 9 / ASP.NET Core / EF Core                         |

### Testing

| Skill      | Trigger                                  |
| ---------- | ---------------------------------------- |
| playwright | Playwright E2E tests, Page Objects       |
| pytest     | Python testing with pytest               |
| go-testing | Go tests including Bubbletea TUI testing |

### GitHub / OSS

| Skill               | Trigger                                                  |
| ------------------- | -------------------------------------------------------- |
| branch-pr           | Creating PRs in issue-first enforcement system           |
| issue-creation      | Creating GitHub issues                                   |
| pr-review           | Review GitHub PRs and issues                             |
| backlog-triage      | Triage open issues and PRs                               |
| repo-hardening      | Harden repo with contribution gates                      |
| homebrew-release    | Release / bump version / update homebrew                 |
| maintainer-voice    | Write async comments, PR reviews, Slack/Discord messages |
| release-note-safety | Safe patterns for GitHub release notes                   |

### Jira

| Skill     | Trigger           |
| --------- | ----------------- |
| jira-epic | Create Jira epics |
| jira-task | Create Jira tasks |

### Presentation

| Skill       | Trigger                      |
| ----------- | ---------------------------- |
| stream-deck | Slide deck presentation webs |

### Meta

| Skill            | Trigger                                            |
| ---------------- | -------------------------------------------------- |
| skill-creator    | Create new AI agent skills                         |
| skill-registry   | Update this registry                               |
| judgment-day     | Adversarial dual review protocol                   |
| technical-review | Review technical exercises / candidate submissions |

### Gentleman.Dots (installer project)

| Skill               | Trigger                                  |
| ------------------- | ---------------------------------------- |
| gentleman-bubbletea | Bubbletea TUI in installer/internal/tui/ |
| gentleman-e2e       | Docker E2E tests in installer/e2e/       |
| gentleman-installer | Installation steps / installer.go        |
| gentleman-system    | System detection / command execution     |
| gentleman-trainer   | Vim Trainer RPG system                   |

---

## Auto-load Rules

Load these skills BEFORE writing code when context matches:

| Context                                                           | Load Skill                               |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Editing llm.ts, transform.ts, or any streamText/ModelMessage code | `ai-sdk-5`                               |
| Writing TypeScript with strict types, generics, or branded types  | `typescript`                             |
| Writing or modifying test files                                   | (none specific — follow AGENTS.md rules) |
| Creating a GitHub issue                                           | `issue-creation`                         |
| Creating a PR                                                     | `branch-pr`                              |
| Reviewing PRs                                                     | `pr-review`                              |
| Triaging backlog                                                  | `backlog-triage`                         |
