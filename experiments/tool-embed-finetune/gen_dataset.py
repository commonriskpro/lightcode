"""
Build a large JSONL of (anchor, positive) pairs for tool-router embedding fine-tune.

Wrong approach (old script): emit N lines by modulo over a tiny seed — almost all rows are
exact duplicates or a useless \"[v123]\" suffix. MultipleNegativesRankingLoss needs *diverse*
anchors that still match the same positive phrase.

Right approach:
  1. **Curate dataset_seed.jsonl** (or several files): many *different* user-like anchors per
     tool, same `positive` text as in production. The `positive` must match what the router
     embeds: `{tool_id}. {EMBED_PHRASE[tool_id]}` (see `packages/opencode/src/session/tool-router.ts`).
  2. Run this script to emit N training lines by **stratified sampling** (equal weight per tool)
     or **uniform** over all seed rows. Use `--seed` for reproducibility.

Strategies:
  stratified  Sample a tool uniformly, then a random anchor row for that tool (default).
  uniform     Random row from the full seed (tools with more seed lines appear more often).
  repeat      Legacy: i %% len(seed); only for debugging.

Examples:
  python gen_dataset.py --n 50000 --out train.jsonl
  python gen_dataset.py --seed-files dataset_seed.jsonl extras.jsonl --n 100000 --strategy stratified

  More unique rows from a prompt+anchor+positive seed (no LLM): see expand_seed_extrapolate.py --seed ... --out ... --n ...
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path


def tool_from_positive(positive: str) -> str:
    if ". " in positive:
        return positive.split(". ", 1)[0].strip()
    return "unknown"


def load_rows(paths: list[Path]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for path in paths:
        if not path.is_file():
            raise SystemExit(f"missing file: {path}")
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            a = o.get("anchor")
            p = o.get("positive")
            if not isinstance(a, str) or not isinstance(p, str) or not a.strip() or not p.strip():
                raise SystemExit(f"bad row in {path}: need anchor and positive strings")
            rows.append({"anchor": a.strip(), "positive": p.strip()})
    if len(rows) < 1:
        raise SystemExit("no rows loaded")
    return rows


def bucket_by_tool(rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    b: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in rows:
        t = tool_from_positive(r["positive"])
        b[t].append(r)
    if "unknown" in b and len(b) > 1:
        print("warn: some positives lack `toolId. ` prefix; grouped as 'unknown'", file=sys.stderr)
    return dict(b)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seed-files", type=Path, nargs="+", default=[Path("dataset_seed.jsonl")])
    p.add_argument("--out", type=Path, default=Path("dataset_train.jsonl"))
    p.add_argument("--n", type=int, default=50_000)
    p.add_argument(
        "--strategy",
        choices=("stratified", "uniform", "repeat"),
        default="stratified",
        help="stratified: equal draws per tool id; uniform: weight by seed frequency; repeat: legacy modulo",
    )
    p.add_argument("--rng-seed", type=int, default=42)
    args = p.parse_args()

    rows = load_rows(list(args.seed_files))
    rng = random.Random(args.rng_seed)

    n = max(1, args.n)
    with args.out.open("w", encoding="utf-8") as f:
        if args.strategy == "repeat":
            print(
                "warn: strategy=repeat duplicates a tiny seed; prefer stratified after expanding dataset_seed.jsonl",
                file=sys.stderr,
            )
            L = len(rows)
            for i in range(n):
                r = rows[i % L]
                anchor = r["anchor"] if i < L else f'{r["anchor"]} [v{i}]'
                f.write(json.dumps({"anchor": anchor, "positive": r["positive"]}, ensure_ascii=False) + "\n")
        elif args.strategy == "uniform":
            for _ in range(n):
                r = rng.choice(rows)
                f.write(json.dumps({"anchor": r["anchor"], "positive": r["positive"]}, ensure_ascii=False) + "\n")
        else:
            b = bucket_by_tool(rows)
            tools = [k for k in b if k != "unknown"]
            unk = b.get("unknown", [])
            if not tools and unk:
                tools = ["unknown"]
                b = {"unknown": unk}
            if not tools:
                raise SystemExit("no tool buckets")
            for _ in range(n):
                t = rng.choice(tools)
                r = rng.choice(b[t])
                f.write(json.dumps({"anchor": r["anchor"], "positive": r["positive"]}, ensure_ascii=False) + "\n")

    print("wrote", n, "lines ->", args.out.resolve(), "strategy=", args.strategy)


if __name__ == "__main__":
    main()
