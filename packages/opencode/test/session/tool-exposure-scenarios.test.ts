import { describe, expect, test, afterAll } from "bun:test"
import path from "path"
import {
  runExposureScenario,
  scenariosGrowAttachedSacVsSpr,
  type ScenarioDefaults,
  type ScenarioFixture,
} from "@/session/router-exposure-scenario"
import { shutdownRouterEmbedIpc } from "@/session/router-embed-ipc"

type FixtureFile = {
  defaults: ScenarioDefaults
  scenarios: ScenarioFixture[]
}

const fixturePath = path.join(import.meta.dir, "../fixtures/router-exposure-scenarios.json")

function mergeScenario(s: ScenarioFixture, defaults: ScenarioDefaults): ScenarioFixture {
  return {
    ...s,
    allowed_tools: s.allowed_tools ?? defaults.allowed_tools,
    router: { ...defaults.router, ...s.router },
  }
}

afterAll(() => {
  shutdownRouterEmbedIpc()
})

describe("router exposure multi-turn scenarios", async () => {
  const raw = (await Bun.file(fixturePath).json()) as FixtureFile
  const { defaults, scenarios } = raw
  expect(scenarios.length).toBeGreaterThanOrEqual(40)

  for (const s of scenarios) {
    if (s.id === "G-growth-sac" || s.id === "G-growth-spr") continue
    test(s.id, async () => {
      const scenario = mergeScenario(s, defaults)
      const out = await runExposureScenario({ scenario, defaults, shutdownEmbed: shutdownRouterEmbedIpc })
      if (!out.ok) throw new Error(out.error)
    })
  }

  test("G-growth: SAC final attach larger than SPR (paired scenarios)", async () => {
    const sac = scenarios.find((x) => x.id === "G-growth-sac")
    const spr = scenarios.find((x) => x.id === "G-growth-spr")
    expect(sac).toBeDefined()
    expect(spr).toBeDefined()
    const r1 = await runExposureScenario({
      scenario: mergeScenario(sac!, defaults),
      defaults,
      shutdownEmbed: shutdownRouterEmbedIpc,
    })
    const r2 = await runExposureScenario({
      scenario: mergeScenario(spr!, defaults),
      defaults,
      shutdownEmbed: shutdownRouterEmbedIpc,
    })
    if (!r1.ok) throw new Error(r1.error)
    if (!r2.ok) throw new Error(r2.error)
    const g = scenariosGrowAttachedSacVsSpr({ sac: r1.turns, spr: r2.turns })
    expect(g.ok).toBe(true)
  })
})
