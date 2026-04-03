import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"

describe("session.system", () => {
  test("skills output is minimal description for token optimization", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".opencode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---
  
# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const first = await SystemPrompt.skills(build!)
          const second = await SystemPrompt.skills(build!)

          expect(first).toBe(second)

          expect(first).toContain("Skills provide specialized instructions")
          expect(first).toContain("skill tool")
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills caching works across different agent instances of same type", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: test-skill
description: Test skill.
---
  
# Test skill
`,
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Get two different instances of the same agent type
          const build1 = await Agent.get("build")
          const build2 = await Agent.get("build")

          // First call generates and caches the skills
          const skills1 = await SystemPrompt.skills(build1!)

          // Second call should return the cached version (same object reference)
          const skills2 = await SystemPrompt.skills(build2!)

          expect(skills1).toBe(skills2)
          expect(skills1).toContain("skill tool")
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills are omitted for agents with skill:deny permission", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: test-skill
description: Test skill.
---
 
# Test skill
`,
        )

        // Create opencode.json with skill:deny for a custom agent
        const opencodeJsonPath = path.join(dir, ".opencode", "opencode.json")
        await Bun.write(
          opencodeJsonPath,
          JSON.stringify(
            {
              agent: {
                "test-agent": {
                  permission: {
                    skill: "deny",
                  },
                },
              },
            },
            null,
            2,
          ),
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Get an agent with skill:deny permission
          const testAgent = await Agent.get("test-agent")

          // Skills should be omitted (return undefined)
          const skills = await SystemPrompt.skills(testAgent!)
          expect(skills).toBeUndefined()
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills are included for primary agents without skill:deny", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: test-skill
description: Test skill.
---
 
# Test skill
`,
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Get a primary agent (build) without skill:deny
          const buildAgent = await Agent.get("build")

          // Skills should be included (minimal description for token optimization)
          const skills = await SystemPrompt.skills(buildAgent!)
          expect(skills).toBeDefined()
          expect(skills).toContain("Skills provide specialized instructions")
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("skills are omitted for subagents with default explore configuration", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: test-skill
description: Test skill.
---
 
# Test skill
`,
        )
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Get a subagent (explore) - by default it has skills denied due to "*": "deny" in its permissions
          const exploreAgent = await Agent.get("explore")

          // Skills should be omitted for explore agent with default configuration
          const skills = await SystemPrompt.skills(exploreAgent!)
          expect(skills).toBeUndefined()
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })
})
