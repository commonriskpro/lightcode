"""
Emit 500,000 unique (prompt, anchor, positive) triples for tool-router fine-tune.

  1. **Gold**: every row from the 10.2k curated JSONL (prompt + anchor + positive).
  2. **Fill**: per tool, unique pairs of (prompt from bank) × (anchor from build_seed_100k.anchors_for).
     Prompt bank = seed prompts + combinatorial EN/ES session lines (no LLM, no web).
  3. Dedupe on (prompt, anchor, positive).

Depends on: build_seed_100k.py (PHRASE, pos, anchors_for) — must match tool-router.ts.

Usage:
  python build_high_quality_500k.py --seed ..\\tool_routing_embeddings_10200_10k_unique_anchors_v2.jsonl --out dataset_train_500k_hq.jsonl --rng 42
"""
from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import os
import random
import sys
from pathlib import Path


def load_mod():
    base = Path(__file__).resolve().parent / "build_seed_100k.py"
    spec = importlib.util.spec_from_file_location("build_seed_100k", base)
    if spec is None or spec.loader is None:
        raise SystemExit("cannot load build_seed_100k.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def tool_from_positive(positive: str) -> str:
    if ". " in positive:
        return positive.split(". ", 1)[0].strip()
    return "unknown"


def load_seed_rows(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        pr = o.get("prompt")
        a = o.get("anchor")
        p = o.get("positive")
        if not isinstance(pr, str) or not isinstance(a, str) or not isinstance(p, str):
            raise SystemExit(f"{path}: need prompt, anchor, positive")
        rows.append({"prompt": pr.strip(), "anchor": a.strip(), "positive": p.strip()})
    return rows


def default_seed_path() -> Path:
    d = Path(os.environ.get("USERPROFILE", os.environ.get("HOME", ""))) / "Downloads" / (
        "tool_routing_embeddings_10200_10k_unique_anchors_v2.jsonl"
    )
    if d.is_file():
        return d
    return Path("seed_10k.jsonl")


def build_prompt_bank(seed_prompts: list[str]) -> list[str]:
    bank: list[str] = []
    for x in seed_prompts:
        bank.append(x)

    es_a = [
        "Sesión de agente en",
        "Copiloto técnico en",
        "Modo agente en",
        "Asistente repo-aware en",
    ]
    es_b = [
        "un monorepo",
        "un admin portal",
        "un worker app",
        "una CLI interna",
        "un infra repo",
        "un docs site",
        "un mobile backend",
        "un service repo",
    ]
    es_c = [
        "React",
        "Nuxt",
        "Express",
        "Phoenix",
        "Svelte",
        "Next.js",
        "Vue",
        "Bun",
    ]
    es_tail = [
        "Prioriza el routing correcto de herramientas.",
        "Elige la herramienta que mejor encaje con el usuario.",
        "Mapa cada petición a la tool adecuada.",
        "Hay read, search, edit, shell y web: decide bien.",
    ]
    for a, b, c, t in itertools.product(es_a, es_b, es_c, es_tail):
        bank.append(f"{a} {b} de {c}. {t}")

    en_a = [
        "You are working inside",
        "Repo-aware assistant running against",
        "High-context engineering chat in",
    ]
    en_b = [
        "a monorepo",
        "an admin portal",
        "a worker app",
        "a CLI repo",
        "a service repo",
        "a docs site",
        "a platform app",
    ]
    en_c = [
        "React",
        "Nuxt",
        "Express",
        "Phoenix",
        "Svelte",
    ]
    en_d = ["local", "staging", "preview", "qa", "eu-west"]
    en_tail = [
        "Choose the tool that matches the user's intent.",
        "Tool choice matters more than verbosity.",
        "Map each ask to the right tool.",
    ]
    for a, b, c, d, t in itertools.product(en_a, en_b, en_c, en_d, en_tail):
        bank.append(f"{a} {b} built with {c} in {d}. {t}")

    biling = [
        "Modo bilingüe en un monorepo. Route carefully because there are read, search, edit, shell, and web tools.",
        "Bilingual session: Spanish and English user text. Pick the correct tool id.",
        "Usuario mezcla ES/EN: enruta a la herramienta correcta sin inventar APIs.",
    ]
    for b in biling:
        bank.append(b)

    out: list[str] = []
    seen: set[str] = set()
    for x in bank:
        x = x.strip()
        if not x or x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seed", type=Path, default=None, help="10.2k JSONL; default: Downloads seed or ./seed_10k.jsonl")
    p.add_argument("--out", type=Path, default=Path("dataset_train_500k_hq.jsonl"))
    p.add_argument("--n", type=int, default=500_000)
    p.add_argument("--rng", type=int, default=42)
    args = p.parse_args()

    seed_path = args.seed if args.seed is not None else default_seed_path()
    if not seed_path.is_file():
        raise SystemExit(f"--seed not found: {seed_path.resolve()}")

    mod = load_mod()
    PHRASE = mod.PHRASE
    pos = mod.pos
    anchors_for = mod.anchors_for

    tools = list(PHRASE.keys())
    n_total = max(1, args.n)
    rng = random.Random(args.rng)

    gold = load_seed_rows(seed_path)
    per_tool_target: dict[str, int] = {}
    base = n_total // len(tools)
    rem = n_total % len(tools)
    for i, tid in enumerate(tools):
        per_tool_target[tid] = base + (1 if i < rem else 0)

    count_seed: dict[str, int] = {t: 0 for t in tools}
    for r in gold:
        count_seed[tool_from_positive(r["positive"])] += 1

    seen: set[tuple[str, str, str]] = set()
    out: list[dict[str, str]] = []

    for r in gold:
        k = (r["prompt"], r["anchor"], r["positive"])
        if k in seen:
            continue
        seen.add(k)
        out.append(dict(r))

    seed_prompts = list(dict.fromkeys(r["prompt"] for r in gold))
    prompt_bank = build_prompt_bank(seed_prompts)
    rng.shuffle(prompt_bank)

    for tid in tools:
        need = per_tool_target[tid] - count_seed.get(tid, 0)
        if need <= 0:
            continue
        pstr = pos(tid)
        pool = anchors_for(tid, max(need + 2_000, 35_000), rng)
        rng.shuffle(pool)
        for anchor in pool:
            if need <= 0:
                break
            for prompt in prompt_bank:
                if need <= 0:
                    break
                k = (prompt, anchor, pstr)
                if k in seen:
                    continue
                seen.add(k)
                out.append({"prompt": prompt, "anchor": anchor, "positive": pstr})
                need -= 1
        if need > 0:
            pool = anchors_for(tid, max(need + 5_000, 50_000), rng)
            rng.shuffle(pool)
            for anchor in pool:
                if need <= 0:
                    break
                for prompt in prompt_bank:
                    if need <= 0:
                        break
                    k = (prompt, anchor, pstr)
                    if k in seen:
                        continue
                    seen.add(k)
                    out.append({"prompt": prompt, "anchor": anchor, "positive": pstr})
                    need -= 1
        if need > 0:
            raise SystemExit(f"could not fill tool {tid}: short by {need}; expand prompt_bank or anchors_for")

    if len(out) < n_total:
        raise SystemExit(f"short rows {len(out)} < {n_total}")

    rng.shuffle(out)
    out = out[:n_total]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    uniq = len({(x["prompt"], x["anchor"], x["positive"]) for x in out})
    print(
        json.dumps(
            {"wrote": str(args.out.resolve()), "lines": len(out), "unique_triples": uniq, "seed_gold": len(gold)},
            indent=2,
        ),
        file=sys.stderr,
    )
    if uniq != len(out):
        raise SystemExit(f"duplicate triples: {uniq} != {len(out)}")


if __name__ == "__main__":
    main()
