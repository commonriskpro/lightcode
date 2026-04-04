## Now I have a comprehensive understanding of the architecture. Let me provide you with a detailed architectural diagram and explanation:

OpenCode Architecture Analysis

1. Tool System Architecture
   Tool Registration & Discovery
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Tool Registry Layer │
   │ (src/tool/registry.ts) │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ ┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
   │ │ Built-in │ │ Custom Tools │ │ Plugin Tools │ │
   │ │ Tools │ │ (config dirs) │ │ │ │
   │ │ │ │ │ │ │ │
   │ │ - bash │ │ {tool,tools}/ │ │ plugin.tool │ │
   │ │ - read │ │ \*.ts files │ │ (from hooks) │ │
   │ │ - edit │ │ │ │ │ │
   │ │ - grep │ │ Scanned via │ │ Registered by │ │
   │ │ - glob │ │ Glob.scanSync() │ │ Plugin.Service │ │
   │ │ - write │ │ │ │ │ │
   │ │ - task │ │ Each file exports│ │ Extracted via │ │
   │ │ - webfetch │ │ ToolDefinitions │ │ plugin.list() │ │
   │ │ - websearch │ │ │ │ │ │
   │ │ - codesearch │ │ │ │ │ │
   │ │ - skill │ │ │ │ │ │
   │ │ - todowrite │ │ │ │ │ │
   │ │ - batch │ │ │ │ │ │
   │ │ - plan │ │ │ │ │ │
   │ │ - lsp │ │ │ │ │ │
   │ │ - question │ │ │ │ │ │
   │ │ - apply_patch│ │ │ │ │ │
   │ └──────────────┘ └──────────────────┘ └──────────────────┘ │
   │ │ │ │ │
   │ └─────────────────────┼──────────────────────┘ │
   │ ▼ │
   │ ┌─────────────────────┐ │
   │ │ Tool.Info[] custom │ │
   │ │ (merged at startup) │ │
   │ └─────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌─────────────────────┐ │
   │ │ ToolRegistry.all() │ │
   │ │ - Filters by model │ │
   │ │ - Handles flags │ │
   │ │ - Triggers hooks │ │
   │ └─────────────────────┘ │
   └─────────────────────────────────────────────────────────────────────┘

