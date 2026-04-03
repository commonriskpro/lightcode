"""
Fine-tune a sentence-transformer locally (e.g. RTX 3070) for tool-router-style alignment.

Setup (from this directory):
  Use Python 3.11 or 3.12 (not 3.14): PyTorch/transformers may not match yet.
  python -m venv .venv
  .venv\\Scripts\\activate   # Windows
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
  pip install -r requirements.txt

If you see: operator torchvision::nms does not exist — reinstall torch + torchvision
in ONE command from https://pytorch.org/get-started/locally/ (same CUDA version).

Defaults on CUDA: bf16 (if supported), TF32 matmuls, cudnn.benchmark, pin_memory, DataLoader workers +
prefetch, optional --compile (torch.compile). Forward/backward run on GPU; --data JSONL is loaded with
datasets (Arrow) instead of one giant Python string + lists.

Smoke (1 epoch, small batch if OOM):
  python train.py --epochs 1 --batch-size 4 --out output/smoke-test

Resume after interrupt (uses latest checkpoint in --checkpoint-dir):
  python train.py --resume --checkpoint-dir output/checkpoints --out output/finetuned-minilm

ETA lines print every --eta-every steps (matches Trainer logging_steps).

Run:
  python train.py
  python train.py --epochs 3 --data dataset_seed.jsonl --out ./output/finetuned-minilm

Output: ./output/finetuned-minilm (PyTorch + safetensors).

Use in OpenCode (ONNX for @huggingface/transformers):
  pip install onnx onnxruntime
  python export_onnx.py --in output/finetuned-minilm --out output/finetuned-onnx
  # Default export uses int8 dynamic quant (~110MB); use --precision fp16 or fp32 if you need larger / reference.
  # PowerShell: $env:OPENCODE_TOOL_ROUTER_EMBED_MODEL="C:\\...\\output\\finetuned-onnx"
  # Then from packages/opencode: npx tsx ./script/transformers-intent-smoke.ts
  # Exact-match sweep: docs/tool-router-exact-match-benchmark.md (bun run script/tool-router-exact-sweep.ts).

Pairs format (JSONL): {"anchor": "user text", "positive": "tool phrase"}
  Optional: {"prompt": "system/context", "anchor": "user", "positive": "..."} — prompt and anchor are merged
  into one anchor string (prompt + blank lines + anchor) before training.
  Large unique seed (>=100k pairs): `python build_seed_100k.py --out dataset_seed_100k.jsonl`
  Extrapolate a curated 10k-style JSONL (prompt+anchor+positive) to more unique rows: `python expand_seed_extrapolate.py --seed your.jsonl --out big.jsonl --n 500000`
  Preferred 500k (gold 10.2k + anchors_for × prompt bank, deduped): `python build_high_quality_500k.py --seed your.jsonl --out dataset_train_500k_hq.jsonl --n 500000`
  Training JSONL from seeds: `python gen_dataset.py --seed-files dataset_seed_100k.jsonl --n 100000 --out dataset_train.jsonl`

Large runs (~500k pairs, RTX 3080 class):
  - Data is loaded via Hugging Face datasets (Arrow); avoid duplicating huge Python strings.
  - Throughput: prefer --batch-size 32 (or 48 if no OOM); keep bf16/TF32 (defaults on CUDA).
  - If steps feel sluggish: --batch-sampler batch (faster than no_duplicates on huge N; slightly weaker in-batch negatives).
  - On Windows, if you see CUDA IPC warnings or odd slowness: try --workers 0 vs default 2.
  - Less disk churn: --checkpoint-every 5000 --checkpoint-limit 2; quieter logs: --eta-every 200.
  - Skip --compile until a short run is stable (first steps pay compile cost).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

import torch
from datasets import load_dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer
from sentence_transformers.losses import MultipleNegativesRankingLoss
from sentence_transformers.training_args import BatchSamplers, SentenceTransformerTrainingArguments
from transformers import TrainerCallback, TrainerControl, TrainerState
from transformers.training_args import TrainingArguments


class EtaCallback(TrainerCallback):
    """Prints remaining time from current average step time (updates as training progresses)."""

    def __init__(self, total_steps: int) -> None:
        self.total = max(1, total_steps)
        self.t0: float | None = None

    def on_train_begin(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs,
    ) -> None:
        self.t0 = time.perf_counter()

    def on_log(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        logs: dict | None = None,
        **kwargs,
    ) -> None:
        if logs is None or self.t0 is None:
            return
        step = state.global_step
        if step <= 0:
            return
        cap = state.max_steps if getattr(state, "max_steps", None) and state.max_steps > 0 else self.total
        elapsed = time.perf_counter() - self.t0
        rate = step / elapsed
        left = max(0.0, (cap - step) / rate) if rate > 0 else 0.0

        def fmt(sec: float) -> str:
            s = int(sec)
            m, s = divmod(s, 60)
            h, m = divmod(m, 60)
            if h:
                return f"{h}h{m:02d}m{s:02d}s"
            if m:
                return f"{m}m{s:02d}s"
            return f"{s}s"

        print(
            f"[eta] step {step}/{cap}  elapsed {fmt(elapsed)}  remaining ~{fmt(left)}",
            flush=True,
        )


def find_resume_ckpt(dir: Path) -> str | None:
    if not dir.is_dir():
        return None
    cps = [p for p in dir.iterdir() if p.is_dir() and p.name.startswith("checkpoint-")]
    if not cps:
        return None

    def key(p: Path) -> int:
        try:
            return int(p.name.split("-", 1)[1])
        except (IndexError, ValueError):
            return 0

    return str(max(cps, key=key))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    p.add_argument("--data", type=Path, default=Path("dataset_seed.jsonl"))
    p.add_argument("--out", type=Path, default=Path("output/finetuned-minilm"))
    p.add_argument("--epochs", type=int, default=1, help="HF embedding examples often use 1; use 2–3 if data is huge and metrics still improve")
    p.add_argument("--batch-size", type=int, default=16, help="16 matches HF blog; lower if CUDA OOM (e.g. 8)")
    p.add_argument("--warmup-ratio", type=float, default=0.1)
    p.add_argument(
        "--batch-sampler",
        choices=("no_duplicates", "batch"),
        default="no_duplicates",
        help="no_duplicates: better MNRL negatives (slower on very large N). batch: faster throughput (huge JSONL)",
    )
    p.add_argument(
        "--checkpoint-dir",
        type=Path,
        default=None,
        help="Where to save training checkpoints (for resume). Default: <out.parent>/checkpoints-<out.name>",
    )
    p.add_argument("--checkpoint-every", type=int, default=500, metavar="STEPS", help="Save checkpoint every N steps")
    p.add_argument("--checkpoint-limit", type=int, default=3, help="Keep at most this many checkpoints (0 = all)")
    p.add_argument("--resume", action="store_true", help="Continue from latest checkpoint in --checkpoint-dir")
    p.add_argument(
        "--eta-every",
        type=int,
        default=50,
        metavar="STEPS",
        help="Log interval for [eta] lines (matches Trainer logging_steps)",
    )
    p.add_argument(
        "--bf16",
        dest="bf16",
        action="store_true",
        default=None,
        help="Use bf16 on CUDA (default: on when GPU supports it)",
    )
    p.add_argument(
        "--no-bf16",
        dest="bf16",
        action="store_false",
        help="Disable bf16 (fp32 training, slower, more VRAM)",
    )
    p.set_defaults(bf16=None)
    p.add_argument(
        "--workers",
        type=int,
        default=-1,
        help="DataLoader workers (-1 = auto: 2 on Windows CUDA, 4 on other CUDA, 0 on CPU)",
    )
    p.add_argument(
        "--compile",
        action="store_true",
        help="Enable torch.compile via Trainer (PyTorch 2+; first steps slower, then often faster)",
    )
    p.add_argument(
        "--no-tf32",
        action="store_true",
        help="Disable TF32 tensor cores (default on CUDA for faster matmuls on Ampere+)",
    )
    args = p.parse_args()

    if not args.data.is_file():
        raise SystemExit(f"--data not found: {args.data}")

    train_ds = load_dataset("json", data_files=str(args.data.resolve()), split="train")
    if train_ds.num_rows < 2:
        raise SystemExit("Need at least 2 pairs in --data (duplicate lines to smoke-test).")

    if "prompt" in train_ds.column_names:

        def merge_prompt(batch: dict) -> dict:
            merged = []
            for p, a in zip(batch["prompt"], batch["anchor"]):
                ps = (p or "").strip()
                au = (a or "").strip()
                merged.append(f"{ps}\n\n{au}" if ps else au)
            return {"anchor": merged, "positive": batch["positive"]}

        train_ds = train_ds.map(merge_prompt, batched=True, remove_columns=["prompt"])

    n = train_ds.num_rows
    bs = args.batch_size
    steps_per_epoch = max(1, math.ceil(n / bs))
    total_steps = steps_per_epoch * args.epochs
    warmup = int(total_steps * args.warmup_ratio)

    ckpt_dir = args.checkpoint_dir
    if ckpt_dir is None:
        ckpt_dir = args.out.parent / f"checkpoints-{args.out.name}"

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    if dev == "cuda":
        torch.backends.cudnn.benchmark = True
        if not args.no_tf32:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True

    use_bf16 = False
    if args.bf16 is False:
        use_bf16 = False
    elif args.bf16 is True:
        use_bf16 = dev == "cuda" and bool(getattr(torch.cuda, "is_bf16_supported", lambda: False)())
    else:
        use_bf16 = dev == "cuda" and bool(getattr(torch.cuda, "is_bf16_supported", lambda: False)())

    w = args.workers
    if w < 0:
        if dev == "cuda":
            w = 2 if sys.platform == "win32" else min(8, max(2, (os.cpu_count() or 4) // 2))
        else:
            w = 0

    print("device:", dev)
    print("bf16:", use_bf16, "tf32:", dev == "cuda" and not args.no_tf32, "dataloader_num_workers:", w)
    print("samples:", n, "steps/epoch:", steps_per_epoch, "total_steps (~):", total_steps)
    print("batch_sampler:", args.batch_sampler)

    sampler = BatchSamplers.NO_DUPLICATES if args.batch_sampler == "no_duplicates" else BatchSamplers.BATCH_SAMPLER

    model = SentenceTransformer(args.base, device=dev)
    loss = MultipleNegativesRankingLoss(model)

    callbacks: list[TrainerCallback] = [EtaCallback(total_steps)]

    targs = SentenceTransformerTrainingArguments(
        output_dir=str(ckpt_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=bs,
        batch_sampler=sampler,
        learning_rate=2e-5,
        weight_decay=0.01,
        max_grad_norm=1.0,
        warmup_steps=warmup,
        logging_steps=args.eta_every,
        save_strategy="steps",
        save_steps=args.checkpoint_every,
        save_total_limit=args.checkpoint_limit if args.checkpoint_limit > 0 else None,
        eval_strategy="no",
        report_to="none",
        bf16=use_bf16,
        fp16=False,
        tf32=dev == "cuda" and not args.no_tf32,
        dataloader_num_workers=w,
        dataloader_pin_memory=dev == "cuda",
        dataloader_persistent_workers=False,
        dataloader_prefetch_factor=4 if w > 0 else None,
        torch_compile=args.compile,
    )

    trainer = SentenceTransformerTrainer(
        model=model,
        args=targs,
        train_dataset=train_ds,
        loss=loss,
        callbacks=callbacks,
    )

    resume = find_resume_ckpt(ckpt_dir) if args.resume else None
    if args.resume:
        if resume:
            print("resume_from_checkpoint:", resume)
        else:
            print("resume requested but no checkpoint found in", ckpt_dir, "(starting fresh)")

    trainer.train(resume_from_checkpoint=resume)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(args.out))
    print("saved:", args.out.resolve())


if __name__ == "__main__":
    main()
