import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(pkg, "node_modules", "onnxruntime-node")
if (!fs.existsSync(target)) process.exit(0)

const bunDirs = [
  path.join(pkg, "node_modules", ".bun"),
  path.join(pkg, "..", "..", "node_modules", ".bun"),
]

for (const bun of bunDirs) {
  if (!fs.existsSync(bun)) continue
  for (const name of fs.readdirSync(bun)) {
    if (!name.startsWith("@huggingface+transformers@")) continue
    const nest = path.join(bun, name, "node_modules", "onnxruntime-node")
    const parent = path.dirname(nest)
    if (!fs.existsSync(parent)) continue
    if (fs.existsSync(nest)) {
      const st = fs.lstatSync(nest)
      if (st.isSymbolicLink() || st.isDirectory()) continue
      fs.rmSync(nest)
    }
    fs.symlinkSync(target, nest)
  }
}
