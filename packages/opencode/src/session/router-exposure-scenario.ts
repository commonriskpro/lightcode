import type { MessageV2 } from "./message-v2"
import type { Config } from "@/config/config"
import { ToolRouter, stickyToolIdsFromMessages } from "./tool-router"
import {
  applyExposure,
  memoryFromMessages,
  normalizeExposureMode,
  type ExposureMode,
} from "./tool-exposure"
import { buildEvalTools, defaultEvalRouterConfig, mergeEvalConfig } from "./router-eval-context"

export type ScenarioTurnExpect = {
  /** Chit-chat: no router tools; tier is conversation or minimal (embed often uses minimal for short pleasantries). */
  chitchat?: boolean
  router_selected_contains?: string[]
  router_selected_not_contains?: string[]
  callable_after?: string[]
  callable_after_contains?: string[]
  /** Exposure memory (`toolExposureSessionCallableIds` semantics), not necessarily equal to attached when sticky/router widens. */
  session_callable_exact?: string[]
  session_callable_contains?: string[]
  session_callable_not_contains?: string[]
  unlocked_after?: string[]
  unlocked_after_contains?: string[]
  forbidden_after?: string[]
  attached_contains?: string[]
  attached_not_contains?: string[]
  conversation?: boolean
  reminder_injected?: boolean
  min_attached_bytes?: number
  min_attached_count?: number
}

export type ScenarioTurn = {
  user: string
  allowed_tools?: string[]
  expect: ScenarioTurnExpect
}

export type ScenarioFixture = {
  id: string
  category?: string
  mode: ExposureMode
  allowed_tools?: string[]
  router?: Partial<NonNullable<Config.Info["experimental"]>["tool_router"]>
  turns: ScenarioTurn[]
}

export type ScenarioDefaults = {
  allowed_tools: string[]
  router?: Partial<NonNullable<Config.Info["experimental"]>["tool_router"]>
}

export type ExposureScenarioTurnResult = {
  user: string
  router_selected: string[]
  attached_ids: string[]
  unlocked: string[]
  session_callable: string[]
  context_tier: string
  reminder_injected: boolean
  approx_attached_bytes: number
  approx_attached_tokens: number
  widened_vs_router: boolean
}

