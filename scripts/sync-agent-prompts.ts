/**
 * Register a fresh Agent version per role with the current in-code prompts,
 * then publish one team version that uses those versions.
 *
 * Every existing project, team, and version stays untouched: the script only
 * adds rows. Run it after changing a role prompt in
 * packages/experimental/future-cup-orchestration/src/prompts.ts, then create a
 * new project bound to the printed team version id.
 */

import { resolve } from 'node:path'
import {
  listAgentRoleTemplates,
  OrchestrationRepository,
  PersistentAgentRegistry,
} from '../packages/experimental/future-cup-orchestration/src/index.ts'

const DATABASE = process.argv[2]
  ?? 'D:/Users/tr666/Documents/ChatGPT/ruiruiai/.artifacts/future-cup-platform.sqlite'

const VERSION = process.argv[3] ?? '2.0.0'
const TEAM_NAME = process.argv[4] ?? 'Future Cup Team (current prompts)'

async function main(): Promise<void> {
  const repository = new OrchestrationRepository(resolve(DATABASE))
  const registry = new PersistentAgentRegistry(repository)
  await registry.initialize()

  const templates = listAgentRoleTemplates()
  const members: { agentVersionId: string; instanceCount: number }[] = []

  for (const template of templates) {
    const role = template.role
    const definitionId = role
    const version = await registry.registerVersion(definitionId, {
      id: `${role}-${VERSION}`,
      version: VERSION,
      role,
      model: template.defaultModel,
      prompt: template.defaultPrompt,
      promptVersion: `m5.1-${VERSION}`,
      capabilities: template.defaultCapabilities,
      toolAllowlist: [...template.defaultToolAllowlist],
      memoryPolicy: template.defaultMemoryPolicy,
      maxConcurrency: template.defaultMaxConcurrency,
      inputSchema: template.inputSchema,
      outputSchema: template.outputSchema,
    })
    await registry.validateVersion(definitionId, version.id)
    await registry.publishVersion(definitionId, version.id)
    console.log(`registered and published ${version.id}`)
    // The system Verifier is not a runtime Team member.
    if (role !== 'verifier') {
      members.push({
        agentVersionId: version.id,
        instanceCount: role === 'frontend' ? 2 : 1,
      })
    }
  }

  const requiredCapabilities: Record<string, number> = {}
  for (const template of templates) {
    if (template.role === 'verifier') continue
    for (const [capability, value] of Object.entries(template.defaultCapabilities)) {
      requiredCapabilities[capability] = Math.max(requiredCapabilities[capability] ?? 0, value)
    }
  }

  const teamVersion = await registry.createTeamVersion({
    id: `team-prompt-sync-${VERSION}`,
    teamId: 'team-prompt-sync',
    ownerId: 'future-cup-local-user',
    name: TEAM_NAME,
    version: VERSION,
    purpose: 'Deliver a verified React frontend project with controlled specialist Agents.',
    members,
    requiredCapabilities,
    requiredConcurrency: 5,
    toolPolicy: { allowedTools: ['fs-read'], requiredTools: ['fs-read'] },
    memoryPolicy: {
      allowedAccess: 'WRITE',
      requiredAccess: 'READ',
      allowedKinds: ['requirement', 'design-decision', 'failure-signature', 'accepted-artifact-summary'],
      requiredKinds: ['requirement', 'design-decision', 'failure-signature'],
    },
    inputSchema: templates[0]?.inputSchema ?? { type: 'object' },
    requiredOutputSchemas: templates
      .filter(template => template.role !== 'verifier')
      .map(template => template.outputSchema),
  })

  console.log('')
  console.log('TEAM VERSION ID:', teamVersion.id)
  console.log('members:', teamVersion.members.map(m => m.instanceId).join(', '))

  repository.close()
}

await main()
