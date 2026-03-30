import { mkdir, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const skip = (seg: string) =>
  seg.startsWith("sdd-") || seg === "_shared" || seg === "skill-registry"

const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"])

async function walkSkillMd(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue
      if (skip(e.name)) continue
      await walkSkillMd(p, out)
    } else if (e.name === "SKILL.md") {
      const parts = p.split(path.sep)
      if (parts.some((s) => skip(s))) continue
      out.push(p)
    }
  }
}

async function collectFromRoot(root: string): Promise<string[]> {
  const out: string[] = []
  const s = await stat(root).catch(() => null)
  if (!s?.isDirectory()) return out
  await walkSkillMd(root, out)
  return out
}

function parseFrontmatter(text: string): { name: string; trigger: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!m) return { name: "", trigger: "" }
  const fm = m[1]
  const name =
    /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
  let desc = ""
  const block = /^description:\s*>\s*\n([\s\S]*?)(?=\n[a-z_]+:)/m.exec(fm)?.[1]
  if (block) {
    desc = block.replace(/\n\s+/g, " ").trim()
  } else {
    const one = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? ""
    desc = one.replace(/^["']|["']$/g, "")
  }
  const trigger = /Trigger:\s*(.+?)(?:\.|$)/i.exec(desc)?.[1]?.trim() ?? desc.slice(0, 140)
  return { name, trigger }
}

async function readSkillRow(file: string): Promise<{ name: string; trigger: string; path: string } | undefined> {
  const text = await Bun.file(file).text()
  const { name, trigger } = parseFrontmatter(text)
  if (!name) return undefined
  return { name, trigger, path: file }
}

function userRoots(): string[] {
  const h = homedir()
  return [
    path.join(h, ".claude", "skills"),
    path.join(h, ".config", "opencode", "skills"),
    path.join(h, ".gemini", "skills"),
    path.join(h, ".cursor", "skills"),
    path.join(h, ".copilot", "skills"),
  ]
}

function projectRoots(root: string): string[] {
  return [
    path.join(root, ".claude", "skills"),
    path.join(root, ".gemini", "skills"),
    path.join(root, ".agent", "skills"),
    path.join(root, "skills"),
    path.join(root, "gentle-ai", "skills"),
    path.join(root, ".opencode", "skills"),
  ]
}

async function scanSkills(root: string): Promise<Map<string, { trigger: string; path: string }>> {
  const map = new Map<string, { trigger: string; path: string }>()
  for (const d of userRoots()) {
    for (const f of await collectFromRoot(d)) {
      const row = await readSkillRow(f)
      if (!row) continue
      map.set(row.name, { trigger: row.trigger, path: row.path })
    }
  }
  for (const d of projectRoots(root)) {
    for (const f of await collectFromRoot(d)) {
      const row = await readSkillRow(f)
      if (!row) continue
      map.set(row.name, { trigger: row.trigger, path: row.path })
    }
  }
  return map
}

const conventionNames = [
  "agents.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  "GEMINI.md",
  "copilot-instructions.md",
]

function extractRefs(text: string, root: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) {
    const rel = m[1]
    if (!rel.includes("..") && !rel.startsWith("./")) continue
    out.push(path.resolve(root, rel))
  }
  for (const m of text.matchAll(/`([^`]+\.(?:md|mdx|tsx?|jsonc?|yaml|yml))`/g)) {
    const rel = m[1]
    if (rel.startsWith("/") || rel.startsWith("http")) continue
    out.push(path.resolve(root, rel))
  }
  return [...new Set(out)]
}

async function scanConventions(root: string): Promise<{ rows: { file: string; path: string; notes: string }[] }> {
  const rows: { file: string; path: string; notes: string }[] = []
  const seen = new Set<string>()
  for (const n of conventionNames) {
    const p = path.join(root, n)
    const s = await stat(p).catch(() => null)
    if (!s?.isFile()) continue
    const key = path.resolve(p)
    if (seen.has(key)) continue
    seen.add(key)
    const index = n.toLowerCase() === "agents.md"
    if (index) {
      const text = await Bun.file(p).text()
      rows.push({ file: n, path: p, notes: "Index — references paths below" })
      for (const ref of extractRefs(text, root)) {
        const st = await stat(ref).catch(() => null)
        if (!st?.isFile()) continue
        const rk = path.resolve(ref)
        if (seen.has(rk)) continue
        seen.add(rk)
        rows.push({
          file: path.basename(ref),
          path: ref,
          notes: `Referenced by ${n}`,
        })
      }
    } else {
      rows.push({ file: n, path: p, notes: "Standalone" })
    }
  }
  return { rows }
}

export async function buildRegistryMarkdown(root: string): Promise<string> {
  const skills = await scanSkills(root)
  const conv = await scanConventions(root)

  const skillLines = [...skills.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, v]) => `| ${v.trigger.replace(/\|/g, "\\|")} | ${n} | \`${v.path}\` |`)

  const convLines = conv.rows
    .map((r) => `| ${r.file} | \`${r.path}\` | ${r.notes.replace(/\|/g, "\\|")} |`)
    .join("\n")

  return [
    "# Skill Registry",
    "",
    "**Orchestrator use only.** Read this registry once per session to resolve skill paths, then pass pre-resolved paths directly to each sub-agent's launch prompt. Sub-agents receive the path and load the skill directly — they do NOT read this registry.",
    "",
    "## User Skills",
    "",
    "| Trigger | Skill | Path |",
    "|---------|-------|------|",
    skillLines.length ? skillLines.join("\n") : "| — | — | *(none found)* |",
    "",
    "## Project Conventions",
    "",
    "| File | Path | Notes |",
    "|------|------|-------|",
    convLines || "| — | — | *(none found)* |",
    "",
  ].join("\n")
}

export async function writeRegistry(root: string): Promise<string> {
  const dir = path.join(root, ".atl")
  await mkdir(dir, { recursive: true })
  const out = path.join(dir, "skill-registry.md")
  const body = await buildRegistryMarkdown(root)
  await Bun.write(out, body)
  return out
}
