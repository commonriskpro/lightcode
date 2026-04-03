#!/usr/bin/env bun
import path from "path"
import {
  runExposureScenario,
  scenariosGrowAttachedSacVsSpr,
  type ScenarioDefaults,
  type ScenarioFixture,
} from "../src/session/router-exposure-scenario"
import { shutdownRouterEmbedIpc } from "../src/session/router-embed-ipc"

type FixtureFile = {
  defaults: ScenarioDefaults
  scenarios: ScenarioFixture[]
}

const fixturePath = path.join(import.meta.dir, "../test/fixtures/router-exposure-scenarios.json")

function mergeScenario(s: ScenarioFixture, defaults: ScenarioDefaults): ScenarioFixture {
  return {
    ...s,
    allowed_tools: s.allowed_tools ?? defaults.allowed_tools,
    router: { ...defaults.router, ...s.router },
  }
}

const raw = (await Bun.file(fixturePath).json()) as FixtureFile
let pass = 0
let fail = 0

for (const s of raw.scenarios) {
  if (s.id === "G-growth-sac" || s.id === "G-growth-spr") continue
  const scenario = mergeScenario(s, raw.defaults)
  const out = await runExposureScenario({ scenario, defaults: raw.defaults, shutdownEmbed: shutdownRouterEmbedIpc })
  if (out.ok) {
    pass++
    console.log(`OK  ${s.id}`)
  } else {
    fail++
    console.log(`FAIL ${s.id}`)
    console.log(`     ${out.error}`)
  }
}

const sac = raw.scenarios.find((x) => x.id === "G-growth-sac")
const spr = raw.scenarios.find((x) => x.id === "G-growth-spr")
if (sac && spr) {
  const r1 = await runExposureScenario({
    scenario: mergeScenario(sac, raw.defaults),
    defaults: raw.defaults,
    shutdownEmbed: shutdownRouterEmbedIpc,
  })
  const r2 = await runExposureScenario({
    scenario: mergeScenario(spr, raw.defaults),
    defaults: raw.defaults,
    shutdownEmbed: shutdownRouterEmbedIpc,
  })
  const g =
    r1.ok && r2.ok ? scenariosGrowAttachedSacVsSpr({ sac: r1.turns, spr: r2.turns }) : { ok: false, detail: "run failed" }
  if (g.ok) {
    pass++
    console.log("OK  G-growth paired (SAC vs SPR)")
  } else {
    fail++
    console.log("FAIL G-growth paired (SAC vs SPR)")
    console.log(`     ${g.detail ?? ""}`)
  }
}

shutdownRouterEmbedIpc()
console.log(`\nscenarios pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
