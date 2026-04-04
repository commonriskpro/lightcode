import { Tool } from "./tool"
import z from "zod"
import { Session } from "../session"
import { Agent } from "../agent/agent"

const TEAM_CREATE_DESC = `Create a team of agents that can work together on a task.

Each team member is a subagent that can be delegated tasks via the \`task\` tool.
Use this to parallelize work across multiple specialized agents.

## Team Creation
- Specify team name and member agents
- Each member gets a unique peer identifier
- Team persists for the session

## Use Cases
- Parallel file exploration
- Multi-stage workflows
- Independent subagents working on different parts`

const SEND_MESSAGE_DESC = `Send a message to another agent in your team.

Use this to coordinate with team members or delegate specific tasks.
Messages are delivered directly to the target agent's context.

## Format
- Direct task delegation: "@agent-name: task description"
- Status request: "@agent-name: what's your progress?"
- Coordination: "@agent-name: I finished X, please handle Y"`

const LIST_PEERS_DESC = `List all connected team members in your agent swarm.

Shows the current team roster with agent names and their status.
Use this to find agents to coordinate with.`

/**
 * Tool for creating agent teams (swarms)
 */
export const TeamCreateTool = Tool.define("team_create", async () => ({
  description: TEAM_CREATE_DESC,
  parameters: z.object({
    name: z.string().describe("Name of the team"),
    agents: z.array(z.string()).describe("List of agent names to include in the team"),
  }),
  async execute(params, ctx) {
    const teamId = `team_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // Store team in session state
    const sessionData = await getSessionTeamData(ctx.sessionID)
    sessionData.teams.set(teamId, {
      id: teamId,
      name: params.name,
      members: params.agents,
      createdAt: Date.now(),
    })

    return {
      title: "Team Created",
      metadata: { teamId, memberCount: params.agents.length },
      output: [
        `✅ Team "${params.name}" created with ID: ${teamId}`,
        "",
        "## Team Members",
        ...params.agents.map((a, i) => `${i + 1}. ${a}`),
        "",
        "Use @agent-name to delegate tasks to team members.",
      ].join("\n"),
    }
  },
}))

/**
 * Tool for sending messages between agents in a team
 */
export const SendMessageTool = Tool.define("send_message", async () => ({
  description: SEND_MESSAGE_DESC,
  parameters: z.object({
    to: z.string().describe("Target agent name or peer ID"),
    message: z.string().describe("Message to send"),
    team_id: z.string().optional().describe("Team ID (if not in default team)"),
  }),
  async execute(params, ctx): Promise<{ title: string; metadata: Record<string, any>; output: string }> {
    const sessionData = await getSessionTeamData(ctx.sessionID)

    // Find target agent
    const targetPeer = findPeer(sessionData, params.to)
    if (!targetPeer) {
      return {
        title: "Peer Not Found",
        metadata: { success: false, found: false, to: params.to, messageId: undefined },
        output: [`❌ Agent "${params.to}" not found in team.`, "", "Use list_peers to see available agents."].join(
          "\n",
        ),
      }
    }

    // Queue message for target agent
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    sessionData.messages.set(messageId, {
      id: messageId,
      from: ctx.agent,
      to: params.to,
      content: params.message,
      timestamp: Date.now(),
      delivered: false,
    })

    return {
      title: "Message Sent",
      metadata: { success: true, found: true, to: params.to, messageId },
      output: [
        `✅ Message sent to ${params.to}`,
        "",
        `"${params.message}"`,
        "",
        "The agent will receive this in their next context.",
      ].join("\n"),
    }
  },
}))

/**
 * Tool for listing connected peers in the swarm
 */
export const ListPeersTool = Tool.define("list_peers", async () => ({
  description: LIST_PEERS_DESC,
  parameters: z.object({
    team_id: z.string().optional().describe("Team ID to list (default: all)"),
  }),
  async execute(params, ctx) {
    const sessionData = await getSessionTeamData(ctx.sessionID)
    const teams = Array.from(sessionData.teams.values())

    if (teams.length === 0) {
      return {
        title: "No Teams",
        metadata: { count: 0 },
        output: "No teams created yet. Use team_create to create a team.",
      }
    }

    const lines = ["## Connected Agents", ""]
    for (const team of teams) {
      lines.push(`### Team: ${team.name} (${team.id})`)
      for (const member of team.members) {
        lines.push(`- ${member}`)
      }
      lines.push("")
    }

    return {
      title: "Peer List",
      metadata: { count: teams.reduce((sum, t) => sum + t.members.length, 0) },
      output: lines.join("\n"),
    }
  },
}))

// Helper functions

interface TeamData {
  teams: Map<string, { id: string; name: string; members: string[]; createdAt: number }>
  messages: Map<
    string,
    { id: string; from: string; to: string; content: string; timestamp: number; delivered: boolean }
  >
}

const sessionTeamData = new Map<string, TeamData>()

async function getSessionTeamData(sessionID: string): Promise<TeamData> {
  let data = sessionTeamData.get(sessionID)
  if (!data) {
    data = { teams: new Map(), messages: new Map() }
    sessionTeamData.set(sessionID, data)
  }
  return data
}

function findPeer(sessionData: TeamData, query: string) {
  for (const team of sessionData.teams.values()) {
    if (team.members.includes(query)) {
      return { team: team.id, member: query }
    }
  }
  return null
}
