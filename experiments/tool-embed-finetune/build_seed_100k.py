"""
Emit >=100,000 unique (anchor, positive) JSONL lines aligned with tool-router EMBED_PHRASE.

Combinatorial templates (EN/ES) — not LLM. When the raw product is smaller than N, rows are extended with
`ANCHOR_WHEN` phrases (see `fill_semantic`), not numeric (r123) suffixes. Sync positives with:
  packages/opencode/src/session/tool-router.ts  EMBED_PHRASE + embedPhraseFor (`{id}. {phrase}`)

Usage:
  python build_seed_100k.py --out dataset_seed_100k.jsonl --min 100000
"""
from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
from pathlib import Path

# Must match tool-router.ts EMBED_PHRASE; positive line = f"{tid}. {PHRASE[tid]}"
PHRASE: dict[str, str] = {
    "read": "Read-only: open file or directory and view contents. Summarize, extract, explain defaults from file text without modifying. Leer y explicar; revisa contenido y dime; solo lectura.",
    "task": "Delegate a task to a subagent. Spawn agent. Delegar subtarea. Otro agente.",
    "skill": "Load a named skill. Activate skill by name. Cargar skill.",
    "glob": "List file paths by glob mask (*.ts **/test). Find files by name pattern. Not searching text inside files. Archivos por patrón; rutas que coinciden.",
    "grep": "Ripgrep: literal or regex search inside file contents. Find string TODO in sources. Not semantic meaning search. Texto literal en archivos.",
    "bash": "Run a shell command in terminal: npm run, bun, pnpm, git status, cargo test, typecheck. ejecuta comando consola. Not reading a file.",
    "edit": "Change an existing file in place: patch, refactor lines already on disk. Editar archivo existente. Not creating a brand-new file from scratch.",
    "write": "Create new file or overwrite whole file: changelog entry, plan.md, save report. crear archivo nuevo; escribir markdown nuevo; rollout doc file.",
    "webfetch": "Fetch a URL. Download HTTP page. Descargar página web. GET url.",
    "websearch": "Search the web. Look up online. Búsqueda en internet. Documentación online.",
    "todowrite": "Update session todo checklist: mark task done, pending items in the todo list. Not project rollout steps or creating plan.md files.",
    "question": "Ask the user a question. Clarify choice. Preguntar al usuario. Elegir opción.",
    "codesearch": "Semantic codebase search by concept (embeddings). Find implementation by meaning. Not npm run or shell. Not ripgrep literal string.",
    "apply_patch": "Begin/End Patch envelope to add, update, delete, or move files. Structured GPT-style diff; not search_replace or single-hunk edit/write for whole files.",
    "batch": "Execute multiple independent tool calls in parallel (read many files, grep plus bash). Reduce latency; ordering not guaranteed between calls.",
    "lsp": "Language Server: go to definition, find references, hover, workspace symbols. Navigate code; not ripgrep text search or plain read.",
    "plan_exit": "Exit plan agent after the plan file is ready. Ask user to switch to build agent for implementation. Not general edit/write; only when planning phase is complete.",
}


def pos(tid: str) -> str:
    return f"{tid}. {PHRASE[tid]}"


