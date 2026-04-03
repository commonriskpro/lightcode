"""
Export a SentenceTransformer folder (PyTorch) to ONNX layout expected by
`@huggingface/transformers` in Node (`onnx/model.onnx` + `config.json` + tokenizer).

The Xenova Hub build (~80MB) is mostly int8-quantized ONNX; a raw fp32 export is ~450MB.
Default here is **q8** (dynamic quantization) for a similar footprint. Use `--precision fp16` or `fp32` if needed.

Usage (from this directory, venv active):
  pip install onnx onnxruntime
  python export_onnx.py --in output/ft-500k --out output/ft-500k-onnx

Then (PowerShell):
  $env:OPENCODE_TOOL_ROUTER_EMBED_MODEL="C:\\...\\output\\ft-500k-onnx"
  cd ..\\..\\packages\\opencode
  npx tsx ./script/transformers-intent-smoke.ts
"""
from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoModel


def attn_4d(mask2d: torch.Tensor, dtype: torch.dtype) -> torch.Tensor:
    """2D 0/1 padding mask -> 4D additive mask; avoids transformers 5.x mask code under torch.jit trace."""
    x = mask2d[:, None, None, :].to(dtype=dtype)
    return (1.0 - x) * (-10000.0)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", type=Path, required=True, help="SentenceTransformer save dir (e.g. output/ft-500k)")
    p.add_argument("--out", type=Path, required=True, help="Output dir: onnx/model.onnx + tokenizer + config.json")
    p.add_argument(
        "--precision",
        choices=("q8", "fp16", "fp32"),
        default="q8",
        help="q8: dynamic int8 quant (~110MB class, like Hub); fp16: half size vs fp32; fp32: largest, reference",
    )
    p.add_argument("--opset", type=int, default=17, help="ONNX opset (17 works with onnxruntime-node in opencode)")
    args = p.parse_args()

    if not args.inp.is_dir():
        raise SystemExit(f"not a directory: {args.inp}")
    cfg = args.inp / "config.json"
    if not cfg.is_file():
        raise SystemExit(f"missing {cfg}")

    st = SentenceTransformer(str(args.inp), device="cpu")
    tok = st.tokenizer
    bert = AutoModel.from_pretrained(
        str(args.inp),
        local_files_only=True,
        attn_implementation="eager",
    )
    bert.eval()

    dtype = torch.float32
    if args.precision == "fp16":
        bert = bert.half()
        dtype = torch.float16

    class Wrap(torch.nn.Module):
        def __init__(self, b: torch.nn.Module, dt: torch.dtype) -> None:
            super().__init__()
            self.bert = b
            self.dt = dt

        def forward(
            self,
            input_ids: torch.Tensor,
            attention_mask: torch.Tensor,
            token_type_ids: torch.Tensor,
        ) -> torch.Tensor:
            return self.bert(
                input_ids=input_ids,
                attention_mask=attn_4d(attention_mask, self.dt),
                token_type_ids=token_type_ids,
            ).last_hidden_state

    w = Wrap(bert, dtype)
    w.eval()

    batch = tok(
        ["short text", "a longer piece of text for tracing"],
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="pt",
    )
    input_ids = batch["input_ids"]
    attention_mask = batch["attention_mask"]
    token_type_ids = batch.get("token_type_ids")
    if token_type_ids is None:
        token_type_ids = torch.zeros_like(input_ids)

    input_ids = input_ids.to(torch.device("cpu"))
    attention_mask = attention_mask.to(torch.device("cpu"))
    token_type_ids = token_type_ids.to(torch.device("cpu"))

    out_dir = args.out
    onnx_dir = out_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    final_onnx = onnx_dir / "model.onnx"

    def run_export(dst: Path) -> None:
        torch.onnx.export(
            w,
            (input_ids, attention_mask, token_type_ids),
            str(dst),
            input_names=["input_ids", "attention_mask", "token_type_ids"],
            output_names=["last_hidden_state"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "sequence"},
                "attention_mask": {0: "batch", 1: "sequence"},
                "token_type_ids": {0: "batch", 1: "sequence"},
                "last_hidden_state": {0: "batch", 1: "sequence", 2: "hidden"},
            },
            opset_version=args.opset,
            dynamo=False,
        )

    if args.precision == "q8":
        from onnxruntime.quantization import QuantType, quantize_dynamic

        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "model_fp32.onnx"
            run_export(raw)
            quantize_dynamic(
                str(raw),
                str(final_onnx),
                weight_type=QuantType.QInt8,
            )
    else:
        run_export(final_onnx)

    tok.save_pretrained(str(out_dir))
    shutil.copy2(cfg, out_dir / "config.json")

    mb = final_onnx.stat().st_size / (1024 * 1024)
    print("wrote", final_onnx.resolve(), f"({mb:.1f} MB)", args.precision)
    print("OPENCODE_TOOL_ROUTER_EMBED_MODEL=" + str(out_dir.resolve()))


if __name__ == "__main__":
    main()
