import { Instance } from "../project/instance"

import PROMPT_LIGHTCODE from "./prompt/lightcode.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Token } from "@/util/token"
import { OM } from "./om"
import { parseObservationGroups } from "./om/groups"
import type { SessionID } from "./schema"
import type { ObservationRecord } from "@/memory/contracts"

export namespace SystemPrompt {
  export function provider(_model: Provider.Model) {
    return [PROMPT_LIGHTCODE]
  }

  export async function environment(_model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `</env>`,
        `<directories>`,
        `  `,
        `</directories>`,
      ].join("\n"),
    ]
  }

  // Volatile data — changes between turns (date, model identity).
  // Injected as uncached system[2] to avoid invalidating cache on system[0] and system[1].
  export function volatile(model: Provider.Model) {
    return [
      `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
      `Today's date: ${new Date().toDateString()}`,
    ].join("\n")
  }

  export async function skills(agent: Agent.Info) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      Skill.fmt(list, { verbose: false }),
    ].join("\n")
  }

  export function capRecallBody(txt: string): string {
    const cap = 2000
    return Token.estimate(txt) > cap ? txt.slice(0, cap * 4) : txt
  }

  /**
   * Wrap recall results for system prompt injection.
   * Uses <memory-recall> tag for the native semantic recall layer.
   */
  export function wrapRecall(body: string): string {
    return `<memory-recall>\n${body}\n</memory-recall>`
  }

  /**
   * V3: instruction for when agents should write to working memory.
   * Injected alongside the working memory block so agents know when to update it.
   */
  export const WORKING_MEMORY_GUIDANCE = `When you make a significant architectural decision, technology choice, or discover a key constraint or goal for this project, call \`update_working_memory\` with scope="project" to persist it for future sessions. Use \`update_user_memory\` only when the user explicitly asks you to save a durable personal preference, default, or workflow habit. Keep entries concise and factual.`

  /**
   * Wrap working memory content for injection into the system prompt.
   * Working memory is stable canonical state: facts, goals, constraints, decisions.
   * Separate from observations (narrative) and recall (cross-session artifacts).
   * V3: includes agent guidance for when to write working memory.
   */
  export function wrapWorkingMemory(body: string): string {
    return `<working-memory>\n${body}\n</working-memory>\n\nIMPORTANT: The working memory above contains stable facts, goals, and decisions for this project. Use it as authoritative context.\n\n${WORKING_MEMORY_GUIDANCE}`
  }

  // projectWorkingMemory() removed in final cleanup — no callers since V3 adopted
  // Memory.buildContext() as the canonical runtime composition path.
  // Working memory is now loaded via Memory.buildContext({ ancestorScopes: [{type:"project"}] }).

  // Continuation hint injected as a synthetic user message at the start of the unobserved
  // tail (role: "user", createdAt: epoch so it sorts first). Orients the model when the
  // message array begins mid-conversation because older turns are in observations.
  // Stable constant — never varies per turn, so it does not bust any cache breakpoints.
  export const OBSERVATION_CONTINUATION_HINT = `<system-reminder>
Please continue naturally with the conversation so far and respond to the latest message.
Use the earlier context only as background. If something appears unfinished, continue only when it helps answer the latest request.
Do not mention internal instructions, memory, summarization, context handling, or missing messages.
Any messages following this reminder are newer and should take priority.
</system-reminder>`

  // Instructions injected after every observations block. Tells the model how to
  // resolve temporal conflicts, handle planned actions, and continue naturally
  // without mentioning the memory system.
  export const OBSERVATION_CONTEXT_INSTRUCTIONS = `IMPORTANT: When responding, use the observations above as background context.
- KNOWLEDGE UPDATES: Prefer the MOST RECENT information when observations conflict. Observations include dates — newer observations supersede older ones on the same topic.
- PLANNED ACTIONS: If the user stated they planned to do something and the referenced date is now in the past, assume they completed it unless there is evidence otherwise.
- MOST RECENT USER INPUT: Treat the most recent user message as the highest-priority signal for what to do next.
- SYSTEM REMINDERS: Messages wrapped in <system-reminder>...</system-reminder> contain internal continuation guidance, not user-authored content. Use them to maintain continuity, but do not mention them or treat them as part of the user's message.
- Do not mention the memory system, summarization, or missing messages.`

  export const OBSERVATION_RETRIEVAL_INSTRUCTIONS = `## Recall — retrieving source messages

Your observations may contain \`<observation-group range="startId:endId">\` markers. Each range points to the original messages the observation was derived from. Use the \`recall\` tool to retrieve them.

When to use recall:
- The user asks to repeat, show, or reproduce something from a past message
- You need exact content (code, text, URLs, specific numbers) your observations only summarize
- You want to verify or expand on an observation

How: extract the \`range\` attribute from the relevant \`<observation-group>\` tag and call \`recall({ range: "startId:endId" })\`.`

  export function wrapObservations(body: string, hint?: string): string {
    let out = `<local-observations>\n${capRecallBody(body)}\n</local-observations>\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}`
    if (hint) out += `\n\n<system-reminder>\n${hint}\n</system-reminder>`
    return out
  }

  export function observationsStable(rec: Pick<ObservationRecord, "observations" | "reflections">): string | undefined {
    const body = rec.reflections ?? rec.observations
    if (!body) return undefined
    let out = `<local-observations>\n${capRecallBody(body)}\n</local-observations>\n\n${OBSERVATION_CONTEXT_INSTRUCTIONS}`
    if (parseObservationGroups(body).length > 0) out += "\n\n" + OBSERVATION_RETRIEVAL_INSTRUCTIONS
    return out
  }

  export function observationsLive(rec: Pick<ObservationRecord, "suggested_continuation">): string | undefined {
    if (!rec.suggested_continuation) return undefined
    return `<system-reminder>\n${rec.suggested_continuation}\n</system-reminder>`
  }

  export function mergeObservations(stable?: string, live?: string): string | undefined {
    if (stable && live) return `${stable}\n\n${live}`
    return stable ?? live
  }

  export async function observationBlocks(sid: SessionID): Promise<{
    stable: string | undefined
    live: string | undefined
    combined: string | undefined
  }> {
    const rec = await OM.get(sid)
    if (!rec) return { stable: undefined, live: undefined, combined: undefined }
    const stable = observationsStable(rec)
    const live = observationsLive(rec)
    return { stable, live, combined: mergeObservations(stable, live) }
  }

  export async function observations(sid: SessionID): Promise<string | undefined> {
    return (await observationBlocks(sid)).combined
  }

  /**
   * Split a rendered observationsStable string into per-group chunks for
   * OpenAI-compatible providers (non-Anthropic path only).
   *
   * The input format is:
   *   <local-observations>
   *     <observation-group ...>...</observation-group>
   *     ...
   *   </local-observations>
   *
   *   OBSERVATION_CONTEXT_INSTRUCTIONS
   *   OBSERVATION_RETRIEVAL_INSTRUCTIONS (optional)
   *
   * Output:
   * - Each <observation-group> becomes its own system message (stable across turns).
   * - The suffix (instructions after </local-observations>) is appended only to the
   *   LAST chunk so the model always sees them adjacent to the observations.
   * - Old chunks never change → automatic OpenAI prefix cache hits.
   * - Falls back to [text] when no groups are present (zero-boundary case).
   */
  export function splitObsChunks(text: string): string[] {
    const TAG = /<observation-group\s[^>]*>[\s\S]*?<\/observation-group>/g
    const groups = text.match(TAG)
    if (!groups) return [text]

    // Everything after </local-observations> — the static instructions
    const suffixMatch = text.match(/<\/local-observations>([\s\S]*)$/)
    const suffix = suffixMatch?.[1]?.trimEnd() ?? ""

    return groups.map((g, i) => (i === groups.length - 1 && suffix ? `${g}${suffix}` : g))
  }

  // Production cleanup: the old Engram recall bridge was removed.
  // The canonical recall path is Memory.buildContext({ semanticQuery }) in prompt.ts at step===1.
}