def product_anchors(parts: list[list[str]], cap: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for tup in itertools.product(*parts):
        a = " ".join(x for x in tup if x).strip()
        while "  " in a:
            a = a.replace("  ", " ")
        if not a or a in seen:
            continue
        seen.add(a)
        out.append(a)
        if len(out) >= cap:
            return out
    return out


# Natural context phrases — used when the raw cartesian product is smaller than `need`.
# No numeric (r123) suffixes: only semantic tails.
ANCHOR_WHEN = [
    "before the release train",
    "during code review",
    "for the onboarding doc",
    "while pairing with a lead",
    "after the merge to main",
    "for the security audit",
    "in the incident channel",
    "during the canary phase",
    "for the PM demo",
    "before prod cutover",
    "when CI is red",
    "for local dev only",
    "in the staging stack",
    "for EU tenant parity",
    "for the billing team",
    "after standup",
    "before the handoff",
    "for the client success call",
    "while shadowing deploy",
    "for SOC2 evidence",
    "during freeze week",
    "for the perf regression",
    "after the schema migration",
    "for the mobile release",
    "when debugging flaky tests",
    "for the API contract review",
    "before the feature flag flip",
    "for the embed widget",
    "during on-call",
    "for the data warehouse export",
    "after the rollback drill",
    "for the design partner",
    "when narrowing blast radius",
    "before the chaos test",
    "for the load test report",
    "after the dependency bump",
    "for the migration runbook",
    "when the deploy is stuck",
    "for the retro notes",
    "before the sprint demo",
    "for the branch cut",
]


def fill_semantic(base: list[str], need: int) -> list[str]:
    """Extend with natural phrases; never uses numeric (r123) suffixes."""
    out = list(base)
    seen = set(out)
    if len(out) >= need:
        return out[:need]

    for b in base:
        for w in ANCHOR_WHEN:
            a = f"{b}; {w}"
            if a not in seen:
                seen.add(a)
                out.append(a)
                if len(out) >= need:
                    return out[:need]

    for b in base:
        for w in ANCHOR_WHEN:
            a = f"{b} — {w}"
            if a not in seen:
                seen.add(a)
                out.append(a)
                if len(out) >= need:
                    return out[:need]

    for b in base:
        for w1 in ANCHOR_WHEN:
            for w2 in ANCHOR_WHEN:
                a = f"{b}; {w1}; {w2}"
                if a not in seen:
                    seen.add(a)
                    out.append(a)
                    if len(out) >= need:
                        return out[:need]

    for b in base:
        for w1 in ANCHOR_WHEN:
            for w2 in ANCHOR_WHEN:
                for w3 in ANCHOR_WHEN:
                    a = f"{b}; {w1}; {w2}; {w3}"
                    if a not in seen:
                        seen.add(a)
                        out.append(a)
                        if len(out) >= need:
                            return out[:need]

    return out[:need]


def anchors_for(tid: str, n: int, rng: random.Random) -> list[str]:
    files = [
        "README.md",
        "package.json",
        "tsconfig.json",
        "src/app.ts",
        "docs/architecture.md",
        ".env.example",
        "CHANGELOG.md",
        "Dockerfile",
        "pnpm-lock.yaml",
        "vitest.config.ts",
        "Cargo.toml",
        "go.mod",
        "pyproject.toml",
        "Makefile",
        "LICENSE",
        "SECURITY.md",
        "CONTRIBUTING.md",
        "webpack.config.js",
        "eslint.config.mjs",
        "drizzle/schema.ts",
        "packages/api/src/index.ts",
    ]
    globs = ["**/*.ts", "**/*.tsx", "**/test/*.spec.ts", "src/**/*.rs", "apps/*/package.json", "**/*.md"]
    greps = ["TODO", "FIXME", "CONFIG_", "process.env", "async function", "import React", "deprecated", "OPENAI"]
    shells = ["npm run build", "bun test", "pnpm typecheck", "git status", "cargo check", "pytest -q", "docker compose up"]
    urls = ["https://example.com/docs", "https://developer.mozilla.org/en-US/docs", "https://github.com/org/repo"]
    skills = ["playwright", "testing", "cursor-rules", "vercel-deploy", "postgres"]
    edits = ["change the port in src/app.ts", "fix typo in docs/cli.md", "refactor handleSubmit in Form.tsx"]
    writes = ["docs/plan.md", "notes/today.md", "report.md", "CHANGELOG entry for 2.0"]
    codeq = ["auth middleware", "websocket reconnect", "payment flow", "error boundary", "rate limiter"]
    patches = ["Begin Patch for src/main.ts", "*** Update File: foo.ts", "add new file config/extra.json"]
    lspq = ["go to definition of Session.updatePart", "find references to useRouter", "hover type on line 42"]
    plans = ["plan is in plan.md", "finished planning, ready to implement", "user approved the plan draft"]
    tasks = ["delegate DB migration review", "spawn subagent for security audit", "hand off perf work"]
    todos = ["mark task 2 done", "add 3 pending todos", "cancel obsolete todo items"]
    questions = ["prefer option A or B", "which region for deploy", "npm or pnpm"]
    batchs = ["read A and B in parallel", "grep plus read without waiting", "run bash and glob together"]
    webs = ["bun test timeout", "drizzle relations docs", "onnx runtime wasm"]

    if tid == "read":
        v = [
            "read",
            "open",
            "view",
            "show me",
            "display",
            "summarize",
            "explain",
            "what does",
            "revisa",
            "léeme",
            "muéstrame",
            "sin modificar",
        ]
        t = [
            "without editing",
            "read-only",
            "just the contents",
            "quick summary",
            "solo lectura",
            "sin cambiar el archivo",
        ]
        raw = product_anchors([v, files, t], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "glob":
        v = ["find", "list", "glob", "search files", "archivos", "encuentra rutas", "listar"]
        d = ["repo root", "packages/", "src/", "tests/", "db/migrations", "apps/web"]
        raw = product_anchors([v, globs, d], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "grep":
        v = ["search for", "grep", "find string", "busca texto", "ripgrep"]
        s = ["in src", "across repo", "in tests only", "excluding node_modules", "en todo el monorepo"]
        raw = product_anchors([v, greps, s], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "bash":
        v = ["run", "execute", "ejecuta", "launch", "start"]
        c = shells + [f"{x} --verbose" for x in shells]
        ctx = ["in project root", "with CI env", "en la terminal integrada"]
        raw = product_anchors([v, c, ctx], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "edit":
        raw = product_anchors([["edit", "patch", "refactor", "fix", "corrige", "edita"], edits, ["carefully", "minimal diff", "sin romper tests"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "write":
        raw = product_anchors([["create", "write", "add file", "crea", "escribe"], writes, ["from scratch", "empty template", "con plantilla básica"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "codesearch":
        raw = product_anchors(
            [
                ["semantic search", "codesearch", "find by meaning", "busqueda semantica", "concept search"],
                codeq,
                ["in codebase", "across services", "en el backend"],
            ],
            n * 2,
        )
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "webfetch":
        raw = product_anchors([["fetch", "download", "GET", "descarga", "abre URL"], urls, ["and extract title", "raw markdown", "headers only"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "websearch":
        raw = product_anchors([["search web for", "google", "busca en internet", "look up online"], webs, ["official docs", "2024", "best practices"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "task":
        raw = product_anchors([["delegate", "use subagent", "spawn agent", "delega"], tasks, ["now", "async", "priority high"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "skill":
        raw = product_anchors([["load skill", "activate skill", "carga skill", "enable"], skills, ["for this session", "before tests"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "todowrite":
        raw = product_anchors([["update todo", "my todo list", "session todos", "lista de tareas"], todos, ["please", "now"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "question":
        raw = product_anchors([["ask me", "preguntame", "which do you prefer", "clarify"], questions, ["before continuing", "needed for deploy"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "apply_patch":
        raw = product_anchors([["apply_patch", "unified diff", "Begin Patch", "patch envelope"], patches, ["for multi-file change", "solo este hunk"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "batch":
        raw = product_anchors([["parallel", "batch", "run together", "en paralelo"], batchs, ["to save round trips", "latency"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "lsp":
        raw = product_anchors([["LSP", "go to def", "references", "hover"], lspq, ["in workspace", "solo este archivo"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    if tid == "plan_exit":
        raw = product_anchors([["plan done", "switch to build", "salir del plan", "plan_exit"], plans, ["user confirmed", "listo para codear"]], n * 2)
        rng.shuffle(raw)
        return fill_semantic(raw, n)[:n]

    return fill_semantic([f"{tid} request"], n)[:n]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=Path("dataset_seed_100k.jsonl"))
    p.add_argument("--min", dest="min_lines", type=int, default=100_000)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    tools = list(PHRASE.keys())
    rng = random.Random(args.seed)
    n = args.min_lines
    per = [n // len(tools)] * len(tools)
    for i in range(n % len(tools)):
        per[i] += 1

    seen: set[tuple[str, str]] = set()
    rows: list[tuple[str, str]] = []

    for tid, cnt in zip(tools, per, strict=True):
        pstr = pos(tid)
        for a in anchors_for(tid, cnt, rng):
            key = (a, pstr)
            if key in seen:
                continue
            seen.add(key)
            rows.append((a, pstr))

    # top up if dedupe or shortfall (semantic tails only, no random ids)
    extra = 0
    while len(rows) < n:
        tid = tools[extra % len(tools)]
        pstr = pos(tid)
        w0 = ANCHOR_WHEN[extra % len(ANCHOR_WHEN)]
        w1 = ANCHOR_WHEN[(extra // 40) % len(ANCHOR_WHEN)]
        w2 = ANCHOR_WHEN[(extra // 1600) % len(ANCHOR_WHEN)]
        a = f"{tid} help with a typical step; {w0}; {w1}; {w2}"
        key = (a, pstr)
        if key not in seen:
            seen.add(key)
            rows.append((a, pstr))
        extra += 1
        if extra > n * 40:
            raise SystemExit("failed to reach min unique pairs")

    rng.shuffle(rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for a, pstr in rows[:n]:
            f.write(json.dumps({"anchor": a, "positive": pstr}, ensure_ascii=False) + "\n")

    uniq = len({(a, p) for a, p in rows[:n]})
    print("wrote", n, "lines ->", args.out.resolve(), "unique pairs:", uniq, file=sys.stderr)
    if uniq < n:
        raise SystemExit(f"unique {uniq} < target {n}")


if __name__ == "__main__":
    main()
