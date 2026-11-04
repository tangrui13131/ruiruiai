/** Real DeepSeek acceptance for the M5.5 user-owned seven-member Team workflow. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  agentProfilesFromTeamBinding,
  defaultAgentProfiles,
  OrchestrationRepository,
  PersistentAgentRegistry,
  ProjectId,
  verificationReportDataSchema,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { ProjectRunRecord } from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { FutureCupRunLauncher } from '../src/run-launcher.ts'
import { createFutureCupServer } from '../src/server.ts'
import type { FutureCupServer } from '../src/server-types.ts'

const hasKey = process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== ''
const artifactRoot = resolve(import.meta.dirname, '../../../../.artifacts/future-cup-m55-live')
const projectResponseSchema = z.looseObject({ id: z.string().min(1) })
const runStartSchema = z.looseObject({ runId: z.string().min(1) })
const drillStartSchema = z.looseObject({
  runId: z.string().min(1),
  mode: z.literal('preset:typescript-contract'),
  injectedFault: z.looseObject({
    mode: z.literal('preset:typescript-contract'),
    targetFile: z.string().optional(),
    description: z.string().min(1),
  }).optional(),
})
const projectAgentSchema = z.looseObject({
  id: z.string().min(1),
  role: z.string().min(1),
  departmentKey: z.string().optional(),
  position: z.number().optional(),
})

/**
 * Poll one project run until settlement.
 * @param repository - durable project store.
 * @param runId - started run identity.
 * @param timeoutMs - maximum wait for the real model and browser checks.
 * @returns the terminal project run.
 */
async function waitForTerminalRun(
  repository: OrchestrationRepository,
  runId: string,
  timeoutMs: number,
): Promise<ProjectRunRecord> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = repository.getProjectRun(runId)
    if (run !== undefined && run.status !== 'RUNNING') return run
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`project run "${runId}" did not settle within ${String(timeoutMs)} ms`)
}

/**
 * Wait until the launcher has released the project workflow lease.
 * @param repository - durable project store.
 * @param projectId - project whose lease must be free.
 * @param timeoutMs - maximum wait.
 * @returns a promise that resolves after the active run is released.
 */
async function waitForReleasedLease(
  repository: OrchestrationRepository,
  projectId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const lease = repository.getWorkflowLease(`workflow:${projectId}`)
    if (lease === undefined || lease.ownerId === undefined) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`workflow lease for "${projectId}" was not released`)
}

/**
 * Read one successful JSON response or include the server body in the failure.
 * @param response - fetch response.
 * @param expectedStatus - required HTTP status.
 * @returns parsed JSON.
 */
async function jsonResponse(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    throw new Error(`expected HTTP ${String(expectedStatus)}, got ${String(response.status)}: ${await response.text()}`)
  }
  return await response.json()
}

