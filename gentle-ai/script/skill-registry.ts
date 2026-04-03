#!/usr/bin/env bun
import path from "node:path"
import { writeRegistry } from "../lib/skill-registry.ts"

const root = path.resolve(process.argv[2] ?? process.cwd())
const out = await writeRegistry(root)
const n = (await Bun.file(out).text()).length
console.log(`Wrote ${out} (${n} chars)`)