function sortU(ids: string[]) {
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function assertContainsAll(name: string, haystack: string[], needle: string[], ctx: string) {
  for (const id of needle) {
    if (!haystack.includes(id)) throw new Error(`${ctx}: expected ${name} to contain "${id}", got [${haystack.join(",")}]`)
  }
}

function assertContainsNone(name: string, haystack: string[], forbidden: string[], ctx: string) {
  for (const id of forbidden) {
    if (haystack.includes(id)) throw new Error(`${ctx}: expected ${name} to omit "${id}", got [${haystack.join(",")}]`)
  }
}

function exactMatch(actual: string[], expected: string[], ctx: string) {
  const a = sortU(actual)
  const e = sortU(expected)
  if (a.length !== e.length || a.some((x, i) => x !== e[i])) {
    throw new Error(`${ctx}: expected exact [${e.join(",")}], got [${a.join(",")}]`)
  }
}

export function assertTurnExpect(input: {
  mode: ExposureMode
  expect: ScenarioTurnExpect
  result: ExposureScenarioTurnResult
  ctx: string
  prev_attached_bytes: number
}): { attached_bytes: number } {
  const { mode, expect: exp, result: r, ctx } = input
  const attached = sortU(r.attached_ids)

  if (exp.conversation !== undefined) {
    const isConv = r.context_tier === "conversation"
    if (isConv !== exp.conversation) throw new Error(`${ctx}: expected conversation=${exp.conversation}, got tier=${r.context_tier}`)
  }

  if (exp.chitchat !== undefined) {
    const empty = r.router_selected.length === 0
    const tierOk = r.context_tier === "conversation" || r.context_tier === "minimal"
    const ok = empty && tierOk
    if (ok !== exp.chitchat) {
      throw new Error(
        `${ctx}: expected chitchat=${exp.chitchat} (empty tools + tier conversation|minimal), got tier=${r.context_tier} selected=[${r.router_selected.join(",")}]`,
      )
    }
  }

  assertContainsAll("router_selected", r.router_selected, exp.router_selected_contains ?? [], ctx)
  assertContainsNone("router_selected", r.router_selected, exp.router_selected_not_contains ?? [], ctx)

  assertContainsAll("attached", attached, exp.attached_contains ?? [], ctx)
  assertContainsNone("attached", attached, exp.attached_not_contains ?? [], ctx)
  assertContainsNone("attached (forbidden_after)", attached, exp.forbidden_after ?? [], ctx)

  const callable =
    mode === "per_turn_subset" ? sortU(r.attached_ids) : sortU(r.session_callable)

  if (exp.callable_after !== undefined) exactMatch(callable, exp.callable_after, ctx)
  assertContainsAll("callable", callable, exp.callable_after_contains ?? [], ctx)

  if (exp.session_callable_exact !== undefined) exactMatch(sortU(r.session_callable), exp.session_callable_exact, ctx)
  assertContainsAll("session_callable", sortU(r.session_callable), exp.session_callable_contains ?? [], ctx)
  assertContainsNone("session_callable", sortU(r.session_callable), exp.session_callable_not_contains ?? [], ctx)

  if (exp.unlocked_after !== undefined) exactMatch(sortU(r.unlocked), exp.unlocked_after, ctx)
  assertContainsAll("unlocked", sortU(r.unlocked), exp.unlocked_after_contains ?? [], ctx)

  if (exp.reminder_injected !== undefined && exp.reminder_injected !== r.reminder_injected) {
    throw new Error(`${ctx}: expected reminder_injected=${exp.reminder_injected}, got ${r.reminder_injected}`)
  }

  if (exp.min_attached_bytes !== undefined && r.approx_attached_bytes < exp.min_attached_bytes) {
    throw new Error(`${ctx}: expected min_attached_bytes>=${exp.min_attached_bytes}, got ${r.approx_attached_bytes}`)
  }

  if (exp.min_attached_count !== undefined && attached.length < exp.min_attached_count) {
    throw new Error(`${ctx}: expected min_attached_count>=${exp.min_attached_count}, got ${attached.length}`)
  }

  return { attached_bytes: r.approx_attached_bytes }
}

function baseUser(id: string, text: string, created: number): MessageV2.WithParts {
  return {
    info: {
      id: id as any,
      sessionID: "exp-sc" as any,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "opencode" as any, modelID: "m0" as any },
    },
    parts: [
      {
        type: "text",
        text,
        id: `${id}-p` as any,
        sessionID: "exp-sc" as any,
        messageID: id as any,
      },
    ],
  } as MessageV2.WithParts
}

function baseAssistant(
  id: string,
  parent: string,
  created: number,
  exposure: { unlocked: string[]; sessionCallable: string[] },
  toolRouterActiveIds: string[],
): MessageV2.WithParts {
  return {
    info: {
      id: id as any,
      sessionID: "exp-sc" as any,
      role: "assistant",
      parentID: parent as any,
      time: { created },
      mode: "primary",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "m0" as any,
      providerID: "opencode" as any,
      toolRouterActiveIds: toolRouterActiveIds.length ? sortU(toolRouterActiveIds) : undefined,
      toolExposureUnlockedIds: exposure.unlocked.length ? sortU(exposure.unlocked) : undefined,
      toolExposureSessionCallableIds: exposure.sessionCallable.length ? sortU(exposure.sessionCallable) : undefined,
    },
    parts: [],
  } as MessageV2.WithParts
}

export type RunExposureScenarioResult = {
  id: string
  ok: true
  turns: ExposureScenarioTurnResult[]
} | {
  id: string
  ok: false
  error: string
}

