Now I have a comprehensive understanding of the architecture. Let me create a detailed analysis:
---
Claude Code Architecture Analysis
1. TOOL SYSTEM ARCHITECTURE
1.1 Tool Registration and Discovery
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TOOL REGISTRATION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  tools.ts (Line 193)                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  getAllBaseTools()                                                  │   │
│  │  ├── AgentTool                                                       │   │
│  │  ├── BashTool                                                        │   │
│  │  ├── FileEditTool                                                    │   │
│  │  ├── FileReadTool                                                    │   │
│  │  ├── FileWriteTool                                                   │   │
│  │  ├── GrepTool                                                        │   │
│  │  ├── GlobTool                                                        │   │
│  │  ├── WebSearchTool                                                   │   │
│  │  ├── ... 50+ other tools                                            │   │
│  │  └── MCP tools (from MCPConnectionManager)                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  assembleToolPool(toolPermissionContext, mcpTools)                  │   │
│  │  ├── Merges base tools + MCP tools                                  │   │
│  │  ├── Applies deny rules from toolPermissionContext                   │   │
│  │  ├── Deduplicates tools (MCP can override base tools)               │   │
│  │  └── Filters by alwaysDenyRules                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  useMergedTools() - React hook for REPL                             │   │
│  │  └── mergeAndFilterTools(initialTools, assembled, mode)              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
1.2 Tool Definition (Tool.ts)
// Core Tool Interface (lines 362-695)
export type Tool<Input, Output, P> = {
  // Core Methods
  call(args, context, canUseTool, parentMessage, onProgress): Promise<ToolResult<Output>>
  description(input, options): Promise<string>
  prompt(options): Promise<string>
  
  // Schemas
  readonly inputSchema: Input  // Zod schema for validation
  outputSchema?: z.ZodType     // Optional output schema
  
  // Metadata
  readonly name: string
  readonly shouldDefer?: boolean      // ToolSearch deferral
  readonly alwaysLoad?: boolean       // Never defer
  aliases?: string[]                  // Backward compatibility
  
  // Permission & Safety
  isConcurrencySafe(input): boolean
  isEnabled(): boolean
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  requiresUserInteraction?(): boolean
  validateInput?(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionResult>
  
  // Rendering
  renderToolUseMessage(input, options): ReactNode
  renderToolResultMessage(content, progress, options): ReactNode
  getToolUseSummary?(input): string | null
}
// Tool Builder Pattern (lines 783-792)
export function buildTool<D extends ToolDef>(def: D): BuiltTool<D>
1.3 Tool Execution Flow
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TOOL EXECUTION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  query.ts (Line 675)                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  for await (message of query({...}))                                 │   │
│  │      │                                                               │   │
│  │      ├─► AssistantMessage (with tool_use blocks)                     │   │
│  │      │                                                               │   │
│  │      ▼                                                               │   │
│  │  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │  │  runTools(toolUseBlocks, ...)                                │   │   │
│  │  │  ├── toolOrchestration.ts (Line 19)                         │   │   │
│  │  │  └── Partitions tools:                                       │   │   │
│  │  │      ├── Concurrency-safe (read-only) → Parallel batch       │   │   │
│  │  │      └── Non-concurrency-safe (writes) → Serial              │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │  │  runToolUse(toolUse, assistantMessage, canUseTool, context)  │   │   │
│  │  │  └── toolExecution.ts (Line 337)                            │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                        │   │
│  └──────────────────────────────┼────────────────────────────────────────┘   │
│                                 │                                          │
│                                 ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      TOOL EXECUTION PHASES                          │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │   │
│  │  │ 1. FIND TOOL │───▶│ 2. VALIDATE  │───▶│ 3. PRE-TOOL HOOKS    │  │   │
│  │  │              │    │    INPUT     │    │                      │  │   │
│  │  │ findToolBy  │    │              │    │ executePreToolHooks  │  │   │
│  │  │ Name(tools,  │    │ inputSchema │    │                      │  │   │
│  │  │   name)      │    │ .safeParse  │    │ • Block/execute/ask  │  │   │
│  │  └──────────────┘    └──────────────┘    │ • Modified input     │  │   │
│  │                                          │ • Additional context  │  │   │
│  │                                          └──────────────────────┘  │   │
│  │                                                      │              │   │
│  │                                                      ▼              │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │   │
│  │  │ 4. PERMISSION│◀───│ 3b. HOOK    │◀───│ 3a. UPDATED INPUT    │  │   │
│  │  │   RESOLUTION │    │   RESULT     │    │                      │  │   │
│  │  │              │    │  PROCESSING  │    │ Hook can modify      │  │   │
│  │  │ resolveHook  │    │              │    │ tool input without   │  │   │
│  │  │ Permission   │    │ PermissionBehavior:                      │  │   │
│  │  │ Decision     │    │ • allow      │    │ making permission    │  │   │
│  │  │              │    │ • deny       │    │ decision (passthrough) │  │   │
│  │  └──────────────┘    └──────────────┘    └──────────────────────┘  │   │
│  │          │                                                           │   │
│  │          ▼                                                           │   │
│  │  ┌──────────────┐                                                   │   │
│  │  │ 5. TOOL CALL │                                                   │   │
│  │  │              │                                                   │   │
│  │  │ tool.call(   │                                                   │   │
│  │  │   input,     │                                                   │   │
│  │  │   context,   │                                                   │   │
│  │  │   canUseTool,│                                                   │   │
│  │  │   progress   │                                                   │   │
│  │  │ )            │                                                   │   │
│  │  └──────────────┘                                                   │   │
│  │          │                                                           │   │
│  │          ▼                                                           │   │
│  │  ┌──────────────┐    ┌──────────────┐                               │   │
│  │  │ 6. POST-TOOL │───▶│ 7. ADD TO    │                               │   │
│  │  │     HOOKS    │    │   MESSAGES   │                               │   │
│  │  │              │    │              │                               │   │
│  │  │ executePost  │    │ createUser   │                               │   │
│  │  │ ToolHooks    │    │ Message({    │                               │   │
│  │  │              │    │   tool_result │                               │   │
│  │  │ • Can modify │    │ })           │                               │   │
│  │  │   MCP output │    └──────────────┘                               │   │
│  │  │ • Additional  │                                                   │   │
│  │  │   context    │                                                   │   │
│  │  └──────────────┘                                                   │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
1.4 Hook Integration with Tools
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HOOK LIFECYCLE INTEGRATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  toolHooks.ts orchestrates the hook system:                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  runPreToolUseHooks() - Line 435                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  executePreToolHooks() from utils/hooks.ts                    │ │   │
│  │  │                                                                  │ │   │
│  │  │  1. getMatchingHooks() - Find hooks by tool name                │ │   │
│  │  │  2. Execute each hook (command/prompt/agent/http/callback)     │ │   │
│  │  │  3. Process JSON output into HookResult                        │ │   │
│  │  │  4. Aggregate permission behaviors (deny > ask > allow)         │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  │                              │                                        │   │
│  │         ┌────────────────────┼────────────────────┐                   │   │
│  │         ▼                    ▼                    ▼                   │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐       │   │
│  │  │  'message'  │    │  'hookPer-  │    │   'hookUpdatedInput' │       │   │
│  │  │             │    │  missionResult'  │   (passthrough)      │       │   │
│  │  │ Progress or │    │                │                      │       │   │
│  │  │ attachment   │    │ behavior:     │ Hook modified the    │       │   │
│  │  │ from hook   │    │ • allow       │ input without        │       │   │
│  │  └─────────────┘    │ • deny       │ making a permission  │       │   │
│  │                      │ • ask        │ decision             │       │   │
│  │                      └─────────────┘                      │       │   │
│  │                                                             └───────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  resolveHookPermissionDecision() - Line 332                        │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Hook permission flows through rule-based permissions:          │ │   │
│  │  │                                                                  │ │   │
│  │  │  Hook 'allow' → checkRuleBasedPermissions → final decision    │ │   │
│  │  │  Hook 'deny'  → immediate deny                                  │ │   │
│  │  │  Hook 'ask'    → force permission dialog                        │ │   │
│  │  │  No hook      → normal canUseTool flow                           │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  runPostToolUseHooks() - Line 39                                    │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │  executePostToolHooks() from utils/hooks.ts                    │ │   │
│  │  │                                                                  │ │   │
│  │  │  1. getMatchingHooks()                                         │ │   │
│  │  │  2. Execute hooks with toolOutput                               │ │   │
│  │  │  3. Can return updatedMCPToolOutput for MCP tools              │ │   │
│  │  │  4. Can add additionalContext                                   │ │   │
│  │  │  5. Can preventContinuation                                     │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
---
2. SESSION/PROMPT ARCHITECTURE
2.1 Prompt Building
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROMPT BUILDING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  QueryEngine.ts (Line 288)                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  fetchSystemPromptParts({tools, mainLoopModel, ...})                │   │
│  │  └── Called from query.ts → returns defaultSystemPrompt parts        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SYSTEM PROMPT COMPOSITION                                            │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  systemPrompt = asSystemPrompt([                                      │   │
│  │    ...customSystemPrompt ?? defaultSystemPrompt,                       │   │
│  │    memoryMechanicsPrompt?,  // If autoMemPathOverride set             │   │
│  │    appendSystemPrompt?      // Additional user/system prompt          │   │
│  │  ])                                                                     │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CONTEXT BUILDING                                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  getSystemContext() - context.ts (Line 116)                          │   │
│  │  ├── Git status (branch, status, recent commits)                    │   │
│  │  ├── Cache breaker (if BREAK_CACHE_COMMAND enabled)                   │   │
│  │  └── Cached memoized per session                                     │   │
│  │                                                                        │   │
│  │  getUserContext() - context.ts (Line 155)                            │   │
│  │  ├── CLAUDE.md content (from getClaudeMds)                          │   │
│  │  ├── Today's date                                                     │   │
│  │  └── Cached memoized per session                                     │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  TOOL DESCRIPTIONS                                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  Each tool.prompt() generates its description:                       │   │
│  │  ├── ToolPrompt(options): Promise<string>                             │   │
│  │  ├── Includes input schema, examples, constraints                      │   │
│  │  └── Includes permission context for conditional behavior              │   │
│  │                                                                        │   │
│  │  ToolSearchTool enables deferral:                                    │   │
│  │  ├── shouldDefer: true → defer_loading in API                        │   │
│  │  ├── alwaysLoad: true → always sent                                 │   │
│  │  └── ToolSearch tool discovers and loads deferred tools               │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
2.2 Tool Deferral Mechanism
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TOOL DEFERRED LOADING                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Tool Deferral Flow:                                                       │
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐ │
│  │ TOOL REGIS-  │    │ TOOL SENT    │    │ TOOL SEARCH TOOL            │ │
│  │ TRATION      │    │ TO LLM       │    │                              │ │
│  │              │    │              │    │ When model tries to use a   │ │
│  │ Tool has     │    │ If alwaysLoad│    │ deferred tool:              │ │
│  │ shouldDefer  │───▶│ = true      │    │                              │ │
│  │ = true       │    │             │    │ 1. API returns error with   │ │
│  │              │    │ If defer_    │    │    defer_loading hint       │ │
│  └──────────────┘    │ loading flag│───▶│                              │ │
│                       │ sent        │    │ 2. Model calls ToolSearch   │ │
│                       │             │    │    with query="select:tool" │ │
│                       └──────────────┘    │                              │ │
│                                            │ 3. ToolSearch loads the     │ │
│                                            │    deferred tool schema     │ │
│                                            │                              │ │
│                                            │ 4. Model retries the call   │ │
│                                            │    with schema now present  │ │
│                                            └──────────────────────────────┘ │
│                                                                             │
│  Deferred Tool Detection (toolExecution.ts, Line 578):                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  buildSchemaNotSentHint()                                          │   │
│  │  ├── Check if tool.isDeferred                                      │   │
│  │  ├── Check if tool was in discovered set                           │   │
│  │  └── If schema not sent → hint model to load via ToolSearch       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
2.3 Message Flow
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MESSAGE FLOW ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        MESSAGE TYPES                                  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  type Message =                                                       │   │
│  │    | { type: 'user', message: {...}, content: [...] }              │   │
│  │    | { type: 'assistant', message: {...}, content: [...] }          │   │
│  │    | { type: 'system', subtype: 'compact_boundary', ... }            │   │
│  │    | { type: 'system', subtype: 'hook_additional_context', ... }    │   │
│  │    | { type: 'attachment', attachment: {...} }                       │   │
│  │    | { type: 'progress', data: {...} }                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     QUERY LOOP (query.ts)                           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  messages[] ──▶ normalizeMessagesForAPI() ──▶ API Request          │   │
│  │                    │                                                │   │
│  │                    └──▶ filter: tool_results, system reminders,     │   │
│  │                            compact boundaries, etc.                   │   │
│  │                                                                      │   │
│  │  API Response Stream:                                                │   │
│  │      │                                                              │   │
│  │      ├── content_block (text) ──▶ AssistantMessage.content         │   │
│  │      ├── content_block (tool_use) ──▶ Collect for batch execution │   │
│  │      └── content_block (thinking) ──▶ Preserved per trajectory    │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
---
3. PLUGIN ARCHITECTURE
3.1 Plugin Loading
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PLUGIN LOADING FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     PLUGIN SOURCES                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  1. Built-in Plugins (plugins/bundled/index.ts)                       │   │
│  │     └── Ships with CLI, always available                             │   │
│  │                                                                        │   │
│  │  2. User Plugins (~/.claude/plugins/)                                │   │
│  │     └── User-installed via /plugin command                           │   │
│  │                                                                        │   │
│  │  3. Marketplace Plugins                                               │   │
│  │     └── Downloaded from plugin marketplace                           │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PLUGIN MANIFEST (manifest.json)                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  {                                                                   │   │
│  │    "name": "my-plugin",                                             │   │
│  │    "version": "1.0.0",                                              │   │
│  │    "commands": "./commands",          // Slash commands              │   │
│  │    "agents": "./agents",              // Custom agents                │   │
│  │    "skills": "./skills",              // Skill definitions           │   │
│  │    "hooks": "./hooks.json",            // Hook configurations         │   │
│  │    "mcpServers": {...},               // MCP server configs          │   │
│  │    "lspServers": {...}                // LSP server configs          │   │
│  │  }                                                                   │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LOADER (utils/plugins/pluginLoader.ts)           │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  loadAllPlugins()                                                    │   │
│  │  ├── Load manifest.json from each plugin directory                  │   │
│  │  ├── Validate against PluginManifest schema                         │   │
│  │  ├── Load commands, agents, skills, hooks                           │   │
│  │  ├── Start MCP servers                                               │   │
│  │  └── Start LSP servers                                               │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
3.2 Plugin Hooks
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PLUGIN HOOK SYSTEM                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      HOOK TYPES (schemas/hooks.ts)                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  HookCommand =                                                         │   │
│  │    | { type: 'command', command: string, if?: string, ... }        │   │
│  │    | { type: 'prompt', prompt: string, model?: string, ... }       │   │
│  │    | { type: 'agent', prompt: string, model?: string, ... }        │   │
│  │    | { type: 'http', url: string, headers?: {...}, ... }            │   │
│  │                                                                        │   │
│  │  Hook Matcher = { matcher?: string, hooks: HookCommand[] }         │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   HOOK CONFIGURATION                                  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  hooks.json:                                                         │   │
│  │  {                                                                   │   │
│  │    "PreToolUse": [                                                  │   │
│  │      {                                                              │   │
│  │        "matcher": "Bash",           // Tool name pattern            │   │
│  │        "hooks": [                    // Commands to run            │   │
│  │          { "type": "command", "command": "echo $ARGUMENTS" }       │   │
│  │        ]                                                            │   │
│  │      }                                                              │   │
│  │    ]                                                                 │   │
│  │  }                                                                   │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   HOOK EXECUTION (utils/hooks.ts)                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  executeHooks({hookInput, toolUseID, ...}) - Line 1952             │   │
│  │  │                                                                   │   │
│  │  ├── getMatchingHooks(appState, sessionId, event, hookInput)       │   │
│  │  │   ├── Settings hooks (hooksConfigFromSnapshot)                   │   │
│  │  │   ├── Registered hooks (getRegisteredHooks)                      │   │
│  │  │   └── Session hooks (getSessionHooks)                            │   │
│  │  │                                                                   │   │
│  │  ├── Filter by matcher pattern                                       │   │
│  │  ├── Evaluate 'if' conditions                                       │   │
│  │  ├── Deduplicate hooks (by command + shell + if)                    │   │
│  │  │                                                                   │   │
│  │  └── Execute hooks in parallel:                                      │   │
│  │      ├── command → execCommandHook() → spawn shell                   │   │
│  │      ├── prompt  → execPromptHook() → LLM evaluation               │   │
│  │      ├── agent   → execAgentHook() → Sub-agent                      │   │
│  │      └── http    → execHttpHook() → HTTP POST                       │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
3.3 Session Hooks
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SESSION HOOK MANAGEMENT                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  utils/hooks/sessionHooks.ts                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SessionHooksState = Map<sessionId, SessionStore>                   │   │
│  │                                                                        │   │
│  │  SessionStore = {                                                     │   │
│  │    hooks: {                                                           │   │
│  │      [event]: SessionHookMatcher[]                                    │   │
│  │    }                                                                   │   │
│  │  }                                                                     │   │
│  │                                                                        │   │
│  │  SessionHookMatcher = {                                                │   │
│  │    matcher: string,                                                    │   │
│  │    skillRoot?: string,                                                │   │
│  │    hooks: [{ hook: HookCommand, onHookSuccess? }]                    │   │
│  │  }                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     HOOK MANAGEMENT API                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  addSessionHook(setAppState, sessionId, event, matcher, hook, cb)  │   │
│  │  addFunctionHook(setAppState, sessionId, event, matcher, callback) │   │
│  │  removeFunctionHook(setAppState, sessionId, event, hookId)          │   │
│  │  clearSessionHooks(setAppState, sessionId)                          │   │
│  │                                                                        │   │
│  │  getSessionHooks(appState, sessionId, event)                        │   │
│  │  getSessionFunctionHooks(appState, sessionId, event)                │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Key Points:                                                               │
│  - Session hooks are ephemeral (in-memory, cleared on session end)          │
│  - Function hooks execute TypeScript callbacks directly (fast)              │
│  - Map-based storage avoids React re-render on mutation                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
---
4. MESSAGE/STATE ARCHITECTURE
4.1 AppState Structure
┌─────────────────────────────────────────────────────────────────────────────┐
│                          APPSTATE STRUCTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  AppState.tsx / AppStateStore.ts                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        CORE STATE                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  settings: SettingsJson          // User configuration               │   │
│  │  verbose: boolean               // Verbose mode flag                 │   │
│  │  mainLoopModel: ModelSetting     // Current model                    │   │
│  │  toolPermissionContext: ToolPermissionContext                         │   │
│  │  │   mode: 'default' | 'auto' | 'bypass'                          │   │
│  │  │   alwaysAllowRules: {...}                                        │   │
│  │  │   alwaysDenyRules: {...}                                        │   │
│  │  │   alwaysAskRules: {...}                                         │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       MCP STATE                                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  mcp: {                                                             │   │
│  │    clients: MCPServerConnection[]  // Connected MCP servers          │   │
│  │    tools: Tool[]                  // Tools from MCP servers           │   │
│  │    commands: Command[]           // Commands from MCP servers       │   │
│  │    resources: Record<server, ServerResource[]>                     │   │
│  │  }                                                                     │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PLUGIN STATE                                      │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  plugins: {                                                          │   │
│  │    enabled: LoadedPlugin[]                                           │   │
│  │    disabled: LoadedPlugin[]                                          │   │
│  │    commands: Command[]                                                │   │
│  │    errors: PluginError[]                                              │   │
│  │  }                                                                     │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SESSION HOOKS STATE                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  sessionHooks: SessionHooksState  // Map<sessionId, SessionStore> │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
4.2 ToolUseContext
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TOOL USE CONTEXT                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Tool.ts (Line 158-300)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  type ToolUseContext = {                                            │   │
│  │                                                                        │   │
│  │    // Options (immutable during tool execution)                       │   │
│  │    options: {                                                         │   │
│  │      commands: Command[]                                              │   │
│  │      tools: Tools                   // Available tools                │   │
│  │      mcpClients: MCPServerConnection[]                               │   │
│  │      agentDefinitions: AgentDefinitionsResult                        │   │
│  │      isNonInteractiveSession: boolean                                 │   │
│  │      customSystemPrompt?: string                                      │   │
│  │      refreshTools?: () => Tools                                       │   │
│  │    }                                                                   │   │
│  │                                                                        │   │
│  │    // State access                                                    │   │
│  │    getAppState(): AppState                                            │   │
│  │    setAppState(f: (prev) => AppState): void                          │   │
│  │                                                                        │   │
│  │    // Abort control                                                   │   │
│  │    abortController: AbortController                                   │   │
│  │                                                                        │   │
│  │    // Progress tracking                                               │   │
│  │    setInProgressToolUseIDs(f: (prev) => Set<string>): void            │   │
│  │    setResponseLength(f: (prev) => number): void                       │   │
│  │                                                                        │   │
│  │    // Session info                                                    │   │
│  │    messages: Message[]              // Conversation history           │   │
│  │    agentId?: AgentId                // Subagent identifier           │   │
│  │    queryTracking?: QueryChainTracking                                │   │
│  │                                                                        │   │
│  │    // UI callbacks                                                    │   │
│  │    setToolJSX?: SetToolJSXFn        // Set custom tool UI            │   │
│  │    requestPrompt?: (source, summary) => PromptRequest => Promise     │   │
│  │  }                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
4.3 Context Compaction
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT COMPACTION                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Compaction is triggered when:                                             │
│  ├── Token limit approaching (isAutoCompactEnabled)                       │
│  ├── Manual /compact command                                               │
│  └── Pre-defined boundaries                                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     COMPACTION FLOW                                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                        │   │
│  │  1. PRE-COMPACT HOOKS                                                │   │
│  │     └── executePreCompactHooks()                                      │   │
│  │                                                                        │   │
│  │  2. COMPACTION PROCESS                                                │   │
│  │     ├── Analyze messages for summarization                            │   │
│  │     ├── Identify tool results to preserve                              │   │
│  │     ├── Generate compact summary                                       │   │
│  │     └── Insert compact_boundary system message                         │   │
│  │                                                                        │   │
│  │  3. POST-COMPACT HOOKS                                                │   │
│  │     └── executePostCompactHooks()                                     │   │
│  │                                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Message Preservation Rules:                                                │
│  ├── Tool results that modified files → preserved                           │
│  ├── Error messages → preserved                                            │
│  ├── User messages with attachments → preserved                            │
│  ├── Long tool outputs → stored to disk, referenced by path               │
│  └── Intermediate steps → summarized/replaced                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
---
5. KEY ARCHITECTURAL PATTERNS
5.1 Async Generator Pattern for Tool Execution
// toolExecution.ts (Line 337)
export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  // Yields MessageUpdateLazy with:
  // - message: UserMessage | AttachmentMessage | ProgressMessage
  // - contextModifier?: For concurrency-safe context updates
}
// Enables streaming of:
  // - Progress messages during tool execution
  // - Hook results as they arrive
  // - Permission prompts
  // - Final tool results
