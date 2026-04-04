import { Log } from "../util/log"
import { emitRouterEmbedStatus } from "./router-embed-status"
import type { ExactMatchFlags } from "./router-exact-match"
import {
  applyCalibration,
  applyIntentGating,
  applyPerToolMin,
  dedupeWebPair,
  effectiveAutoRatio,
  twoPassConsistency,
} from "./router-exact-match"

const log = Log.create({ service: "router-embed" })

const pipelines = new Map<string, Promise<unknown>>()
const toolVec = new Map<string, Float32Array>()

export const DEFAULT_LOCAL_EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"

function vecFromTensor(raw: unknown): Float32Array {
  const t = raw as { data?: Float32Array; dims?: number[] }
  if (t?.data instanceof Float32Array) return t.data
  throw new Error("router_embed: unexpected tensor output")
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

async function getPipe(model: string) {
  const k = model
  if (!pipelines.has(k)) {
    pipelines.set(
      k,
      (async () => {
        emitRouterEmbedStatus({ phase: "loading", model: k })
        try {
          const { pipeline, env } = await import("@huggingface/transformers")
          const cache = process.env.OPENCODE_TRANSFORMERS_CACHE?.trim()
          if (cache) env.cacheDir = cache
          log.info("router_embed_model_loading", { model: k, cacheDir: cache || "(default)" })
          const dev = process.env.OPENCODE_TOOL_ROUTER_EMBED_DEVICE?.trim()
          const cfg = dev
            ? { device: dev as "auto" | "cpu" | "cuda" | "dml" | "gpu" | "wasm" | "webgpu" | "webnn" }
            : undefined
          const pipe = await pipeline("feature-extraction", k, cfg)
          emitRouterEmbedStatus({ phase: "ready", model: k })
          log.info("router_embed_model_ready", { model: k, device: dev || "default" })
          return pipe
        } catch (e) {
          emitRouterEmbedStatus({ phase: "error", model: k, message: String(e) })
          throw e
        }
      })(),
    )
  }
  return pipelines.get(k)! as Promise<(t: string, o?: Record<string, unknown>) => Promise<unknown>>
}

async function embed(pipe: (t: string, o?: Record<string, unknown>) => Promise<unknown>, text: string) {
  const trimmed = text.trim().slice(0, 2000)
  const out = await pipe(trimmed, { pooling: "mean", normalize: true })
  return vecFromTensor(out)
}

async function toolVector(
  pipe: (t: string, o?: Record<string, unknown>) => Promise<unknown>,
  model: string,
  id: string,
  phrase: string,
) {
  const key = `${model}|${id}|${phrase}`
  const hit = toolVec.get(key)
  if (hit) return hit
  const v = await embed(pipe, phrase)
  toolVec.set(key, v)
  return v
}

/** Prototype phrases per intent; tool ids align with offline keyword rules in `tool-router.ts`. */
export type IntentPrototype = {
  label: string
  add: string[]
  phrases: string[]
}

/**
 * Built-in multilingual prototypes (EN/ES) for embedding-based intent. Tuned for paraphrase-multilingual-MiniLM.
 * When `experimental.tool_router.local_intent_embed` is true, the best-matching intent seeds the router before regex rules.
 */
export const BUILTIN_INTENT_PROTOTYPES: IntentPrototype[] = [
  {
    label: "edit/refactor",
    add: ["edit", "write", "grep", "read"],
    phrases: [
      "refactor and edit the source code",
      "change this function implementation",
      "modificar y editar el código",
      "reescribir el archivo",
      "patch src/main.ts export default",
      "rename variable across the file",
      "corrige el off-by-one en utils",
      "arreglalo en el modulo de auth",
      "Refactor handleError to use early returns",
    ],
  },
  {
    label: "create/implement",
    add: ["write", "edit", "grep", "read"],
    phrases: [
      "create a new file and implement",
      "add a feature from scratch",
      "crear e implementar un componente nuevo",
      "añadir funcionalidad al proyecto",
      "Add JSDoc to parseRouterEvalLine without renaming",
      "Create CONTRIBUTING.md from scratch with setup steps",
      "nuevo archivo docs/tips.md con bullet points",
      "documenta la métrica en docs router-eval markdown",
      "add a unit test file beside router policy tests",
      "then add a unit test file beside router policy tests",
    ],
  },
  {
    label: "delete/remove",
    add: ["bash", "edit", "write", "read", "glob"],
    phrases: [
      "delete this file permanently",
      "remove unused code",
      "borrar el archivo o carpeta",
      "eliminar referencias obsoletas",
    ],
  },
  {
    label: "move/rename",
    add: ["bash", "read", "glob"],
    phrases: [
      "rename file or move directory",
      "mover o renombrar archivos",
      "relocate module to another folder",
    ],
  },
  {
    label: "fix/debug",
    add: ["edit", "grep", "read", "bash"],
    phrases: [
      "fix this bug and debug the error",
      "arreglar el fallo y depurar",
      "something is broken in production",
      "HELP tests failing urgent",
    ],
  },
  {
    label: "test",
    add: ["bash", "read"],
    phrases: [
      "run unit tests and verify CI",
      "ejecutar tests automatizados",
      "npm test failing",
    ],
  },
  {
    label: "shell/run",
    add: ["bash", "read"],
    phrases: [
      "run this shell command",
      "execute script in terminal",
      "correr comando en la terminal",
      "Build the project with pnpm run build",
      "Ejecuta git status y muestra cambios",
      "Ejecuta cargo test en el workspace rust",
    ],
  },
  {
    label: "find/search",
    add: ["glob", "grep", "read"],
    phrases: [
      "find files matching pattern",
      "search the repo for references",
      "buscar en el código dónde se usa",
      "list files in directory",
      "compare auth flow to OAuth2 without opening URLs",
    ],
  },
  {
    label: "explore/es",
    add: ["glob", "grep", "read", "task"],
    phrases: [
      "explain how this project works",
      "analizar la arquitectura del código",
      "qué hace este módulo",
      "revisar el flujo completo",
    ],
  },
  {
    label: "explore/en",
    add: ["glob", "grep", "read", "task"],
    phrases: [
      "verify build compiles",
      "inspect dependencies",
      "how does installation work",
    ],
  },
  {
    label: "web/url",
    add: ["webfetch", "websearch", "read"],
    phrases: [
      "open this http link",
      "fetch content from website",
      "descargar desde la url",
      "Descarga https://nodejs.org/api/fs.html y resume el contenido",
      "busca en instagram el perfil",
      "abrir la url y resumir",
      "acceder a la pagina web",
    ],
  },
  {
    label: "web/research",
    add: ["webfetch", "websearch", "read"],
    phrases: [
      "search the web for documentation",
      "search the web for the latest Drizzle ORM migration guide",
      "look up online how Vercel Fluid Compute pricing works",
      "investigar en internet sobre la herramienta",
      "busca en internet documentacion oficial de Postgres",
      "look up third party api online",
      "buscar en instagram a un usuario",
      "informacion en la web sobre",
    ],
  },
  {
    label: "todo",
    add: ["todowrite", "read"],
    phrases: [
      "update my todo list",
      "lista de tareas pendientes",
    ],
  },
  {
    label: "delegate/sdd",
    add: ["task", "read"],
    phrases: [
      "delegate to subagent",
      "orchestrate sdd workflow",
      "usar otro agente para la tarea",
    ],
  },
  {
    label: "question",
    add: ["question"],
    phrases: [
      "ask me which option to choose",
      "ask me whether to use pnpm or npm for this migration",
      "necesito que elijas una opción",
    ],
  },
  {
    label: "codesearch",
    add: ["codesearch", "read"],
    phrases: [
      "semantic code search across codebase",
      "find by meaning where we handle tool router configuration",
      "búsqueda semántica en el repositorio",
      "busqueda semantica donde se define el offline tool router",
      "por significado donde está el offline router",
      "Explica el flujo OAuth solo con archivos del repo",
    ],
  },
  {
    label: "skill",
    add: ["skill", "read"],
    phrases: [
      "load a skill by name",
      "cargar una skill específica",
    ],
  },
]

/** Label returned by classifyIntentEmbed when chit-chat wins over work intents. */
export const CONVERSATION_INTENT_LABEL = "conversation"

/**
 * Chit-chat / small talk — competes with work intents via same embedding pass.
 * The Xenova model’s tokenizer vocabulary is fixed; **adding more `phrases` here** is how we widen
 * coverage for paraphrases (ES/EN colloquial, typos, regional variants) without changing the model.
 */
export const CONVERSATION_INTENT_PROTOTYPE: IntentPrototype = {
  label: CONVERSATION_INTENT_LABEL,
  add: [],
  phrases: [
    // Short anchors — paraphrase-MiniLM aligns single-token greetings poorly with long multi-word prototypes
    "hola",
    "hi",
    "hey",
    "hello",
    "buenas",
    "gracias",
    "thanks",
    "bye",
    "chau",
    "qué tal",
    "cómo estás",
    "cómo te sientes",
    "como te sientes",
    "how are you",
    "how do you feel",
    "hello hi how are you thanks",
    "good morning afternoon evening just chatting",
    "hola qué tal cómo estás buenas",
    "gracias de nada genial perfecto",
    "small talk casual conversation no code",
    "saludos nos vemos chau bye",
    "thanks appreciate it cheers",
    "thanks that solved it appreciate the help",
    "im frustrated nothing compiles need a break",
    "buen día buenas tardes solo saludar",
    // ES coloquial — sin tarea de código (evita pagar tools + AGENTS cuando solo es charla / desahogo)
    "ya no aguanto más",
    "no aguanto más",
    "no puedo más",
    "estoy hecho polvo",
    "estoy re cansado",
    "quiero dormir",
    "solo charlar nada de código",
    "solo conversación sin proyecto",
    "necesito descansar",
    "qué pesado todo",
    // EN same vibe
    "i cant take it anymore",
    "so tired need sleep",
    "just venting not coding",
    // ES — más coloquial / regional (sin pedir cambios en el repo)
    "solo hablar un rato",
    "solo desahogo",
    "charla sin código",
    "sin tarea técnica hoy",
    "ni me hables de código",
    "estoy reventado",
    "estoy re muerto",
    "qué sueño tengo",
    "me quiero ir a dormir",
    "solo compañía no proyecto",
    "necesito descansar la cabeza",
    "hablemos de otra cosa",
    "no es sobre el código",
    "ya no aguanto mas",
    "no aguanto mas",
    "no doy más",
    "estoy al límite",
    // LATAM / informal
    "qué estrés con todo",
    "qué paja todo",
    "solo charlar nada de laburo",
    // EN casual
    "brain fried no code today",
    "just need to talk not debug",
    "talk about something else not the repo",
    // Jokes / light Q&A without repo work (reviewed syn-conversation rows)
    "tell me a joke",
    "cuéntame un chiste",
    "chiste sobre typescript",
    // Team / context only (ES reviewed)
    "solo contexto del equipo sin código",
    "no necesito código solo contexto",
  ],
}

/** All intents including conversation (local intent embed picks one tier: conversation vs work). */
export const ROUTER_INTENT_PROTOTYPES: IntentPrototype[] = [CONVERSATION_INTENT_PROTOTYPE, ...BUILTIN_INTENT_PROTOTYPES]

const intentPhraseVec = new Map<string, Float32Array>()

async function vecForPhrase(
  pipe: (t: string, o?: Record<string, unknown>) => Promise<unknown>,
  model: string,
  label: string,
  phrase: string,
) {
  const key = `${model}|intent|${label}|${phrase}`
  const hit = intentPhraseVec.get(key)
  if (hit) return hit
  const v = await embed(pipe, phrase)
  intentPhraseVec.set(key, v)
  return v
}

type IntentRow = { label: string; score: number; add: string[] }

async function intentRows(input: {
  userText: string
  model: string
  prototypes: IntentPrototype[]
}): Promise<IntentRow[] | undefined> {
  const trimmed = input.userText.trim()
  if (trimmed.length < 2) return undefined
  const pipe = await getPipe(input.model)
  const userVec = await embed(pipe, trimmed)
  const rows: IntentRow[] = []
  for (const p of input.prototypes) {
    let maxPhrase = -1
    for (const phrase of p.phrases) {
      const v = await vecForPhrase(pipe, input.model, p.label, phrase)
      const s = dot(userVec, v)
      if (s > maxPhrase) maxPhrase = s
    }
    if (maxPhrase < 0) continue
    rows.push({ label: p.label, score: maxPhrase, add: p.add })
  }
  rows.sort((a, b) => b.score - a.score)
  return rows.length ? rows : undefined
}

/**
 * Pick the intent whose prototype phrases are most similar to the user message (max over phrases, then argmax over intents).
 * Returns allowed tool ids from that intent's `add` list (caller filters by permission).
 */
export async function classifyIntentEmbed(input: {
  userText: string
  model: string
  minScore: number
  prototypes: IntentPrototype[]
}): Promise<{ label: string; score: number; added: string[] } | undefined> {
  const rows = await intentRows(input)
  const best = rows?.[0]
  if (!best || best.score < input.minScore) {
    log.info("router_intent_embed", { hit: false, top: best?.score })
    return undefined
  }
  log.info("router_intent_embed", { hit: true, label: best.label, score: best.score.toFixed(3) })
  return { label: best.label, score: best.score, added: best.add }
}

/**
 * Multi-intent merge: top-N work intents within `margin` of the best score; conservative conversation path.
 */
export async function classifyIntentEmbedMerged(input: {
  userText: string
  model: string
  minScore: number
  prototypes: IntentPrototype[]
  margin?: number
  maxIntents?: number
  conversationGap?: number
}): Promise<{
  primary: string
  score: number
  merged: string[]
  labels: string[]
  conversationExclusive: boolean
} | undefined> {
  const rows = await intentRows(input)
  const best = rows?.[0]
  if (!best || best.score < input.minScore) {
    log.info("router_intent_embed_merged", { hit: false, top: best?.score })
    return undefined
  }
  const margin = input.margin ?? 0.04
  const maxN = input.maxIntents ?? 3
  const gap = input.conversationGap ?? 0.05

  if (best.label === CONVERSATION_INTENT_LABEL) {
    const second = rows[1]
    const exclusive = !second || best.score - second.score >= gap
    if (exclusive) {
      log.info("router_intent_embed_merged", {
        hit: true,
        primary: best.label,
        score: best.score.toFixed(3),
        conversationExclusive: true,
      })
      return {
        primary: best.label,
        score: best.score,
        merged: [],
        labels: [best.label],
        conversationExclusive: true,
      }
    }
    if (second && second.score >= input.minScore - 0.02 && second.label !== CONVERSATION_INTENT_LABEL) {
      log.info("router_intent_embed_merged", {
        hit: true,
        primary: best.label,
        merged: second.label,
        conversationExclusive: false,
      })
      return {
        primary: best.label,
        score: best.score,
        merged: [...second.add],
        labels: [best.label, second.label],
        conversationExclusive: false,
      }
    }
    log.info("router_intent_embed_merged", {
      hit: true,
      primary: best.label,
      conversationExclusive: true,
    })
    return {
      primary: best.label,
      score: best.score,
      merged: [],
      labels: [best.label],
      conversationExclusive: true,
    }
  }

  const thresh = Math.max(input.minScore, best.score - margin)
  const merged = new Set<string>()
  const labels: string[] = []
  for (const row of rows) {
    if (row.label === CONVERSATION_INTENT_LABEL) continue
    if (row.score < thresh) break
    if (labels.length >= maxN) break
    labels.push(row.label)
    for (const id of row.add) merged.add(id)
  }
  log.info("router_intent_embed_merged", {
    hit: true,
    primary: best.label,
    score: best.score.toFixed(3),
    labels: labels.join(","),
  })
  return {
    primary: best.label,
    score: best.score,
    merged: [...merged],
    labels: labels.length ? labels : [best.label],
    conversationExclusive: false,
  }
}

export async function augmentMatchedEmbed(input: {
  userText: string
  matched: Set<string>
  allowedBuiltin: Set<string>
  model: string
  topK: number
  minScore: number
  intentLabel?: string
  exactMatch?: ExactMatchFlags
  auto?: {
    enabled: boolean
    ratio: number
    tokenBudget: number
    maxCap: number
  }
  rerank?: {
    enabled: boolean
    candidates: number
    semanticWeight: number
    lexicalWeight: number
  }
  phraseFor: (id: string) => string
}): Promise<{ added: string[]; note?: string } | undefined> {
  const candidates = [...input.allowedBuiltin].filter((id) => !input.matched.has(id))
  if (candidates.length === 0) {
    log.info("router_embed_skip", { reason: "no_candidates" })
    return undefined
  }

  const pipe = await getPipe(input.model)
  const userVec = await embed(pipe, input.userText)
  const scored: { id: string; score: number }[] = []
  for (const id of candidates) {
    const phrase = input.phraseFor(id)
    const tvec = await toolVector(pipe, input.model, id, phrase)
    const score = dot(userVec, tvec)
    scored.push({ id, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const ranked = rerank(scored, input)
  const picked = pickTools(ranked, {
    ...input,
    userText: input.userText,
    intentLabel: input.intentLabel,
    exactMatch: input.exactMatch,
  })
  if (picked.length === 0) {
    log.info("router_embed", { added: [], top: ranked.slice(0, 3) })
    return undefined
  }
  const note = picked.map((id) => {
    const s = ranked.find((x) => x.id === id)?.score ?? 0
    return `${id}:${s.toFixed(2)}`
  })
  log.info("router_embed", { added: picked, top: ranked.slice(0, 5) })
  return { added: picked, note: note.join(",") }
}

function norm(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function toks(text: string) {
  return norm(text)
    .split(/[^a-z0-9]+/g)
    .filter((x) => x.length >= 2)
}

function lexical(a: string, b: string) {
  const sa = new Set(toks(a))
  const sb = new Set(toks(b))
  if (sa.size === 0 || sb.size === 0) return 0
  let hit = 0
  for (const x of sa) {
    if (sb.has(x)) hit++
  }
  return hit / Math.sqrt(sa.size * sb.size)
}

function rerank(
  scored: { id: string; score: number }[],
  input: {
    userText: string
    phraseFor: (id: string) => string
    rerank?: {
      enabled: boolean
      candidates: number
      semanticWeight: number
      lexicalWeight: number
    }
  },
) {
  if (!input.rerank?.enabled) return scored
  const n = Math.max(1, input.rerank.candidates)
  const a = input.rerank.semanticWeight
  const b = input.rerank.lexicalWeight
  const base = scored.slice(0, n)
  const rest = scored.slice(n)
  const top = base[0]?.score ?? 0
  const merged = base.map((row) => {
    const sem = top > 0 ? row.score / top : row.score
    const lex = lexical(input.userText, input.phraseFor(row.id))
    return { id: row.id, score: a * sem + b * lex }
  })
  merged.sort((x, y) => y.score - x.score)
  return [...merged, ...rest]
}

function tok(text: string) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function pickTools(
  scored: { id: string; score: number }[],
  input: {
    minScore: number
    topK: number
    auto?: { enabled: boolean; ratio: number; tokenBudget: number; maxCap: number }
    phraseFor: (id: string) => string
    userText?: string
    intentLabel?: string
    exactMatch?: ExactMatchFlags
  },
) {
  let s = scored.map((x) => ({ ...x }))
  const u = input.userText ?? ""
  if (input.exactMatch?.intent_gating) s = applyIntentGating(s, input.intentLabel, u)
  if (input.exactMatch?.calibration) s = applyCalibration(s)
  const kept = input.exactMatch?.per_tool_min
    ? applyPerToolMin(s, input.minScore)
    : s.filter((x) => x.score >= input.minScore)
  if (!input.auto?.enabled) return kept.slice(0, input.topK).map((x) => x.id)
  if (kept.length === 0) return []
  const best = kept[0]?.score ?? 0
  const baseR = input.auto.ratio
  const r = effectiveAutoRatio(baseR, u, input.intentLabel, input.exactMatch)
  const cutoff = Math.max(input.minScore, best * r)
  const ratioKept = kept.filter((x) => x.score >= cutoff)
  const pool = ratioKept.length ? ratioKept : kept.slice(0, 1)
  const scoreMap = new Map(kept.map((x) => [x.id, x.score]))
  const out: string[] = []
  let used = 0
  for (const row of pool) {
    if (out.length >= input.auto.maxCap) break
    const next = tok(input.phraseFor(row.id)) + 6
    if (out.length > 0 && used + next > input.auto.tokenBudget) break
    out.push(row.id)
    used += next
  }
  if (out.length === 0 && pool[0]) out.push(pool[0].id)
  let fin = out
  if (input.exactMatch?.redundancy) fin = dedupeWebPair(fin, scoreMap, u)
  if (input.exactMatch?.two_pass) fin = twoPassConsistency(fin, u)
  return fin
}
