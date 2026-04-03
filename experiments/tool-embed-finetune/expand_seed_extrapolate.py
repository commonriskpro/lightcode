"""
Extrapolate a high-quality JSONL seed (prompt + anchor + positive) into more unique rows.

Strategy (no LLM):
  1. Split each anchor at the last \" For \" — body (intent) vs trailer (synthetic context).
  2. Resample trailers from large disjoint lists (role, branch, phase, codename, clause) so
     the model does not fixate on one \"Atlas / Stripe\" tail.
  3. Swap prompt from the same tool's prompt pool (from the seed) or the global pool.
  4. Optionally nudge paths in the body (apps/web/*, docs/canonical/*) from curated lists.
  5. Dedupe on (prompt, anchor, positive).

Usage:
  python expand_seed_extrapolate.py --seed path/to/10k.jsonl --out extrapolated.jsonl --n 100000

  # Total lines = n; default includes all seed rows then generates until n.
  python expand_seed_extrapolate.py --seed 10k.jsonl --out big.jsonl --n 500000 --rng 7
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path


def tool_from_positive(positive: str) -> str:
    if ". " in positive:
        return positive.split(". ", 1)[0].strip()
    return "unknown"


def load_seed(path: Path) -> list[dict[str, str]]:
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
            raise SystemExit(f"{path}: need prompt, anchor, positive strings")
        if not pr.strip() or not a.strip() or not p.strip():
            raise SystemExit(f"{path}: empty field")
        rows.append({"prompt": pr.strip(), "anchor": a.strip(), "positive": p.strip()})
    if len(rows) < 1:
        raise SystemExit("empty seed")
    return rows


def body_from_anchor(anchor: str) -> str:
    if " For " not in anchor:
        return anchor
    return anchor.rsplit(" For ", 1)[0].strip()


ROLES = [
    "new hire",
    "support team",
    "ops squad",
    "staff engineers",
    "the PM",
    "mobile squad",
    "client success",
    "security team",
    "release captain",
    "the infra guild",
    "SRE oncall",
    "a contractor",
    "partner engineer",
    "field CE",
    "design partner",
    "QA lead",
    "tech lead",
    "platform engineer",
    "data engineer",
    "frontend guild",
]

BRANCHES = [
    "main",
    "master",
    "develop",
    "release/2.4",
    "hotfix/oauth",
    "feature/billing",
    "staging",
    "chore/deps",
]

PHASES = [
    "before the release train",
    "before the handoff",
    "before code freeze",
    "this afternoon",
    "during on-call",
    "after standup",
    "before prod cutover",
    "during the incident bridge",
    "while shadowing deploy",
    "before the audit window",
]

CODENAMES = [
    "Atlas",
    "Harbor",
    "Nebula",
    "Mercury",
    "Orchid",
    "Pulse",
    "Voyager",
    "Quartz",
    "Helix",
    "Cinder",
    "Aurora",
    "Vertex",
    "Rivet",
    "Cobalt",
    "Drift",
    "Ember",
    "Falcon",
    "Glacier",
]

CLAUSES = [
    "touching Stripe from the monorepo around auth.",
    "wiring Redis cache invalidation for checkout.",
    "rolling out OAuth for the admin portal.",
    "aligning feature flags with the billing API.",
    "debugging webhook retries for invoice export.",
    "hardening rate limits on the public edge.",
    "migrating Prisma schema drift in CI.",
    "shipping the observability drain to Datadog.",
    "unblocking the mobile release candidate.",
    "fixing flaky e2e around tenant isolation.",
    "reviewing bulk import for the data warehouse.",
    "tightening CORS for the embed widget.",
    "chasing a race in session refresh.",
    "validating GDPR export for EU tenants.",
    "pairing on the canary for search ranking.",
    "coordinating with infra on VPC peering.",
    "preparing the SOC2 evidence pack.",
    "cutting over traffic to the blue cluster.",
]

APPS = [
    "apps/web/auth",
    "apps/web/queue",
    "apps/web/inbox",
    "apps/web/onboarding",
    "apps/web/reporting",
    "apps/web/scheduler",
    "apps/web/profile",
    "apps/web/search",
    "apps/web/cache",
    "apps/web/flags",
    "apps/web/notifications",
    "apps/web/reconciliation",
    "apps/web/inventory",
]

DOCS = [
    "docs/canonical/search",
    "docs/canonical/cache",
    "docs/canonical/reporting",
    "docs/canonical/contracts",
    "docs/canonical/webhooks",
    "docs/canonical/flags",
    "docs/canonical/auth",
    "docs/canonical/notifications",
    "docs/canonical/queue",
    "docs/canonical/inventory",
]


def sample_trailer(rng: random.Random) -> str:
    return (
        f"For {rng.choice(ROLES)} on {rng.choice(BRANCHES)} {rng.choice(PHASES)}, "
        f"in {rng.choice(CODENAMES)} dev, {rng.choice(CLAUSES)}"
    )


def tweak_body(body: str, rng: random.Random) -> str:
    out = body

    def sub(pat: str, pool: list[str]) -> None:
        nonlocal out
        m = re.search(pat, out)
        if m and rng.random() < 0.55:
            out = out[: m.start()] + rng.choice(pool) + out[m.end() :]

    sub(r"apps/web/[a-z0-9_-]+", APPS)
    sub(r"docs/canonical/[a-z0-9_-]+", DOCS)
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seed", type=Path, required=True, help="Input JSONL (prompt, anchor, positive)")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--n", type=int, required=True, help="Total output lines (with --include-seed, grows past seed size)")
    p.add_argument("--include-seed", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--rng", type=int, default=42)
    args = p.parse_args()

    rng = random.Random(args.rng)
    rows = load_seed(args.seed)
    n = max(1, args.n)

    by_tool: dict[str, list[str]] = {}
    for r in rows:
        t = tool_from_positive(r["positive"])
        by_tool.setdefault(t, []).append(r["prompt"])
    for t in by_tool:
        by_tool[t] = list(dict.fromkeys(by_tool[t]))
    all_prompts = list(dict.fromkeys(r["prompt"] for r in rows))

    seen: set[tuple[str, str, str]] = set()
    out: list[dict[str, str]] = []

    if args.include_seed:
        for r in rows:
            k = (r["prompt"], r["anchor"], r["positive"])
            if k in seen:
                continue
            seen.add(k)
            out.append(dict(r))
        if len(out) < len(rows):
            print("warn: seed had duplicate triples; kept unique only", file=sys.stderr)

    if n < len(out):
        out = out[:n]
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as f:
            for r in out:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print("wrote", len(out), "lines (truncated to --n) ->", args.out.resolve(), file=sys.stderr)
        return

    cap = n * 50
    tries = 0
    while len(out) < n and tries < cap:
        tries += 1
        r = rng.choice(rows)
        tid = tool_from_positive(r["positive"])
        body = body_from_anchor(r["anchor"])
        if rng.random() < 0.72:
            body = tweak_body(body, rng)
        anchor = f"{body} {sample_trailer(rng)}"
        pool = by_tool.get(tid) or all_prompts
        prompt = rng.choice(pool) if pool else rng.choice(all_prompts)
        if rng.random() < 0.08:
            prompt = rng.choice(all_prompts)
        k = (prompt, anchor, r["positive"])
        if k in seen:
            continue
        seen.add(k)
        out.append({"prompt": prompt, "anchor": anchor, "positive": r["positive"]})

    if len(out) < n:
        extra = 0
        while len(out) < n and extra < n * 100:
            extra += 1
            r = rng.choice(rows)
            body = tweak_body(body_from_anchor(r["anchor"]), rng)
            anchor = f"{body} {sample_trailer(rng)} #{extra}"
            tid = tool_from_positive(r["positive"])
            pool = by_tool.get(tid) or all_prompts
            prompt = rng.choice(pool) if pool else rng.choice(all_prompts)
            k = (prompt, anchor, r["positive"])
            if k in seen:
                continue
            seen.add(k)
            out.append({"prompt": prompt, "anchor": anchor, "positive": r["positive"]})

    if len(out) < n:
        raise SystemExit(f"stopped at {len(out)} < {n} after collision saturation; raise lists or --n")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for r in out[:n]:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(
        "wrote",
        min(n, len(out)),
        "lines ->",
        args.out.resolve(),
        "tries=",
        tries,
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
