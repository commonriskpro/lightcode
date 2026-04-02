import { Log } from "../util/log"
import { emitRouterEmbedStatus } from "./router-embed-status"

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
          const pipe = await pipeline("feature-extraction", k)
          emitRouterEmbedStatus({ phase: "ready", model: k })
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
    ],
  },
  {
    label: "web/research",
    add: ["webfetch", "websearch", "read"],
    phrases: [
      "search the web for documentation",
      "investigar en internet sobre la herramienta",
      "look up third party api online",
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
      "necesito que elijas una opción",
    ],
  },
  {
    label: "codesearch",
    add: ["codesearch", "read"],
    phrases: [
      "semantic code search across codebase",
      "búsqueda semántica en el repositorio",
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
  const trimmed = input.userText.trim()
  if (trimmed.length < 2) return undefined
  const pipe = await getPipe(input.model)
  const userVec = await embed(pipe, trimmed)
  let best: { label: string; score: number; add: string[] } | undefined
  for (const p of input.prototypes) {
    let maxPhrase = -1
    for (const phrase of p.phrases) {
      const v = await vecForPhrase(pipe, input.model, p.label, phrase)
      const s = dot(userVec, v)
      if (s > maxPhrase) maxPhrase = s
    }
    if (maxPhrase < 0) continue
    if (!best || maxPhrase > best.score) best = { label: p.label, score: maxPhrase, add: p.add }
  }
  if (!best || best.score < input.minScore) {
    log.info("router_intent_embed", { hit: false, top: best?.score })
    return undefined
  }
  log.info("router_intent_embed", { hit: true, label: best.label, score: best.score.toFixed(3) })
  return { label: best.label, score: best.score, added: best.add }
}

export async function augmentMatchedEmbed(input: {
  userText: string
  matched: Set<string>
  allowedBuiltin: Set<string>
  model: string
  topK: number
  minScore: number
  auto?: {
    enabled: boolean
    ratio: number
    tokenBudget: number
    maxCap: number
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
  const picked = pickTools(scored, input)
  if (picked.length === 0) {
    log.info("router_embed", { added: [], top: scored.slice(0, 3) })
    return undefined
  }
  const note = picked.map((id) => {
    const s = scored.find((x) => x.id === id)?.score ?? 0
    return `${id}:${s.toFixed(2)}`
  })
  log.info("router_embed", { added: picked, top: scored.slice(0, 5) })
  return { added: picked, note: note.join(",") }
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
  },
) {
  const kept = scored.filter((x) => x.score >= input.minScore)
  if (!input.auto?.enabled) return kept.slice(0, input.topK).map((x) => x.id)
  if (kept.length === 0) return []
  const best = kept[0]?.score ?? 0
  const cutoff = Math.max(input.minScore, best * input.auto.ratio)
  const ratioKept = kept.filter((x) => x.score >= cutoff)
  const pool = ratioKept.length ? ratioKept : kept.slice(0, 1)
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
  return out
}