5.2 Parallel vs Serial Tool Execution
// toolOrchestration.ts (Line 26)
for (const { isConcurrencySafe, blocks } of partitionToolCalls(...)) {
  if (isConcurrencySafe) {
    // Read-only tools: Bash(git *), Grep, Glob, Read
    yield* runToolsConcurrently(blocks, ...)
  } else {
    // Write tools: Edit, Write, Bash(rm *), etc.
    yield* runToolsSerially(blocks, ...)
  }
}
5.3 Hook Precedence
// utils/hooks.ts (Line 2826)
switch (result.permissionBehavior) {
  case 'deny':
    permissionBehavior = 'deny'  // Deny always wins
    break
  case 'ask':
    if (permissionBehavior !== 'deny') {
      permissionBehavior = 'ask'  // Ask overrides allow
    }
    break
  case 'allow':
    if (!permissionBehavior) {
      permissionBehavior = 'allow'  // Only set if undefined
    }
    break
}
5.4 Message Normalization for API
// normalizeMessagesForAPI() - removes UI-only messages:
  // - compact_boundary messages
  // - hook_additional_context (merged into context)
  // - progress messages (extracted separately)
  // - local_command output tags
---
6. SUMMARY ARCHITECTURE DIAGRAM
┌────────────────────────────────────────────────────────────────────────────────┐
│                              CLAUDE CODE ARCHITECTURE                            │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                              ENTRY POINTS                                │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   main.tsx ──────▶ REPL ───────────────────────────────────────────────│   │
│  │                      │                                                   │   │
│  │                      ▼                                                   │   │
│  │   QueryEngine.ts ──▶ SDK/Headless ──────────────────────────────────────│   │
│  │                      │                                                   │   │
│  └──────────────────────┼───────────────────────────────────────────────────┘   │
│                         │                                                     │
│                         ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                           STATE LAYER                                     │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   AppState (React Context + Zustand-like Store)                         │   │
│  │   ├── settings, toolPermissionContext, MCP clients, plugins, etc.        │   │
│  │   └── sessionHooks (Map<sessionId, SessionStore>)                       │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                         │                                                     │
│                         ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          TOOL LAYER                                      │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   Tool Registry (tools.ts)                                              │   │
│  │   ├── getAllBaseTools() → Built-in tools                                │   │
│  │   ├── assembleToolPool() → Base + MCP tools                             │   │
│  │   └── useMergedTools() → REPL integration                               │   │
│  │                                                                          │   │
│  │   Tool Execution (toolExecution.ts)                                      │   │
│  │   ├── runToolUse() → PreToolUse hooks → Permission → Execute → PostTool│   │
│  │   └── Streaming message updates via AsyncGenerator                       │   │
│  │                                                                          │   │
│  │   Tool Orchestration (toolOrchestration.ts)                               │   │
│  │   ├── partitionToolCalls() → Concurrent vs Serial                        │   │
│  │   └── runTools() → Orchestrates parallel/serial execution              │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                         │                                                     │
│                         ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          HOOK LAYER                                      │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   Hook System (utils/hooks.ts)                                          │   │
│  │   ├── Hook Types: command, prompt, agent, http, callback               │   │
│  │   ├── Hook Events: PreToolUse, PostToolUse, SessionStart, etc.          │   │
│  │   ├── getMatchingHooks() → Settings + Registered + Session hooks       │   │
│  │   └── executeHooks() → Parallel execution with aggregation              │   │
│  │                                                                          │   │
│  │   Plugin Hooks (types/plugin.ts)                                         │   │
│  │   ├── manifest.json → hooks.json                                        │   │
│  │   └── LoadedPlugin → HooksSettings                                       │   │
│  │                                                                          │   │
│  │   Session Hooks (utils/hooks/sessionHooks.ts)                           │   │
│  │   ├── addSessionHook() / addFunctionHook()                             │   │
│  │   └── SessionHooksState (Map-based for no re-renders)                   │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                         │                                                     │
│                         ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         PROMPT LAYER                                     │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   Prompt Building (context.ts, query.ts)                                │   │
│  │   ├── fetchSystemPromptParts() → Default + Custom + Append              │   │
│  │   ├── getSystemContext() → Git status, cache breaker                   │   │
│  │   └── getUserContext() → CLAUDE.md, date                               │   │
│  │                                                                          │   │
│  │   Tool Prompts (Tool.ts)                                                │   │
│  │   └── tool.prompt() → Generates tool description for LLM              │   │
│  │                                                                          │   │
│  │   Tool Deferral (ToolSearchTool)                                        │   │
│  │   ├── shouldDefer → defer_loading flag                                 │   │
│  │   └── buildSchemaNotSentHint() → Model guidance                        │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                         │                                                     │
│                         ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        MESSAGE LAYER                                     │   │
│  ├─────────────────────────────────────────────────────────────────────────┤   │
│  │                                                                          │   │
│  │   Message Types (types/message.ts)                                       │   │
│  │   ├── user, assistant, system (with subtypes)                           │   │
│  │   ├── attachment, progress                                             │   │
│  │   └── tool_use, tool_result blocks                                      │   │
│  │                                                                          │   │
│  │   Query Loop (query.ts)                                                  │   │
│  │   ├── normalizeMessagesForAPI()                                        │   │
│  │   ├── API streaming with content block collection                       │   │
│  │   └── Context compaction                                                │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
---
Key Files Reference
File	Purpose
src/Tool.ts	Core Tool interface, ToolUseContext, buildTool factory
src/tools.ts	Tool registry, getAllBaseTools, assembleToolPool
src/services/tools/toolExecution.ts	Tool execution flow, PreToolUse/PostToolUse hooks
src/services/tools/toolOrchestration.ts	Concurrent vs serial tool execution
src/services/tools/toolHooks.ts	Hook permission resolution, hook result processing
src/utils/hooks.ts	Hook execution, matching, JSON parsing
src/utils/hooks/sessionHooks.ts	Session-scoped ephemeral hooks
src/hooks/useMergedTools.ts	React hook for tool pool in REPL
src/context.ts	System and user context building
src/QueryEngine.ts	SDK/headless query engine
src/query.ts	Main query loop with streaming
src/state/AppState.tsx	React state management
src/state/AppStateStore.ts	AppState type definitions
src/types/plugin.ts	Plugin types and structures
src/schemas/hooks.ts	Hook Zod schemas