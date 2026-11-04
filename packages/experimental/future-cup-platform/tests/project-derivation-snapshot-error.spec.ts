import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OrchestrationRepository,
  PersistentAgentRegistry,
  ProjectId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { ProjectDerivationService } from '../src/project-derivation.ts'

vi.mock('../src/delivery-snapshot.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/delivery-snapshot.ts')>()
  return {
    ...actual,
    saveDeliverySnapshot: vi.fn(async () => {
      throw Object.freeze({ reason: 'snapshot service failed' })
    }),
  }
})

const roots: string[] = []
const repositories: OrchestrationRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ProjectDerivationService snapshot failures', () => {
  it('uses a stable message when snapshot creation throws a non-Error value', async () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-derivation-snapshot-error-'))
    roots.push(root)
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    repositories.push(repository)
    const registry = new PersistentAgentRegistry(repository)
    const sourceId = ProjectId('source-snapshot-error')
    const source = {
      id: sourceId,
      name: 'Source',
      requirement: 'Build a page.',
      createdAt: '2026-11-04T00:00:00.000Z',
    }
    repository.createProject(
      source,
      [],
      undefined,
      await registry.freezeProject(sourceId, await registry.ensureDefaultTeam()),
    )
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'App.tsx'), 'export const App = () => null\n')
    const run = repository.createProjectRun(sourceId, 'source-worker', 1n, workspace)
    repository.finishProjectRun(run.id, 'PASSED')

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: sourceId,
      targetProjectId: ProjectId('target-snapshot-error'),
      name: 'Target',
      mode: 'UPGRADE',
      changeRequest: 'Upgrade it.',
    })).rejects.toMatchObject({
      code: 'SOURCE_SNAPSHOT_UNAVAILABLE',
      message: 'Could not create the source snapshot',
    })
  })
})
