Now I have a comprehensive understanding of the architecture. Let me provide you with a detailed architectural diagram and explanation:
---
OpenCode Architecture Analysis
1. Tool System Architecture
Tool Registration & Discovery
┌─────────────────────────────────────────────────────────────────────┐
│                        Tool Registry Layer                           │
│                    (src/tool/registry.ts)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│  │ Built-in     │    │ Custom Tools     │    │ Plugin Tools     │ │
│  │ Tools        │    │ (config dirs)    │    │                  │ │
│  │              │    │                  │    │                  │ │
│  │ - bash       │    │ {tool,tools}/    │    │ plugin.tool      │ │
│  │ - read       │    │   *.ts files     │    │ (from hooks)     │ │
│  │ - edit       │    │                  │    │                  │ │
│  │ - grep       │    │ Scanned via     │    │ Registered by    │ │
│  │ - glob       │    │ Glob.scanSync()  │    │ Plugin.Service   │ │
│  │ - write      │    │                  │    │                  │ │
│  │ - task       │    │ Each file exports│    │ Extracted via    │ │
│  │ - webfetch   │    │ ToolDefinitions  │    │ plugin.list()    │ │
│  │ - websearch  │    │                 │    │                  │ │
│  │ - codesearch │    │                 │    │                  │ │
│  │ - skill      │    │                 │    │                  │ │
│  │ - todowrite  │    │                 │    │                  │ │
│  │ - batch      │    │                 │    │                  │ │
│  │ - plan       │    │                 │    │                  │ │
│  │ - lsp        │    │                 │    │                  │ │
│  └──────────────┘    └──────────────────┘    └──────────────────┘ │
│         │                     │                      │            │
│         └─────────────────────┼──────────────────────┘            │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Tool.Info[] custom  │                        │
│                    │ (merged at startup) │                        │
│                    └─────────────────────┘                        │
│                               │                                    │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │  ToolRegistry.all() │                        │
│                    │  - Filters by model  │                        │
│                    │  - Handles flags     │                        │
│                    │  - Triggers hooks    │                        │
│                    └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
Tool Definition Structure (src/tool/tool.ts)
Tool.Info = {
  id: string                    // Unique identifier
  init: (ctx?) => Promise<{
    description: string         // Shown to LLM
    parameters: ZodSchema      // Input validation
    execute: (args, ctx) => {
      title: string
      metadata: {...}
      output: string
      attachments?: FilePart[]
    }
    formatValidationError?: (e) => string
  }>
}
Tool Execution Flow
┌─────────────────────────────────────────────────────────────────────┐
│                      Tool Execution Pipeline                         │
└─────────────────────────────────────────────────────────────────────┘
User/Model Call
      │
      ▼
┌─────────────────┐
│ ToolRouter.apply│ ─── Offline routing decision
│ (tool-router.ts)│     Based on intent/keywords/embeddings
└─────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LLM.stream()                               │
│                     (session/llm.ts)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │ resolveTools │────▶│ streamText() │────▶│ tool.execute│    │
│  │              │     │              │     │              │    │
│  │ - Registry   │     │ - AI SDK     │     │ - Plugin     │    │
│  │ - MCP tools  │     │ - Provider   │     │   hooks      │    │
│  │ - Permission │     │   transform  │     │ - Truncate   │    │
│  │   filtering  │     │ - Headers    │     │ - Output     │    │
│  └──────────────┘     └──────────────┘     └──────────────┘    │
│         │                     │                    │            │
└─────────┼─────────────────────┼────────────────────┘────────────┘
          │                     │
          ▼                     ▼
