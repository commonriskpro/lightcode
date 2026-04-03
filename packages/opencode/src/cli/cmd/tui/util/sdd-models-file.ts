import { parse } from "jsonc-parser"
import type { ParseError } from "jsonc-parser"
import { Filesystem } from "@/util/filesystem"
import { SDD_MODELS_DEFAULT, isSddBuiltinProfile } from "./sdd-models-default"

export type SddModelsData = {
  active: string
  profiles: Record<string, Record<string, string>>
}

export function parseProviderModel(s: string): { providerID: string; modelID: string } | undefined {
  const i = s.indexOf("/")
  if (i <= 0) return
  const a = s.slice(0, i)
  const b = s.slice(i + 1)
  if (!a || !b) return
  return { providerID: a, modelID: b }
}

export async function ensureSddModels(filepath: string): Promise<SddModelsData> {
  if (!(await Filesystem.exists(filepath))) {
    await Filesystem.write(filepath, SDD_MODELS_DEFAULT)
  }
  return readSddModels(filepath)
}

export async function readSddModels(filepath: string): Promise<SddModelsData> {
  const text = await Filesystem.readText(filepath)
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    throw new Error(`Invalid JSON in ${filepath}`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid sdd-models shape in ${filepath}`)
  }
  const o = data as Record<string, unknown>
  const profiles: Record<string, Record<string, string>> = {}
  const raw = o.profiles
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "object" && v && !Array.isArray(v)) {
        const m: Record<string, string> = {}
        for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
          if (typeof av === "string" && av.trim()) m[ak] = av.trim()
        }
        profiles[k] = m
      }
    }
  }
  const active = typeof o.active === "string" && o.active.trim() ? o.active.trim() : "balanced"
  return { active, profiles }
}

async function writeSddModels(filepath: string, d: SddModelsData) {
  await Filesystem.write(filepath, JSON.stringify({ active: d.active, profiles: d.profiles }, null, 2) + "\n")
}

export async function saveSddModelsAgentModel(
  filepath: string,
  active: string,
  agent: string,
  model: string,
) {
  const d = await readSddModels(filepath)
  if (!d.profiles[active]) d.profiles[active] = {}
  d.profiles[active][agent] = model
  await writeSddModels(filepath, d)
}

export async function saveSddModelsActive(filepath: string, active: string) {
  const d = await readSddModels(filepath)
  d.active = active
  await writeSddModels(filepath, d)
}

/** `a-z` `A-Z` `0-9` `_` `.` `-` only; max length 64. */
export function normalizeProfileName(raw: string): string | undefined {
  const t = raw.trim()
  if (!t || t.length > 64) return
  if (!/^[\w.-]+$/.test(t)) return
  return t
}

/** Add `name`, optionally cloning mappings from `copyFrom`. Sets `active` to `name`. */
export async function addSddProfile(filepath: string, name: string, copyFrom: string | undefined) {
  const d = await readSddModels(filepath)
  if (d.profiles[name]) throw new Error(`Profile "${name}" already exists`)
  d.profiles[name] = copyFrom && d.profiles[copyFrom] ? { ...d.profiles[copyFrom] } : {}
  d.active = name
  await writeSddModels(filepath, d)
}

/** New profile with mappings copied from `base`, then `agent` set to `model`. Becomes `active`. */
export async function forkProfileWithAgent(
  filepath: string,
  name: string,
  base: string,
  agent: string,
  model: string,
) {
  const d = await readSddModels(filepath)
  if (d.profiles[name]) throw new Error(`Profile "${name}" already exists`)
  d.profiles[name] = { ...(d.profiles[base] ?? {}) }
  d.profiles[name][agent] = model
  d.active = name
  await writeSddModels(filepath, d)
}

export async function deleteSddProfile(filepath: string, name: string) {
  if (isSddBuiltinProfile(name)) throw new Error(`Built-in profile "${name}" cannot be deleted`)
  const d = await readSddModels(filepath)
  if (!d.profiles[name]) throw new Error(`Profile "${name}" not found`)
  const keys = Object.keys(d.profiles)
  if (keys.length <= 1) throw new Error("Cannot delete the last profile")
  delete d.profiles[name]
  if (d.active === name) {
    const rest = Object.keys(d.profiles).sort()
    d.active = rest[0]!
  }
  await writeSddModels(filepath, d)
}