describe.skipIf(!hasKey)('M5.5 real seven-member Team workflow', { concurrent: false }, () => {
  it('freezes a published Team, runs seven real Agents, and repairs an injected failure', {
    timeout: 2_400_000,
  }, async () => {
    const runRoot = mkdtempSync(join(artifactRoot, 'real-team-'))
    const databasePath = join(runRoot, 'platform.sqlite')
    const workspaceRoot = join(runRoot, 'workspaces')
    const agentHomeRoot = join(runRoot, 'agent-homes')
    const serverRunRoot = join(runRoot, 'server-artifacts')
    mkdirSync(workspaceRoot, { recursive: true })
    mkdirSync(agentHomeRoot, { recursive: true })
    mkdirSync(serverRunRoot, { recursive: true })

    const errors: unknown[] = []
    const repository = new OrchestrationRepository(databasePath)
    let launcher: FutureCupRunLauncher | undefined
    let server: FutureCupServer | undefined
    const summary: Record<string, unknown> = {
      artifactRoot: runRoot,
      databasePath,
      status: 'STARTED',
    }

    try {
      const registry = new PersistentAgentRegistry(repository)
      const defaultTeamVersionId = await registry.ensureDefaultTeam()
      const cloned = await registry.cloneTeam(defaultTeamVersionId, {
        id: `team-m55-e2e-${randomUUID()}`,
        ownerId: 'future-cup-m55-e2e',
        name: `M5.5 Seven Agent Team ${randomUUID()}`,
        version: '1.0.0',
      })
      const published = await registry.publishTeamVersion(cloned.team.id, cloned.version.id)
      expect(published.members).toHaveLength(7)

      launcher = new FutureCupRunLauncher({
        store: repository,
        workspaceRoot,
        agentHomeRoot,
        harness: {
          provider: 'deepseek-official',
          model: 'deepseek-flash',
          requestTimeoutMs: 600_000,
        },
        verification: {
          buildTimeoutMs: 600_000,
          browserTimeoutMs: 90_000,
        },
        selfLoop: {
          maxRepairRounds: 3,
          repairTimeoutMs: 600_000,
        },
        maxAgentRetries: 1,
        leaseDurationMs: 60_000,
        heartbeatIntervalMs: 15_000,
        settlementRetryMs: 1_000,
        settlementWaitMs: 30_000,
        onError: error => errors.push(error),
      })
      server = createFutureCupServer({
        store: repository,
        agentRegistry: registry,
        currentUserId: 'future-cup-m55-e2e',
        defaultTeamVersionId: published.id,
        profiles: defaultAgentProfiles(),
        host: '127.0.0.1',
        port: 0,
        outboxPollMs: 20,
        outboxBatchSize: 20,
        outboxClaimMs: 1_000,
        runRoot: serverRunRoot,
        getLauncher: () => launcher,
        onError: error => errors.push(error),
      })
      const address = await server.start()
      const baseUrl = `http://127.0.0.1:${String(address.port)}`

      const created = projectResponseSchema.parse(await jsonResponse(await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: `project-m55-e2e-${randomUUID()}`,
          name: 'M5.5 Real Seven Agent Delivery',
          requirement: [
            'Build a polished responsive React, TypeScript, Vite, and Ant Design frontend.',
            'Include an overview dashboard and a users page with visible navigation between them.',
            'Use static local data only: no backend, forms, modals, notifications, or message bridges.',
          ].join(' '),
          teamVersionId: published.id,
        }),
      }), 201))
      const projectId = ProjectId(created.id)
      const binding = repository.getProjectTeamBinding(projectId)
      if (binding === undefined) throw new Error(`project "${projectId}" has no frozen Team binding`)
      const runtimeProfiles = agentProfilesFromTeamBinding(binding)
      const memberIds = binding.members.map(member => member.instanceId)
      expect(binding.teamVersion.id).toBe(published.id)
      expect(binding.members).toHaveLength(7)
      expect(runtimeProfiles).toHaveLength(7)
      expect(memberIds).toHaveLength(7)
      expect(new Set(memberIds).size).toBe(7)

      const projectedAgents = z.array(projectAgentSchema).parse(
        await jsonResponse(await fetch(`${baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/agents`), 200),
      )
      expect(projectedAgents.map(agent => agent.id).sort()).toEqual([...memberIds].sort())
      expect(projectedAgents.map(agent => agent.departmentKey ?? '').sort()).toEqual(
        binding.members.map(member => member.departmentKey).sort(),
      )

      const initialStart = runStartSchema.parse(await jsonResponse(await fetch(
        `${baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/runs`,
        { method: 'POST' },
      ), 202))
      const initialRun = await waitForTerminalRun(repository, initialStart.runId, 1_200_000)
      if (initialRun.status !== 'PASSED') {
        throw new Error(`initial real run ended ${initialRun.status}: ${JSON.stringify(repository.listVerificationReports(projectId))}`)
      }
      await waitForReleasedLease(repository, projectId, 30_000)

      const generationExecutions = repository.listExecutions(projectId)
      const initialExecutionIds = new Set(generationExecutions.map(execution => execution.id))
      const generationSessions = generationExecutions
        .flatMap(execution => execution.sessionId === undefined ? [] : [execution.sessionId])
      expect(generationSessions.length).toBeGreaterThanOrEqual(6)
      expect(new Set(generationSessions).size).toBe(generationSessions.length)

      const drillStart = drillStartSchema.parse(await jsonResponse(await fetch(
        `${baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/self-heal-drill`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'preset:typescript-contract' }),
        },
      ), 202))
      const drillRun = await waitForTerminalRun(repository, drillStart.runId, 1_200_000)
      if (drillRun.status !== 'PASSED') {
        throw new Error(`self-healing drill ended ${drillRun.status}: ${JSON.stringify(repository.listVerificationReports(projectId))}`)
      }
      await waitForReleasedLease(repository, projectId, 30_000)

      const finalExecutions = repository.listExecutions(projectId)
      const repairAgentIds = new Set(
        runtimeProfiles.filter(profile => profile.role === 'repair').map(profile => profile.id),
      )
      const repairExecutions = finalExecutions.filter(execution =>
        !initialExecutionIds.has(execution.id) && repairAgentIds.has(execution.agentId))
      const repairSessions = repairExecutions
        .flatMap(execution => execution.sessionId === undefined ? [] : [execution.sessionId])
      expect(repairSessions.length).toBeGreaterThan(0)
      expect(new Set(repairSessions).size).toBe(repairSessions.length)
      for (const sessionId of repairSessions) expect(generationSessions).not.toContain(sessionId)

      const verificationReports = repository.listVerificationReports(projectId)
      const verificationStatuses = verificationReports.map(report => report.status)
      expect(verificationStatuses[0]).toBe('FAIL')
      expect(verificationStatuses.at(-1)).toBe('PASS')
      expect(verificationStatuses.length).toBeLessThanOrEqual(4)
      const finalVerification = verificationReportDataSchema.parse(verificationReports.at(-1)?.report)
      const browserChecks = finalVerification.checks.filter(check => check.name.startsWith('browser:'))
      expect(browserChecks).toHaveLength(4)
      expect(browserChecks.every(check => check.status === 'PASS')).toBe(true)
      expect(finalVerification.screenshots).toHaveLength(4)
      const control = repository.getWorkflowControlState(projectId)
      expect(control?.snapshot.status).toBe('PASSED')
      const controlEvents = repository.listWorkflowControlEvents(projectId)
      const controlEventTypes = controlEvents.map(record => record.entry.type)
      expect(controlEventTypes).toEqual(expect.arrayContaining([
        'edge/selected',
        'loop/evaluated',
        'subworkflow/entered',
        'subworkflow/exited',
        'run/terminal',
      ]))
      expect(controlEvents.at(-1)?.entry).toMatchObject({
        type: 'run/terminal',
        status: 'PASSED',
      })

      const drillHomeRoot = join(agentHomeRoot, drillRun.ownerId)
      const runtimeHomeCount = readdirSync(drillHomeRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory()).length
      expect(runtimeHomeCount).toBe(7)

      summary.status = 'PASSED'
      summary.teamId = cloned.team.id
      summary.teamVersionId = published.id
      summary.projectId = projectId
      summary.memberIds = memberIds
      summary.projectAgentIds = projectedAgents.map(agent => agent.id)
      summary.initialRunId = initialRun.id
      summary.drillRunId = drillRun.id
      summary.generationSessions = generationSessions
      summary.repairSessions = repairSessions
      summary.verificationStatuses = verificationStatuses
      summary.browserChecks = browserChecks.map(check => ({ name: check.name, status: check.status }))
      summary.controlEventTypes = controlEventTypes
      summary.runtimeHomeCount = runtimeHomeCount
      expect(errors).toEqual([])
    } catch (error: unknown) {
      summary.status = 'FAILED'
      summary.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      writeFileSync(join(runRoot, 'run-result.json'), `${JSON.stringify(summary, null, 2)}\n`)
      await launcher?.close().catch((error: unknown) => errors.push(error))
      await server?.close().catch((error: unknown) => errors.push(error))
    }
  })
})