┌─────────────────┐    ┌─────────────────┐
│ SessionProcessor│    │   Events       │
│                 │    │                 │
│ - tool-input-*  │    │ - tool-result   │
│ - tool-call     │    │ - tool-error    │
│ - text-delta    │    │ - error         │
│ - finish-step   │    │ - finish        │
└─────────────────┘    └─────────────────┘
---
2. Offline Tool Router Implementation (session/tool-router.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                     Offline Tool Router (ToolRouter.apply)            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Input:                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ - tools: Record<string, AITool>    (after initial tier)      │  │
│  │ - registryTools: full tool map     (for additive mode)       │  │
│  │ - allowedToolIds: Set              (permission filtered)      │  │
│  │ - messages: MessageV2[]            (conversation history)    │  │
│  │ - agent: {name, mode}                                          │  │
│  │ - cfg: Config.Info                                            │  │
│  │ - mcpIds: Set<string>                                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Mode Detection                              │  │
│  │  - "rules": Keyword regex matching (RULES array)               │  │
│  │  - "hybrid": Embeddings + optional keyword rules               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│          ┌───────────────────┼───────────────────┐                   │
│          ▼                   ▼                   ▼                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐        │
│  │ Intent Embed │   │ Keyword Rules│   │ LLM Augmentation│        │
│  │              │   │              │   │ (hybrid mode)    │        │
│  │ - classify   │   │ - 14 rule    │   │                  │        │
│  │   IntentEmbed│   │   patterns   │   │ augmentMatched  │        │
│  │ - prototypes │   │ - regex match│   │ Tools()         │        │
│  │ - 20 intents │   │   on user    │   │                  │        │
│  │              │   │   text       │   │ - Small LLM     │        │
│  │ - embed tool │   │              │   │   suggestion    │        │
│  │   descriptions│  │              │   │                  │        │
│  └──────────────┘   └──────────────┘   └──────────────────┘        │
│          │                   │                   │                   │
│          └───────────────────┼───────────────────┘                   │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Tool Selection                              │  │
│  │                                                                │  │
│  │  - orderIds(): Base tools first, then matched                 │  │
│  │  - max tools: configurable (default 12)                         │  │
│  │  - additive mode: keep tier tools + matched                   │  │
│  │  - slim descriptions: for base tools not matched              │  │
│  │                                                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  Output:                                                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Result = {                                                    │  │
│  │   tools: filtered/augmented tool map                          │  │
│  │   promptHint: injected instruction (token savings)            │  │
│  │   contextTier: "conversation" | "minimal" | "full"            │  │
│  │ }                                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
Intent Prototypes (router-embed-impl.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                    Intent Prototype System                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Built-in Intents (20 total):                                       │
│  ┌─────────────────┬───────────────────────────────────────────┐   │
│  │ Intent Label    │ Tools Added                               │   │
│  ├─────────────────┼───────────────────────────────────────────┤   │
│  │ edit/refactor   │ edit, write, grep, read                   │   │
│  │ create/implement │ write, edit, grep, read                   │   │
│  │ delete/remove    │ bash, edit, write, read, glob             │   │
│  │ fix/debug       │ edit, grep, read, bash                    │   │
│  │ test            │ bash, read                                │   │
│  │ shell/run       │ bash, read                                │   │
│  │ find/search     │ glob, grep, read                          │   │
│  │ explore/es      │ glob, grep, read, task                    │   │
│  │ web/url         │ webfetch, websearch, read                 │   │
│  │ todo            │ todowrite, read                           │   │
│  │ delegate/sdd    │ task, read                                │   │
│  │ codesearch      │ codesearch, read                           │   │
│  │ skill           │ skill, read                               │   │
│  │ ...             │                                          │   │
│  └─────────────────┴───────────────────────────────────────────┘   │
│                                                                     │
│  Each intent has multilingual prototype phrases for embedding:       │
│  - "refactor and edit the source code"                              │
│  - "modificar y editar el código" (Spanish)                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
---
3. Session/Prompt Architecture
Wire-Tier System (session/wire-tier.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                    Wire-Tier State Machine                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Session Start                                                      │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────┐                                                    │
│  │ Initial     │                                                    │
│  │ Tool Tier   │                                                    │
│  └─────────────┘                                                    │
│       │                                                             │
│       ├──── "full" ────▶ All tools attached                        │
│       │                                                             │
│       └──── "minimal" ──▶ Base tools only:                         │
│                              [read, grep, glob, skill, ±bash]       │
│                                    │                                │
│                                    ▼                                │
│                     ┌─────────────────────────────┐                 │
│                     │  Offline Router (ToolRouter)│                 │
│                     │  Merges/expands tools       │                 │
│                     │  Based on user message      │                 │
│                     └─────────────────────────────┘                 │
│                                    │                                │
│                                    ▼                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ instructionMode() determines how system prompt is built:      │   │
│  │                                                              │   │
│  │  "full"     - Inline all instruction file contents           │   │
│  │  "deferred" - Tell model to read on demand (minimal tier)    │   │
│  │  "index"    - List instruction paths, model reads as needed   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                    │                                │
│                                    ▼                                │
│                         After First Assistant Message                │
│                                    │                                │
│                                    ▼                                │
│                     ┌─────────────────────────────┐                 │
│                     │ Thread has assistant = true │                 │
│                     │ Full tools unlocked         │                 │
│                     └─────────────────────────────┘                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
System Prompt Cache (session/system-prompt-cache.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                    System Prompt Cache Architecture                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Cache Key: `${agent.name}\0${model.id}\0${worktree}\0${mode}`     │
│                                                                     │
│  TTL: 1 hour (configurable via OPENCODE_SYSTEM_PROMPT_CACHE_MS)     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    getParts()                                 │  │
│  │                                                               │  │
│  │  instruction = "full"                                         │  │
│  │    └── Inline ALL instruction file contents                   │  │
│  │                                                               │  │
│  │  instruction = "deferred"                                     │  │
│  │    └── "Project instructions from AGENTS.md, CLAUDE.md..."    │  │
│  │                                                               │  │
│  │  instruction = "index"                                       │  │
│  │    └── List available paths:                                  │  │
│  │        "- /path/to/AGENTS.md"                                 │  │
│  │        "- /path/to/CONTEXT.md"                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                 Merged Prompt Parts                            │  │
│  │                                                               │  │
│  │  [environment] + [skills] + [instructions]                     │  │
│  │                                                               │  │
│  │  environment = SystemPrompt.environment(model)                │  │
│  │               - Working directory                             │  │
│  │               - Workspace root                                │  │
│  │               - Git repo status                               │  │
│  │               - Platform info                                 │  │
│  │                                                               │  │
│  │  skills = SystemPrompt.skills(agent)                          │  │
│  │          - Skill system description                           │  │
│  │                                                               │  │
│  │  instructions = InstructionPrompt.system()                    │  │
│  │               - AGENTS.md, CLAUDE.md, CONTEXT.md              │  │
│  │               - Config-specified instruction paths             │  │
│  │               - Remote instruction URLs                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
Prompt Building Flow
┌─────────────────────────────────────────────────────────────────────┐
│                    Prompt Building Flow                               │
└─────────────────────────────────────────────────────────────────────┘
SessionPrompt.prompt()
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ Session.loop() - Main processing loop                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1: Load Messages                                          │
│          MessageV2.stream(sessionID)                             │
│                          │                                       │
│                          ▼                                       │
│  Step 2: Create Assistant Message                                │
│          Session.updateMessage()                                 │
│                          │                                       │
│                          ▼                                       │
│  Step 3: resolveTools()                                         │
│          ┌──────────────────────────────────────────────────┐  │
│          │  1. ToolRegistry.tools()                         │  │
│          │     - Get all available tools                    │  │
│          │     - Transform schemas for provider             │  │
│          │  2. MCP.tools()                                  │  │
│          │     - Get MCP server tools                       │  │
│          │  3. Permission filtering                        │  │
│          │     - Remove disallowed tools                    │  │
│          │  4. applyInitialToolTier()                      │  │
│          │     - Minimal tier on first turn                │  │
│          │  5. ToolRouter.apply()                          │  │
│          │     - Filter/expand based on intent             │  │
│          └──────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  Step 4: Build System Prompt                                    │
│          ┌──────────────────────────────────────────────────┐  │
│          │  SystemPromptCache.getParts()                   │  │
│          │    - environment                                │  │
│          │    - skills                                    │  │
│          │    - instructions (based on mode)              │  │
│          │  + toolRouterPrompt (if applicable)            │  │
│          │  + StructuredOutputSystemPrompt (if JSON mode) │  │
│          └──────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  Step 5: SessionProcessor.process()                             │
│          LLM.stream() with resolved tools                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
---
4. Plugin Architecture (plugin/index.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                         Plugin System                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Plugin Loading Sequence                     │  │
│  │                                                               │  │
│  │  1. Internal plugins (always loaded):                        │  │
│  │     - CodexAuthPlugin                                        │  │
│  │     - CopilotAuthPlugin                                      │  │
│  │     - GitlabAuthPlugin                                       │  │
│  │     - PoeAuthPlugin                                          │  │
│  │                                                               │  │
│  │  2. External plugins (from config):                           │  │
│  │     - Parse plugin specifier                                  │  │
│  │     - Resolve target (npm path)                              │  │
│  │     - Check compatibility                                     │  │
│  │     - Import server module                                   │  │
│  │     - Call plugin.server()                                   │  │
│  │                                                               │  │
│  │  3. Legacy plugin support                                    │  │
│  │     - Support old export format                              │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Hook System                                 │  │
│  │                                                               │  │
│  │  Plugin.Service.trigger(name, input, output)                │  │
│  │                                                               │  │
│  │  Hook Types:                                                  │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │ Chat Hooks                                             │   │  │
│  │  │   - chat.params       - Transform LLM params          │   │  │
│  │  │   - chat.headers      - Add request headers           │   │  │
│  │  │   - experimental.chat.system.transform                │   │  │
│  │  │   - experimental.chat.messages.transform               │   │  │
│  │  ├──────────────────────────────────────────────────────┤   │  │
│  │  │ Tool Hooks                                             │   │  │
│  │  │   - tool.definition   - Modify tool description        │   │  │
│  │  │   - tool.execute.before                               │   │  │
│  │  │   - tool.execute.after                                │   │  │
│  │  ├──────────────────────────────────────────────────────┤   │  │
│  │  │ Session Hooks                                           │   │  │
│  │  │   - command.execute.before                            │   │  │
│  │  │   - shell.env                                         │   │  │
│  │  ├──────────────────────────────────────────────────────┤   │  │
│  │  │ Experimental Hooks                                      │   │  │
│  │  │   - experimental.text.complete                        │   │  │
│  │  │   - event              - Bus event forwarding         │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Event Subscription                           │  │
│  │                                                               │  │
│  │  Plugins can subscribe to bus events via:                      │  │
│  │  hook["event"]?.({ event })                                   │  │
│  │                                                               │  │
│  │  This enables plugins to react to internal system events:     │  │
│  │  - Session errors                                             │  │
│  │  - Message updates                                            │  │
│  │  - Sync events                                                │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
---
5. Skill Registry (skill/index.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                        Skill System                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Skill Discovery Sources:                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  1. Global directories (user home):                          │  │
│  │     - ~/.claude/skills/**/SKILL.md                           │  │
│  │     - ~/.agents/skills/**/SKILL.md                           │  │
│  │                                                               │  │
│  │  2. Project directories (walk up):                           │  │
│  │     - .claude/skills/**/SKILL.md                             │  │
│  │     - .agents/skills/**/SKILL.md                             │  │
│  │                                                               │  │
│  │  3. Config directories:                                       │  │
│  │     - {config_dir}/{skill,skills}/**/SKILL.md                │  │
│  │                                                               │  │
│  │  4. Explicit paths in config:                                 │  │
│  │     - config.skills.paths[]                                  │  │
│  │                                                               │  │
│  │  5. Remote URLs:                                              │  │
│  │     - config.skills.urls[]  (pulled via Discovery)            │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  Skill Structure:                                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Skill.Info = {                                                │  │
│  │   name: string          // From SKILL.md frontmatter          │  │
│  │   description: string   // From frontmatter                   │  │
│  │   location: string      // Path to SKILL.md                   │  │
│  │   content: string       // Full markdown content              │  │
│  │ }                                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  SkillTool (src/tool/skill.ts):                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  execute(params, ctx) {                                       │  │
│  │    1. Load skill content via Skill.get(name)                  │  │
│  │    2. Ask permission for skill use                            │  │
│  │    3. Scan skill directory for additional files               │  │
│  │    4. Return <skill_content> block:                           │  │
│  │       - Skill name & content                                  │  │
│  │       - Base directory                                        │  │
│  │       - Sampled file list                                     │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
---
6. SDD Architecture (Agent System)
Agent Definitions (agent/agent.ts)
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent Registry                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Native Agents                               │  │
│  │                                                               │  │
│  │  Primary Agents (mode: "primary"):                            │  │
│  │  ┌─────────────────┬────────────────────────────────────┐    │  │
│  │  │ build           │ Default executor                    │    │  │
│  │  │ plan            │ Planning mode (no edit)             │    │  │
│  │  │ sdd-orchestrator│ SDD coordinator (no inline work)    │    │  │
│  │  │ compaction      │ Context compaction agent            │    │  │
│  │  │ title           │ Title generation                    │    │  │
│  │  │ summary         │ Session summarization               │    │  │
│  │  └─────────────────┴────────────────────────────────────┘    │  │
│  │                                                               │  │
│  │  Subagents (mode: "subagent"):                              │  │
│  │  ┌─────────────────┬────────────────────────────────────┐    │  │
│  │  │ general         │ General-purpose worker              │    │  │
│  │  │ explore         │ Codebase exploration                │    │  │
│  │  │ sdd-explore     │ SDD investigation                  │    │  │
│  │  │ sdd-propose     │ Create change proposals             │    │  │
│  │  │ sdd-spec        │ Write specifications               │    │  │
│  │  │ sdd-design      │ Technical design                    │    │  │
│  │  │ sdd-tasks       │ Break down tasks                   │    │  │
│  │  │ sdd-apply       │ Implement changes                  │    │  │
│  │  │ sdd-verify      │ Validate implementation             │    │  │
│  │  │ sdd-archive     │ Archive completed changes           │    │  │
│  │  │ judgment-day    │ Adversarial review                 │    │  │
│  │  └─────────────────┴────────────────────────────────────┘    │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  Agent Configuration:                                               │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Agent.Info = {                                               │  │
│  │   name: string                                                │  │
│  │   description: string                                         │  │
│  │   mode: "primary" | "subagent" | "all"                        │  │
│  │   native: boolean (built-in vs custom)                       │  │
│  │   hidden: boolean (hide from UI)                             │  │
│  │   permission: Permission.Ruleset                             │  │
│  │   model?: {providerID, modelID}                               │  │
│  │   prompt?: string (system prompt override)                   │  │
│  │   steps?: number (max steps before stopping)                 │  │
│  │   options: Record<string, any>                                │  │
│  │ }                                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
SDD Workflow (Orchestrator Pattern)
┌─────────────────────────────────────────────────────────────────────┐
│                   SDD Workflow Orchestration                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User Request                                                       │
│      │                                                             │
│      ▼                                                             │
│  ┌─────────────────┐                                               │
│  │ sdd-orchestrator │ ◄── Coordinates, never does inline work     │
│  │     Agent       │                                               │
│  └────────┬────────┘                                               │
│           │                                                        │
│           │ delegate()                                             │
│           ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      SDD Phase Pipeline                       │   │
│  │                                                               │   │
│  │  ┌────────────┐    ┌────────────┐    ┌────────────┐        │   │
│  │  │ sdd-explore│───▶│sdd-propose │───▶│ sdd-spec   │        │   │
│  │  │            │    │            │    │            │        │   │
│  │  │ Investigate│    │ Create     │    │ Write      │        │   │
│  │  │ codebase   │    │ proposal   │    │ specs      │        │   │
│  │  └────────────┘    └────────────┘    └──────┬─────┘        │   │
│  │                                            │               │   │
│  │                                            ▼               │   │
│  │               ┌────────────┐    ┌────────────┐            │   │
│  │               │ sdd-design│───▶│ sdd-tasks  │            │   │
│  │               │           │    │            │            │   │
│  │               │ Technical │    │ Break down │            │   │
│  │               │ design    │    │ tasks      │            │   │
│  │               └────────────┘    └──────┬─────┘            │   │
│  │                                        │                   │   │
│  │                                        ▼                   │   │
│  │               ┌────────────┐    ┌────────────┐            │   │
│  │               │ sdd-verify │◄───│ sdd-apply  │            │   │
│  │               │            │    │            │            │   │
│  │               │ Validate   │    │ Implement  │            │   │
│  │               │ changes    │    │ tasks      │            │   │
│  │               └─────┬──────┘    └────────────┘            │   │
│  │                     │                                    │   │
│  │                     ▼                                    │   │
│  │               ┌────────────┐                              │   │
│  │               │sdd-archive │                              │   │
│  │               │            │                              │   │
│  │               │ Persist    │                              │   │
│  │               │ artifacts  │                              │   │
│  │               └────────────┘                              │   │
│  │                                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Each phase:                                                        │
│  - Returns: {status, executive_summary, artifacts, next_recommended} │
│  - Runs as async delegate() by default                              │
│  - Can use task() for synchronous results when needed               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
Task Tool (Delegate System)
┌─────────────────────────────────────────────────────────────────────┐
│                    Task Tool Execution Flow                          │
│                      (src/tool/task.ts)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TaskTool.execute(params, ctx)                                      │
│      │                                                             │
│      ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 1: Permission Check                                     │  │
│  │     - ctx.ask({permission: "task", patterns: [subagent]})   │  │
│  │     - Bypassed if ctx.extra.bypassAgentCheck                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│      │                                                             │
│      ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 2: Session Management                                   │  │
│  │                                                               │  │
│  │  if (task_id) {                                              │  │
│  │    // Resume existing subagent session                        │  │
│  │    session = Session.get(task_id)                             │  │
│  │  } else {                                                    │  │
│  │    // Create new subagent session                            │  │
│  │    session = Session.create({                                 │  │
│  │      parentID: ctx.sessionID,                                 │  │
│  │      title: description + " (@subagent)",                     │  │
│  │      permission: filtered by agent capabilities              │  │
│  │    })                                                        │  │
│  │  }                                                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│      │                                                             │
│      ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 3: Prompt Resolution                                    │  │
│  │                                                               │  │
│  │  promptParts = SessionPrompt.resolvePromptParts(params.prompt)│  │
│  │     - Extract @references to agents                           │  │
│  │     - Resolve file paths                                     │  │
│  │     - Build parts array                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│      │                                                             │
│      ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 4: Execute Subagent                                     │  │
│  │                                                               │  │
│  │  result = SessionPrompt.prompt({                              │  │
│  │    messageID: MessageID.ascending(),                          │  │
│  │    sessionID: session.id,                                     │  │
│  │    model: agent.model ?? user.model,                          │  │
│  │    agent: agent.name,                                         │  │
│  │    tools: {disabled: task, todowrite, ...},                  │  │
│  │    parts: promptParts,                                        │  │
│  │  })                                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│      │                                                             │
│      ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 5: Format Output                                        │  │
│  │                                                               │  │
│  │  return {                                                     │  │
│  │    title: params.description,                                 │  │
│  │    metadata: {sessionId, model},                              │  │
│  │    output: "task_id: ...\n<task_result>...</task_result>"    │  │
│  │  }                                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
---
7. Complete System Flow Diagram
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Complete Request Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘
User Input
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLI / TUI Layer                                    │
│                         (cli/cmd/tui/)                                      │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   account   │  │    agent    │  │   models    │  │   session   │       │
│  │   acp       │  │    mcp      │  │    stats    │  │    run      │       │
│  │   debug     │  │    plug     │  │    github   │  │    serve    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Session Prompt Loop                                 │
│                           (session/prompt.ts)                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ SessionPrompt.loop()                                                │  │
│  │                                                                       │  │
│  │  ┌──────────────┐                                                    │  │
│  │  │ Load Messages │ ──▶ MessageV2.stream()                           │  │
│  │  └──────────────┘                                                    │  │
│  │           │                                                           │  │
│  │           ▼                                                           │  │
│  │  ┌───────────────────────────────────────────────────────────────┐  │  │
│  │  │ resolveTools()                                                 │  │  │
│  │  │                                                                │  │  │
│  │  │  1. ToolRegistry.tools() ──▶ Get all tools                   │  │  │
│  │  │  2. MCP.tools() ──▶ Get MCP server tools                      │  │  │
│  │  │  3. Permission.filter() ──▶ Apply agent permissions          │  │  │
│  │  │  4. applyInitialToolTier() ──▶ Minimal tier on first turn    │  │  │
│  │  │  5. ToolRouter.apply() ──▶ Intent-based filtering            │  │  │
│  │  │                                                                │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  │           │                                                           │  │
│  │           ▼                                                           │  │
│  │  ┌───────────────────────────────────────────────────────────────┐  │  │
│  │  │ Build System Prompt                                            │  │  │
│  │  │                                                                │  │  │
│  │  │  SystemPromptCache.getParts()                                 │  │  │
│  │  │     - environment                                             │  │  │
│  │  │     - skills                                                  │  │  │
│  │  │     - instructions (full/deferred/index)                      │  │  │
│  │  │  + toolRouterPrompt                                           │  │  │
│  │  │                                                                │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  │           │                                                           │  │
│  └───────────┼───────────────────────────────────────────────────────────┘  │
│              │                                                             │
│              ▼                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ SessionProcessor.process()                                             │  │
│  │                                                                        │  │
│  │  ┌────────────────┐                                                     │  │
│  │  │ LLM.stream()   │ ──▶ AI SDK + Provider                              │  │
│  │  └───────┬────────┘                                                     │  │
│  │          │                                                              │  │
│  │          ▼                                                              │  │
│  │  ┌───────────────────────────────────────────────────────────────┐     │  │
│  │  │ Stream Events:                                                  │     │  │
│  │  │                                                                │     │  │
│  │  │  - start, text-start/delta/end                               │     │  │
│  │  │  - reasoning-start/delta/end                                 │     │  │
│  │  │  - tool-input-start/delta/end                                │     │  │
│  │  │  - tool-call, tool-result, tool-error                         │     │  │
│  │  │  - start-step, finish-step                                    │     │  │
│  │  │  - error, finish                                               │     │  │
│  │  │                                                                │     │  │
│  │  └───────────────────────────────────────────────────────────────┘     │  │
│  │           │                                                             │  │
│  │           ▼                                                             │  │
│  │  ┌───────────────────────────────────────────────────────────────┐     │  │
│  │  │ Tool Execution Pipeline                                         │     │  │
│  │  │                                                                │     │  │
│  │  │  Plugin.trigger("tool.execute.before")                        │     │  │
│  │  │           │                                                    │     │  │
│  │  │           ▼                                                    │     │  │
│  │  │  ToolRegistry.tool.execute() ──▶ Tool implementation            │     │  │
│  │  │           │                                                    │     │  │
│  │  │           ▼                                                    │     │  │
│  │  │  Truncate.output() ──▶ Output truncation                      │     │  │
│  │  │           │                                                    │     │  │
│  │  │           ▼                                                    │     │  │
│  │  │  Plugin.trigger("tool.execute.after")                         │     │  │
│  │  │                                                                │     │  │
│  │  └───────────────────────────────────────────────────────────────┘     │  │
│  │           │                                                             │  │
│  │           ▼                                                             │  │
│  │  ┌───────────────────────────────────────────────────────────────┐     │  │
│  │  │ Context Management                                             │     │  │
│  │  │                                                                │     │  │
│  │  │  - isOverflow() ──▶ SessionCompaction.process()              │     │  │
│  │  │  - SessionSummary.summarize()                                 │     │  │
│  │  │  - Snapshot.patch()                                          │     │  │
│  │  │                                                                │     │  │
│  │  └───────────────────────────────────────────────────────────────┘     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
---
8. Key Configuration Points
Initial Tool Tier (session/initial-tool-tier.ts)
// First-turn allowlist (minimal tier)
const MINIMAL_IDS = ["read", "grep", "glob", "skill"]
// Plus optional: bash, webfetch, websearch
// Configuration flags:
Flag.OPENCODE_INITIAL_TOOL_TIER = "minimal" | "full"
Flag.OPENCODE_MINIMAL_TIER_ALL_TURNS = true  // Keep minimal every turn
Tool Router Modes (session/tool-router.ts)
// Modes:
"rules"    // Keyword regex matching only (default)
"hybrid"   // Embeddings + optional rules
// Configuration:
experimental.tool_router = {
  mode: "rules" | "hybrid",
  enabled: true | false,
  additive: true | false,           // Minimal tier + matches vs subset
  max_tools: 12,                   // Max tools to send
  base_tools: ["read", "task", "skill"],
  local_embed: true,                // Use local embeddings
  local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  local_intent_embed: true,         // Intent classification
  keyword_rules: false,             // Also use regex rules
  mcp_filter_by_intent: true,       // Filter MCP tools by intent
  inject_prompt: true,               // Inject router hint
}
---
This architecture demonstrates a sophisticated multi-agent system with:
1. Flexible Tool System: Dynamic tool registration from built-in, custom, and plugin sources
2. Intelligent Routing: Offline intent-based tool filtering using embeddings and keyword rules
3. Tiered Prompt Building: Context-aware system prompt construction with caching
4. Plugin Hooks: Extensible middleware for tools, chat, and events
5. SDD Orchestration: Hierarchical agent teams with structured workflows