export async function runExposureScenario(input: {
  scenario: ScenarioFixture
  defaults?: ScenarioDefaults
  shutdownEmbed?: () => void
}): Promise<RunExposureScenarioResult> {
  const { scenario, defaults } = input
  const baseAllowed = scenario.allowed_tools ?? defaults?.allowed_tools
  if (!baseAllowed?.length) {
    return { id: scenario.id, ok: false, error: "missing allowed_tools" }
  }

  const routerPatch: Partial<NonNullable<Config.Info["experimental"]>["tool_router"]> = {
    keyword_rules: true,
    local_intent_embed: true,
    local_embed: true,
    ...defaults?.router,
    ...scenario.router,
  }

  const cfg = mergeEvalConfig(defaultEvalRouterConfig(), {
    exposure_mode: scenario.mode,
    ...routerPatch,
  })

  const mode = normalizeExposureMode(cfg.experimental?.tool_router?.exposure_mode)

  let messages: MessageV2.WithParts[] = []
  const turnResults: ExposureScenarioTurnResult[] = []
  let t = 1
  let msgSeq = 0
  let prevAttachedBytes = 0

  const prevRouter = process.env.OPENCODE_TOOL_ROUTER
  process.env.OPENCODE_TOOL_ROUTER = "1"

  try {
    for (const turn of scenario.turns) {
      const allowed = turn.allowed_tools ?? baseAllowed
      const tools = buildEvalTools(allowed)
      const allowedSet = new Set(allowed)
      const uid = `u-${scenario.id}-${++msgSeq}`
      messages = [...messages, baseUser(uid, turn.user, t++)]

      const prior = memoryFromMessages(messages)
      const sticky = stickyToolIdsFromMessages(messages)

      const routed = await ToolRouter.apply({
        tools,
        registryTools: tools,
        allowedToolIds: allowedSet,
        messages,
        agent: { name: "build", mode: "primary" },
        cfg,
        mcpIds: new Set(),
        skip: false,
        stickyToolIds: sticky,
      })

      const exposed = applyExposure({
        mode,
        routed,
        registryTools: tools,
        allowedToolIds: allowedSet,
        messages,
        prior,
      })

      const routerSelected = Object.keys(routed.tools).sort()
      const attachedIds = Object.keys(exposed.tools).sort()

      const result: ExposureScenarioTurnResult = {
        user: turn.user,
        router_selected: routerSelected,
        attached_ids: attachedIds,
        unlocked: sortU(exposed.updated.unlocked),
        session_callable: sortU(exposed.updated.sessionCallable),
        context_tier: routed.contextTier,
        reminder_injected: exposed.reminderInjected,
        approx_attached_bytes: exposed.approxAttachedBytes,
        approx_attached_tokens: exposed.approxAttachedTokens,
        widened_vs_router: exposed.widenedVsRouter,
      }
      turnResults.push(result)

      const ctx = `${scenario.id} turn ${turnResults.length} (${turn.user.slice(0, 48)}…)`
      try {
        assertTurnExpect({
          mode,
          expect: turn.expect,
          result,
          ctx,
          prev_attached_bytes: prevAttachedBytes,
        })
      } catch (e) {
        return { id: scenario.id, ok: false, error: e instanceof Error ? e.message : String(e) }
      }

      prevAttachedBytes = result.approx_attached_bytes

      const aid = `a-${scenario.id}-${msgSeq}`
      messages = [
        ...messages,
        baseAssistant(
          aid,
          uid,
          t++,
          { unlocked: exposed.updated.unlocked, sessionCallable: exposed.updated.sessionCallable },
          attachedIds,
        ),
      ]
    }

    return { id: scenario.id, ok: true, turns: turnResults }
  } catch (e) {
    return { id: scenario.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (prevRouter === undefined) delete process.env.OPENCODE_TOOL_ROUTER
    else process.env.OPENCODE_TOOL_ROUTER = prevRouter
    input.shutdownEmbed?.()
  }
}

export function scenariosGrowAttachedSacVsSpr(input: {
  sac: ExposureScenarioTurnResult[]
  spr: ExposureScenarioTurnResult[]
}): { ok: boolean; detail?: string } {
  const { sac, spr } = input
  if (sac.length < 2 || spr.length < 2) return { ok: false, detail: "need >=2 turns" }
  const sum = (rows: ExposureScenarioTurnResult[]) => rows.reduce((a, r) => a + r.approx_attached_bytes, 0)
  const sumSac = sum(sac)
  const sumSpr = sum(spr)
  if (sumSac <= sumSpr) return { ok: false, detail: `SAC sum ${sumSac} should exceed SPR sum ${sumSpr}` }
  return { ok: true }
}