Tool Definition Structure (src/tool/tool.ts)
Tool.Info = {
id: string // Unique identifier
init: (ctx?) => Promise<{
description: string // Shown to LLM
parameters: ZodSchema // Input validation
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
│ Tool Execution Pipeline │
└─────────────────────────────────────────────────────────────────────┘
User/Model Call
│
▼
┌─────────────────┐
│ ToolRouter.apply│ ─── Offline routing decision
│ (tool-router.ts)│ Based on intent/keywords/embeddings
└─────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────┐
│ LLM.stream() │
│ (session/llm.ts) │
├─────────────────────────────────────────────────────────────────┤
│ │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ resolveTools │────▶│ streamText() │────▶│ tool.execute│ │
│ │ │ │ │ │ │ │
│ │ - Registry │ │ - AI SDK │ │ - Plugin │ │
│ │ - MCP tools │ │ - Provider │ │ hooks │ │
│ │ - Permission │ │ transform │ │ - Truncate │ │
│ │ filtering │ │ - Headers │ │ - Output │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
│ │ │ │ │
└─────────┼─────────────────────┼────────────────────┘────────────┘
│ │
▼ ▼
┌─────────────────┐ ┌─────────────────┐
│ SessionProcessor│ │ Events │
│ │ │ │
│ - tool-input-\* │ │ - tool-result │
│ - tool-call │ │ - tool-error │
│ - text-delta │ │ - error │
│ - finish-step │ │ - finish │
└─────────────────┘ └─────────────────┘

---

2. Offline Tool Router Implementation (session/tool-router.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Offline Tool Router (ToolRouter.apply) │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ Input: │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ - tools: Record<string, AITool> (after initial tier) │ │
   │ │ - registryTools: full tool map (for additive mode) │ │
   │ │ - allowedToolIds: Set (permission filtered) │ │
   │ │ - messages: MessageV2[] (conversation history) │ │
   │ │ - agent: {name, mode} │ │
   │ │ - cfg: Config.Info │ │
   │ │ - mcpIds: Set<string> │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Mode Detection │ │
   │ │ - "rules": Keyword regex matching (RULES array) │ │
   │ │ - "hybrid": Embeddings + optional keyword rules │ │
   │ │ - "auto": Token budget-aware auto-selection │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ┌───────────────────┼───────────────────┐ │
   │ ▼ ▼ ▼ │
   │ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
   │ │ Intent Embed │ │ Keyword Rules│ │ LLM Augmentation │ │
   │ │ │ │ │ │ (hybrid mode) │ │
   │ │ - classify │ │ - 18+ rule │ │ │ │
   │ │ IntentEmbed│ │ patterns │ │ augmentMatched │ │
   │ │ - prototypes │ │ - regex match│ │ Tools() │ │
   │ │ - 22 intents │ │ on user │ │ │ │
   │ │ │ │ text │ │ - Local embed │ │
   │ │ - embed tool │ │ │ │ (Xenova) │ │
   │ │ descriptions│ │ │ │ - Rerank │ │
   │ │ │ │ │ │ (semantic + │ │
   │ │ │ │ │ │ lexical) │ │
   │ └──────────────┘ └──────────────┘ └──────────────────┘ │
   │ │ │ │ │
   │ └───────────────────┼───────────────────┘ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Tool Selection │ │
   │ │ │ │
   │ │ - orderIds(): Base tools first, then matched │ │
   │ │ - max tools: configurable (default 12, or 100 for auto) │ │
   │ │ - additive mode: keep tier tools + matched │ │
   │ │ - slim descriptions: for base tools not matched │ │
   │ │ - sticky tools: carry forward from previous turn │ │
   │ │ - fallback expansion: empty selection → full/tools │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ Output: │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Result = { │ │
   │ │ tools: filtered/augmented tool map │ │
   │ │ promptHint: injected instruction (token savings) │ │
   │ │ contextTier: "conversation" | "minimal" | "full" │ │
   │ │ usedFallbackExpansion: boolean │ │
   │ │ } │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────────┘

Intent Prototypes (router-embed-impl.ts)
┌─────────────────────────────────────────────────────────────────────┐
│ Intent Prototype System │
├─────────────────────────────────────────────────────────────────────┤
│ │
│ Built-in Intents (22 total): │
│ ┌─────────────────┬───────────────────────────────────────────┐ │
│ │ Intent Label │ Tools Added │ │
│ ├─────────────────┼───────────────────────────────────────────┤ │
│ │ edit/refactor │ edit, write, grep, read │ │
│ │ create/implement │ write, edit, grep, read │ │
│ │ delete/remove │ bash, edit, write, read, glob │ │
│ │ move/rename │ bash, read, glob │ │
│ │ fix/debug │ edit, grep, read, bash │ │
│ │ test │ bash, read │ │
│ │ shell/run │ bash, read │ │
│ │ find/search │ glob, grep, read │ │
│ │ explore/es │ glob, grep, read, task │ │
│ │ explore/en │ glob, grep, read, task │ │
│ │ web/url │ webfetch, websearch, read │ │
│ │ web/research │ webfetch, websearch, read │ │
│ │ web/screenshot │ webfetch, websearch, read │ │
│ │ todo │ todowrite, read │ │
│ │ delegate/sdd │ task, read │ │
│ │ codesearch │ codesearch, read │ │
│ │ skill │ skill, read │ │
│ │ question │ question │ │
│ │ conversation │ (no tools - chit-chat detection) │ │
│ └─────────────────┴───────────────────────────────────────────┘ │
│ │
│ Each intent has multilingual prototype phrases for embedding: │
│ - "refactor and edit the source code" │
│ - "modificar y editar el código" (Spanish) │
│ - "crear e implementar un componente nuevo" │
│ - "borrar el archivo o carpeta" │
│ │
│ Exact Match Post-processing (router-exact-match.ts): │
│ - dynamic_ratio: Adaptive threshold based on prompt complexity │
│ - intent_gating: Penalize edit/bash for web intents │
│ - per_tool_min: Tool-specific minimum scores (write: 0.4, edit: 0.38)│
│ - calibration: Sigmoid transform for confidence calibration │
│ - redundancy: Dedupe websearch/webfetch when scores too close │
│ - two_pass: Remove bash if no run/execute keywords in text │
│ │
└─────────────────────────────────────────────────────────────────────┘

Tool Exposure System (tool-exposure.ts)
┌─────────────────────────────────────────────────────────────────────┐
│ Tool Exposure Modes │
├─────────────────────────────────────────────────────────────────────┤
│ │
│ exposure_mode options (Config: experimental.tool_router.exposure_mode)│
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │ per_turn_subset (default) │ │
│ │ - Router output directly, no memory persistence │ │
│ │ - Most efficient, smallest prompt │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ memory_only_unlocked │ │
│ │ - Router output + reminder of previously unlocked tools │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ stable_catalog_subset │ │
│ │ - Router output, persists "unlocked" for future turns │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ subset_plus_memory_reminder │ │
│ │ - Router output + reminder line (like memory_only) │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ session_accumulative_callable │ │
│ │ - Merges prior turn's callable tools with current router │ │
│ │ - Widest tool set, highest token cost │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ │
│ Memory tracking: │
│ - toolExposureUnlockedIds: Persisted in assistant message │ │
│ - toolExposureSessionCallableIds: Session-scoped callable list │ │
│ - toolIdsFromCompletedTools: Detected from conversation history │ │
│ │
└─────────────────────────────────────────────────────────────────────┘

---

3. Session/Prompt Architecture
   Wire-Tier System (session/wire-tier.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Wire-Tier State Machine │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ Session Start │
   │ │ │
   │ ▼ │
   │ ┌─────────────┐ │
   │ │ Initial │ │
   │ │ Tool Tier │ │
   │ └─────────────┘ │
   │ │ │
   │ ├──── "full" ────▶ All tools attached │
   │ │ │
   │ └──── "minimal" ──▶ Base tools only: │
   │ [read, grep, glob, skill, ±bash] │
   │ │ │
   │ ▼ │
   │ ┌─────────────────────────────┐ │
   │ │ Offline Router (ToolRouter)│ │
   │ │ Merges/expands tools │ │
   │ │ Based on user message │ │
   │ └─────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌──────────────────────────────────────────────────────────────┐ │
   │ │ instructionMode() determines how system prompt is built: │ │
   │ │ │ │
   │ │ "full" - Inline all instruction file contents │ │
   │ │ "deferred" - Tell model to read on demand (minimal tier) │ │
   │ │ "index" - List instruction paths, model reads as needed │ │
   │ └──────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ After First Assistant Message │
   │ │ │
   │ ▼ │
   │ ┌─────────────────────────────┐ │
   │ │ Thread has assistant = true │ │
   │ │ Full tools unlocked │ │
   │ └─────────────────────────────┘ │
   │ │
   └─────────────────────────────────────────────────────────────────────┘
   System Prompt Cache (session/system-prompt-cache.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ System Prompt Cache Architecture │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ Cache Key: `${agent.name}\0${model.id}\0${worktree}\0${instructions}`│
   │ │
   │ TTL: 1 hour (configurable via OPENCODE_SYSTEM_PROMPT_CACHE_MS) │
   │ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ getParts() │ │
   │ │ │ │
   │ │ instruction = "full" │ │
   │ │ └── Inline ALL instruction file contents │ │
   │ │ │ │
   │ │ instruction = "deferred" │ │
   │ │ └── "Project instructions from AGENTS.md, CLAUDE.md..." │ │
   │ │ │ │
   │ │ instruction = "index" │ │
   │ │ └── List available paths: │ │
   │ │ "- /path/to/AGENTS.md" │ │
   │ │ "- /path/to/CONTEXT.md" │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Merged Prompt Parts │ │
   │ │ │ │
   │ │ [environment] + [skills] + [instructions] │ │
   │ │ │ │
   │ │ environment = SystemPrompt.environment(model) │ │
   │ │ - Working directory │ │
   │ │ - Workspace root │ │
   │ │ - Git repo status │ │
   │ │ - Platform info │ │
   │ │ │ │
   │ │ skills = SystemPrompt.skills(agent) │ │
   │ │ - Skill system description │ │
   │ │ │ │
   │ │ instructions = InstructionPrompt.system() │ │
   │ │ - AGENTS.md, CLAUDE.md, CONTEXT.md │ │
   │ │ - Config-specified instruction paths │ │
   │ │ - Remote instruction URLs │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │
   └─────────────────────────────────────────────────────────────────────┘

Context Tier (tool-router.ts)
┌─────────────────────────────────────────────────────────────────────┐
│ Context Tier System │
├─────────────────────────────────────────────────────────────────────┤
│ │
│ Three tiers returned by ToolRouter.apply(): │
│ │
│ ┌───────────────────────────────────────────────────────────────┐ │
│ │ "conversation" │ │
│ │ - Intent detected as "conversation" (chit-chat) │ │
│ │ - No tool definitions attached │ │
│ │ - Minimal prompt (~50 tokens) │ │
│ │ - Exposure memory still tracked for future turns │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ "minimal" │ │
│ │ - Router found no matching tools │ │
│ │ - Base tools (read, grep, glob, skill) only │ │
│ │ - Reduced system prompt │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ "full" │ │
│ │ - Normal operation with matched tools │ │
│ │ - Full system prompt with instructions │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ │
│ Token accounting logged to: │
│ {data}/debug/tokens/{sessionID}.jsonl │
│ Breakdown: system + userText + toolResults + toolDefs │
│ │
└─────────────────────────────────────────────────────────────────────┘

Prompt Building Flow
┌─────────────────────────────────────────────────────────────────────┐
│ Prompt Building Flow │
└─────────────────────────────────────────────────────────────────────┘
SessionPrompt.prompt()
│
▼
┌─────────────────────────────────────────────────────────────────┐
│ Session.loop() - Main processing loop │
├─────────────────────────────────────────────────────────────────┤
│ │
│ Step 1: Load Messages │
│ MessageV2.stream(sessionID) │
│ │ │
│ ▼ │
│ Step 2: Create Assistant Message │
│ Session.updateMessage() │
│ │ │
│ ▼ │
│ Step 3: resolveTools() │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 1. ToolRegistry.tools() │ │
│ │ - Get all available tools │ │
│ │ - Transform schemas for provider │ │
│ │ 2. MCP.tools() │ │
│ │ - Get MCP server tools │ │
│ │ 3. Permission filtering │ │
│ │ - Remove disallowed tools │ │
│ │ 4. ToolRouter.apply() │ │
│ │ - Filter/expand based on intent │ │
│ │ 5. applyExposure() │ │
│ │ - Memory-based tool exposure │ │
│ └──────────────────────────────────────────────────┘ │
│ │ │
│ ▼ │
│ Step 4: Build System Prompt │
│ ┌──────────────────────────────────────────────────┐ │
│ │ SystemPromptCache.getParts() │ │
│ │ - environment │ │
│ │ - skills │ │
│ │ - instructions (based on mode) │ │
│ │ + toolRouterPrompt (if applicable) │ │
│ │ + StructuredOutputSystemPrompt (if JSON mode) │ │
│ └──────────────────────────────────────────────────┘ │
│ │ │
│ ▼ │
│ Step 5: SessionProcessor.process() │
│ LLM.stream() with resolved tools │
│ │
└─────────────────────────────────────────────────────────────────┘

---

4. Plugin Architecture (plugin/index.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Plugin System │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Plugin Loading Sequence │ │
   │ │ │ │
   │ │ 1. Internal plugins (always loaded): │ │
   │ │ - CodexAuthPlugin │ │
   │ │ - CopilotAuthPlugin │ │
   │ │ - GitlabAuthPlugin │ │
   │ │ - PoeAuthPlugin │ │
   │ │ │ │
   │ │ 2. External plugins (from config): │ │
   │ │ - Parse plugin specifier │ │
   │ │ - Resolve target (npm path) │ │
   │ │ - Check compatibility │ │
   │ │ - Import server module │ │
   │ │ - Call plugin.server() │ │
   │ │ │ │
   │ │ 3. Legacy plugin support │ │
   │ │ - Support old export format │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Hook System │ │
   │ │ │ │
   │ │ Plugin.Service.trigger(name, input, output) │ │
   │ │ │ │
   │ │ Hook Types: │ │
   │ │ ┌──────────────────────────────────────────────────────┐ │ │
   │ │ │ Chat Hooks │ │ │
   │ │ │ - chat.params - Transform LLM params │ │ │
   │ │ │ - chat.headers - Add request headers │ │ │
   │ │ │ - experimental.chat.system.transform │ │ │
   │ │ │ - experimental.chat.messages.transform │ │ │
   │ │ ├──────────────────────────────────────────────────────┤ │ │
   │ │ │ Tool Hooks │ │ │
   │ │ │ - tool.definition - Modify tool description │ │ │
   │ │ │ - tool.execute.before │ │ │
   │ │ │ - tool.execute.after │ │ │
   │ │ ├──────────────────────────────────────────────────────┤ │ │
   │ │ │ Session Hooks │ │ │
   │ │ │ - command.execute.before │ │ │
   │ │ │ - shell.env │ │ │
   │ │ ├──────────────────────────────────────────────────────┤ │ │
   │ │ │ Experimental Hooks │ │ │
   │ │ │ - experimental.text.complete │ │ │
   │ │ │ - event - Bus event forwarding │ │ │
   │ │ └──────────────────────────────────────────────────────┘ │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Event Subscription │ │
   │ │ │ │
   │ │ Plugins can subscribe to bus events via: │ │
   │ │ hook["event"]?.({ event }) │ │
   │ │ │ │
   │ │ This enables plugins to react to internal system events: │ │
   │ │ - Session errors │ │
   │ │ - Message updates │ │
   │ │ - Sync events │ │
   │ │ └───────────────────────────────────────────────────────────────┐│
   │ │
   └─────────────────────────────────────────────────────────────────────┘

---

5. Skill Registry (skill/index.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Skill System │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ Skill Discovery Sources: │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ │ │
   │ │ 1. Global directories (user home): │ │
   │ │ - ~/.claude/skills/**/SKILL.md │ │
   │ │ - ~/.agents/skills/**/SKILL.md │ │
   │ │ │ │
   │ │ 2. Project directories (walk up): │ │
   │ │ - .claude/skills/**/SKILL.md │ │
   │ │ - .agents/skills/**/SKILL.md │ │
   │ │ │ │
   │ │ 3. Config directories: │ │
   │ │ - {config_dir}/{skill,skills}/\*\*/SKILL.md │ │
   │ │ │ │
   │ │ 4. Explicit paths in config: │ │
   │ │ - config.skills.paths[] │ │
   │ │ │ │
   │ │ 5. Remote URLs: │ │
   │ │ - config.skills.urls[] (pulled via Discovery) │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ Skill Structure: │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Skill.Info = { │ │
   │ │ name: string // From SKILL.md frontmatter │ │
   │ │ description: string // From frontmatter │ │
   │ │ location: string // Path to SKILL.md │ │
   │ │ content: string // Full markdown content │ │
   │ │ } │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ SkillTool (src/tool/skill.ts): │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ │ │
   │ │ execute(params, ctx) { │ │
   │ │ 1. Load skill content via Skill.get(name) │ │
   │ │ 2. Ask permission for skill use │ │
   │ │ 3. Scan skill directory for additional files │ │
   │ │ 4. Return <skill_content> block: │ │
   │ │ - Skill name & content │ │
   │ │ - Base directory │ │
   │ │ - Sampled file list │ │
   │ │ } │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │
   └─────────────────────────────────────────────────────────────────────┘

---

6. SDD Architecture (Agent System)
   Agent Definitions (agent/agent.ts)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Agent Registry │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Native Agents │ │
   │ │ │ │
   │ │ Primary Agents (mode: "primary"): │ │
   │ │ ┌─────────────────┬────────────────────────────────────┐ │ │
   │ │ │ build │ Default executor │ │ │
   │ │ │ plan │ Planning mode (no edit) │ │ │
   │ │ │ sdd-orchestrator│ SDD coordinator (no inline work) │ │ │
   │ │ │ compaction │ Context compaction agent │ │ │
   │ │ │ title │ Title generation │ │ │
   │ │ │ summary │ Session summarization │ │ │
   │ │ └─────────────────┴────────────────────────────────────┘ │ │
   │ │ │ │
   │ │ Subagents (mode: "subagent"): │ │
   │ │ ┌─────────────────┬────────────────────────────────────┐ │ │
   │ │ │ general │ General-purpose worker │ │ │
   │ │ │ explore │ Codebase exploration │ │ │
   │ │ │ sdd-explore │ SDD investigation │ │ │
   │ │ │ sdd-propose │ Create change proposals │ │ │
   │ │ │ sdd-spec │ Write specifications │ │ │
   │ │ │ sdd-design │ Technical design │ │ │
   │ │ │ sdd-tasks │ Break down tasks │ │ │
   │ │ │ sdd-apply │ Implement changes │ │ │
   │ │ │ sdd-verify │ Validate implementation │ │ │
   │ │ │ sdd-archive │ Archive completed changes │ │ │
   │ │ │ judgment-day │ Adversarial review │ │ │
   │ │ │ sdd-init │ Bootstrap SDD context │ │ │
   │ │ └─────────────────┴────────────────────────────────────┘ │ │
   │ │ │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ Agent Configuration: │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Agent.Info = { │ │
   │ │ name: string │ │
   │ │ description: string │ │
   │ │ mode: "primary" | "subagent" | "all" │ │
   │ │ native: boolean (built-in vs custom) │ │
   │ │ hidden: boolean (hide from UI) │ │
   │ │ permission: Permission.Ruleset │ │
   │ │ model?: {providerID, modelID} │ │
   │ │ variant?: string │ │
   │ │ prompt?: string (system prompt override) │ │
   │ │ options: Record<string, any> │ │
   │ │ steps?: number (max steps before stopping) │ │
   │ │ temperature?: number │ │
   │ │ topP?: number │ │
   │ │ } │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │
   └─────────────────────────────────────────────────────────────────────┘
   SDD Workflow (Orchestrator Pattern)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ SDD Workflow Orchestration │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ User Request │
   │ │ │
   │ ▼ │
   │ ┌─────────────────┐ │
   │ │ sdd-orchestrator │ ◄── Coordinates, never does inline work │
   │ │ Agent │ │
   │ └────────┬────────┘ │
   │ │ │
   │ │ delegate() │
   │ ▼ │
   │ ┌─────────────────────────────────────────────────────────────┐ │
   │ │ SDD Phase Pipeline │ │
   │ │ │ │
   │ │ ┌────────────┐ ┌────────────┐ ┌────────────┐ │ │
   │ │ │ sdd-explore│───▶│sdd-propose │───▶│ sdd-spec │ │ │
   │ │ │ │ │ │ │ │ │ │
   │ │ │ Investigate│ │ Create │ │ Write │ │ │
   │ │ │ codebase │ │ proposal │ │ specs │ │ │
   │ │ └────────────┘ └────────────┘ └──────┬─────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌────────────┐ ┌────────────┐ │ │
   │ │ │ sdd-design│───▶│ sdd-tasks │ │ │
   │ │ │ │ │ │ │ │
   │ │ │ Technical │ │ Break down │ │ │
   │ │ │ design │ │ tasks │ │ │
   │ │ └────────────┘ └──────┬─────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌────────────┐ ┌────────────┐ │ │
   │ │ │ sdd-verify │◄───│ sdd-apply │ │ │
   │ │ │ │ │ │ │ │
   │ │ │ Validate │ │ Implement │ │ │
   │ │ │ changes │ │ tasks │ │ │
   │ │ └─────┬──────┘ └────────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌────────────┐ │ │
   │ │ │sdd-archive │ │ │
   │ │ │ │ │ │
   │ │ │ Persist │ │ │
   │ │ │ artifacts │ │ │
   │ │ └────────────┘ │ │
   │ │ │ │
   │ └─────────────────────────────────────────────────────────────┘ │
   │ │
   │ Each phase: │
   │ - Returns: {status, executive_summary, artifacts, next_recommended} │
   │ - Runs as async delegate() by default │
   │ - Can use task() for synchronous results when needed │
   │ │
   └─────────────────────────────────────────────────────────────────────┘
   Task Tool (Delegate System)
   ┌─────────────────────────────────────────────────────────────────────┐
   │ Task Tool Execution Flow │
   │ (src/tool/task.ts) │
   ├─────────────────────────────────────────────────────────────────────┤
   │ │
   │ TaskTool.execute(params, ctx) │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Step 1: Permission Check │ │
   │ │ - ctx.ask({permission: "task", patterns: [subagent]}) │ │
   │ │ - Bypassed if ctx.extra.bypassAgentCheck │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Step 2: Session Management │ │
   │ │ │ │
   │ │ if (task_id) { │ │
   │ │ // Resume existing subagent session │ │
   │ │ session = Session.get(task_id) │ │
   │ │ } else { │ │
   │ │ // Create new subagent session │ │
   │ │ session = Session.create({ │ │
   │ │ parentID: ctx.sessionID, │ │
   │ │ title: description + " (@subagent)", │ │
   │ │ permission: filtered by agent capabilities │ │
   │ │ }) │ │
   │ │ } │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Step 3: Prompt Resolution │ │
   │ │ │ │
   │ │ promptParts = SessionPrompt.resolvePromptParts(params.prompt)│ │
   │ │ - Extract @references to agents │ │
   │ │ - Resolve file paths │ │
   │ │ - Build parts array │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Step 4: Execute Subagent │ │
   │ │ │ │
   │ │ result = SessionPrompt.prompt({ │ │
   │ │ messageID: MessageID.ascending(), │ │
   │ │ sessionID: session.id, │ │
   │ │ model: agent.model ?? user.model, │ │
   │ │ agent: agent.name, │ │
   │ │ tools: {disabled: task, todowrite, ...}, │ │
   │ │ parts: promptParts, │ │
   │ │ }) │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────┐ │
   │ │ Step 5: Format Output │ │
   │ │ │ │
   │ │ return { │ │
   │ │ title: params.description, │ │
   │ │ metadata: {sessionId, model}, │ │
   │ │ output: "task_id: ...\n<task_result>...</task_result>" │ │
   │ │ } │ │
   │ └───────────────────────────────────────────────────────────────┘ │
   │ │
   └─────────────────────────────────────────────────────────────────────┘

---

7. Complete System Flow Diagram
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ Complete Request Flow │
   └─────────────────────────────────────────────────────────────────────────────┘
   User Input
   │
   ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ CLI / TUI Layer │
   │ (cli/cmd/tui/) │
   │ │
   │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
   │ │ account │ │ agent │ │ models │ │ session │ │
   │ │ acp │ │ mcp │ │ stats │ │ run │ │
   │ │ debug │ │ plug │ │ github │ │ serve │ │
   │ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
   └─────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ Session Prompt Loop │
   │ (session/prompt.ts) │
   │ │
   │ ┌─────────────────────────────────────────────────────────────────────┐ │
   │ │ SessionPrompt.loop() │ │
   │ │ │ │
   │ │ ┌──────────────┐ │ │
   │ │ │ Load Messages │ ──▶ MessageV2.stream() │ │
   │ │ └──────────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌───────────────────────────────────────────────────────────────┐ │ │
   │ │ │ resolveTools() │ │ │
   │ │ │ │ │ │
   │ │ │ 1. ToolRegistry.tools() ──▶ Get all tools │ │ │
   │ │ │ 2. MCP.tools() ──▶ Get MCP server tools │ │ │
   │ │ │ 3. Permission.filter() ──▶ Apply agent permissions │ │ │
   │ │ │ 4. ToolRouter.apply() ──▶ Intent-based filtering │ │ │
   │ │ │ 5. applyExposure() ──▶ Memory-based tool exposure │ │ │
   │ │ │ │ │ │
   │ │ └───────────────────────────────────────────────────────────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌───────────────────────────────────────────────────────────────┐ │ │
   │ │ │ Build System Prompt │ │ │
   │ │ │ │ │ │
   │ │ │ SystemPromptCache.getParts() │ │ │
   │ │ │ - environment │ │ │
   │ │ │ - skills │ │ │
   │ │ │ - instructions (full/deferred/index) │ │ │
   │ │ │ + toolRouterPrompt │ │ │
   │ │ │ + StructuredOutputSystemPrompt (if JSON mode) │ │ │
   │ │ │ │ │ │
   │ │ └───────────────────────────────────────────────────────────────┘ │ │
   │ │ │ │ │
   │ └───────────┼───────────────────────────────────────────────────────────┘ │
   │ │ │
   │ ▼ │
   │ ┌───────────────────────────────────────────────────────────────────────┐ │
   │ │ SessionProcessor.process() │ │
   │ │ │ │
   │ │ ┌────────────────┐ │ │
   │ │ │ LLM.stream() │ ──▶ AI SDK + Provider │ │
   │ │ └───────┬────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌───────────────────────────────────────────────────────────────┐ │ │
   │ │ │ Stream Events: │ │ │
   │ │ │ │ │ │
   │ │ │ - start, text-start/delta/end │ │ │
   │ │ │ - reasoning-start/delta/end │ │ │
   │ │ │ - tool-input-start/delta/end │ │ │
   │ │ │ - tool-call, tool-result, tool-error │ │ │
   │ │ │ - start-step, finish-step │ │ │
   │ │ │ - error, finish │ │ │
   │ │ │ │ │ │
   │ │ └───────────────────────────────────────────────────────────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌───────────────────────────────────────────────────────────────┐ │ │
   │ │ │ Tool Execution Pipeline │ │ │
   │ │ │ │ │ │
   │ │ │ Plugin.trigger("tool.execute.before") │ │ │
   │ │ │ │ │ │ │
   │ │ │ ▼ │ │ │
   │ │ │ ToolRegistry.tool.execute() ──▶ Tool implementation │ │ │
   │ │ │ │ │ │ │
   │ │ │ ▼ │ │ │
   │ │ │ Truncate.output() ──▶ Output truncation │ │ │
   │ │ │ │ │ │ │
   │ │ │ ▼ │ │ │
   │ │ │ Plugin.trigger("tool.execute.after") │ │ │
   │ │ │ │ │ │
   │ │ └───────────────────────────────────────────────────────────────┘ │ │
   │ │ │ │ │
   │ │ ▼ │ │
   │ │ ┌───────────────────────────────────────────────────────────────┐ │ │
   │ │ │ Context Management │ │ │
   │ │ │ │ │ │
   │ │ │ - isOverflow() ──▶ SessionCompaction.process() │ │ │
   │ │ │ - SessionSummary.summarize() │ │ │
   │ │ │ - Snapshot.patch() │ │ │
   │ │ │ │ │ │
   │ │ └───────────────────────────────────────────────────────────────┘ │ │
   │ └─────────────────────────────────────────────────────────────────────────────┘
   └─────────────────────────────────────────────────────────────────────────────┘

---

8. Key Configuration Points
   Initial Tool Tier (session/wire-tier.ts)
   // Configuration flags:
   Flag.OPENCODE_INITIAL_TOOL_TIER = "minimal" | "full"
   Flag.OPENCODE_MINIMAL_TIER_ALL_TURNS = true // Keep minimal every turn

Tool Router Modes (session/tool-router.ts)
// Configuration via Config.experimental.tool_router:
experimental: {
tool_router: {
// Core
enabled: true | false, // Enable/disable router
mode: "rules" | "hybrid", // Routing mode
router_only: true | false, // Disable augment, just filter

    // Tool selection
    max_tools: 12,                   // Max tools to send
    additive: true | false,          // Minimal tier + matches vs subset

    // Intent classification
    local_intent_embed: true,        // Use intent prototypes (default: true)
    local_intent_min_score: 0.38,     // Minimum score for intent match
    intent_merge_margin: 0.04,       // Margin for multi-intent merge
    intent_max_intents: 3,           // Max intents to merge
    intent_conversation_gap: 0.05,   // Gap for conversation vs work

    // Local embeddings (Xenova)
    local_embed: true,               // Use local embeddings
    local_embed_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    local_embed_top_k: 4,            // Top-k tools to augment
    local_embed_min_score: 0.32,     // Min score for embed match

    // Reranking
    rerank: true | false,            // Enable semantic + lexical rerank
    rerank_candidates: 8,
    rerank_semantic_weight: 0.7,
    rerank_lexical_weight: 0.3,

    // Exact match (post-processing)
    exact_match: {
      dynamic_ratio: true,           // Adaptive threshold
      dynamic_ratio_simple: 0.97,     // For simple prompts
      dynamic_ratio_composite: 0.74,  // For multi-step prompts
      per_tool_min: true,            // Tool-specific minimums
      intent_gating: true,            // Penalize web intents
      calibration: true,              // Sigmoid calibration
      redundancy: true,              // Dedupe web tools
      two_pass: true,                 // Two-pass consistency
    },

    // Keyword rules
    keyword_rules: true | false,     // Also use regex rules

    // Sticky tools
    sticky_previous_turn_tools: true, // Carry forward tools

    // First turn
    apply_after_first_assistant: true | false,  // Full tools first turn

    // MCP filtering
    mcp_filter_by_intent: true,       // Filter MCP tools by intent

    // Fallback expansion
    fallback: {
      enabled: true,
      max_expansions_per_turn: 1,
      expand_to: "full",
      recover_empty_without_signal: true,
    },

    // Auto tool selection
    auto_tool_selection: true | false,  // Token budget aware
    auto_score_ratio: 0.88,
    auto_token_budget: 1200,
    max_tools_cap: 100,

    // Prompt injection
    inject_prompt: true,              // Inject router hint

    // Hard gates
    apply_hard_gates: true | false,

    // Exposure mode
    exposure_mode: "per_turn_subset" | "memory_only_unlocked" |
                   "stable_catalog_subset" | "subset_plus_memory_reminder" |
                   "session_accumulative_callable",

}
}

---

---

## 9. Latest Updates (2026-04)

### 9.1 Nuevos Tools Agregados

```
Tool Registry (src/tool/)
├── browser.ts      → Automatización de navegador (stub Puppeteer/Playwright)
├── workflow.ts    → Workflows predefinidos (analyze-codebase, refactor, etc.)
├── cron.ts        → Programación de tareas periódicas
├── team.ts        → Herramientas de trabajo en equipo
└── tool_search.ts → Búsqueda de herramientas disponibles
```

**Browser Tool**: Soporta goto, click, type, screenshot, extract. Stub implementation.

**Workflow Tool**: Workflows predefinidos como:
- `analyze-codebase`: Análisis completo del codebase
- `refactor-module`: Refactorización de módulos
- `test-coverage`: Coverage de tests

**Cron Tool**: Programación de tareas con sintaxis cron.

**Team Tool**: Collaborative features para equipos.

### 9.2 Experimental Features Management

```bash
/features          # CLI: listar y togglear features
# En TUI: Dialog de features con autocomplete
```

- `/features` command en CLI
- `dialog-features.tsx` en TUI
- Persistencia en `config.json`
- Feature flags: `experimental.*`

### 9.3 SDD Tool Permissions + Hard Gates

```typescript
// Agent permissions now include full permission surfaces
experimental: {
  tool_router: {
    apply_hard_gates: true  // Default: true
  }
}

// SDD agents now have granular permissions
sdd-orchestrator, sdd-explore, sdd-propose, sdd-spec,
sdd-design, sdd-tasks, sdd-apply, sdd-verify, sdd-archive, judgment-day
```

### 9.4 Tool Exposure Modes (5 modos)

| Mode | Description |
|------|-------------|
| `per_turn_subset` | Default. Router output, no memory |
| `memory_only_unlocked` | Router + reminder de unlockeds |
| `stable_catalog_subset` | Persiste "unlocked" para futuro |
| `subset_plus_memory_reminder` | Router + reminder line |
| `session_accumulative_callable` | Merge previos + actual, widest set |

### 9.5 Web Pair (Research Intent)

```typescript
// websearch + webfetch ahora aparecen juntos en intents de research
intent prototypes:
// "search the web for information"     → websearch + webfetch
// "find documentation about X"         → websearch + webfetch
// "look up how to do Y"               → websearch + webfetch
```

Hard gates más flexibles para webfetch cuando hay URL en el prompt.

### 9.6 Config System Updates

```typescript
// Nuevos paths en config
config.json -> paths.user, paths.project
config.ts -> Feature persistence inmediata

// Nuevas funcionalidades
- Feature state updates apply immediately
- Config parsing edge-cases resueltos
```

---

This architecture demonstrates a sophisticated multi-agent system with:

1. **Flexible Tool System**: Dynamic tool registration from built-in, custom, plugin, and new workflow/team/browser sources
2. **Intelligent Routing**: Offline intent-based tool filtering using embeddings, keyword rules, exact-match post-processing, and hard gates
3. **Tiered Context Building**: Context-aware system prompt with conversation/minimal/full tiers
4. **Tool Exposure Memory**: 5 different modes for tracking and persisting tool availability across turns
5. **Plugin Hooks**: Extensible middleware for tools, chat, and events
6. **SDD Orchestration**: Hierarchical agent teams with structured workflows + granular permissions
7. **Experimental Features**: CLI/TUI management de feature flags
8. **Team Collaboration**: Workflows, cron jobs, team tools para trabajo en equipo
