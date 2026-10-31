import { describe, expect, it } from 'vitest'
import {
  OrchestrationRepository,
  ProjectId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  publicProjectRun,
  publicProjectSnapshot,
  publicVerificationReport,
} from '../src/api-contracts.ts'

describe('public API projections', () => {
  it('removes private run paths and absolute screenshot paths', () => {
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    try {
      const projectId = ProjectId('project-public-contract')
      repository.createProject({
        id: projectId,
        name: 'Public contract',
        requirement: 'Sanitize private paths',
        createdAt: new Date().toISOString(),
      }, [])
      const run = repository.createProjectRun(
        projectId,
        'worker-a',
        1n,
        'D:/private/runs/run-a/workspace',
      )
      repository.finishProjectRun(
        run.id,
        'PASSED',
        'D:/private/runs/run-a/workspace/dist',
      )
      const report = repository.saveVerificationReport(projectId, 'PASS', {
        verifier: 'future-cup-m3',
        status: 'PASS',
        failureSignature: null,
        checks: [],
        findings: [],
        routes: ['/'],
        viewports: ['desktop'],
        screenshots: ['D:/private/runs/run-a/screenshots/desktop.png'],
      })

      const publicRun = publicProjectRun(repository.listProjectRuns(projectId)[0]!)
      expect(publicRun).toMatchObject({
        fencingToken: '1',
        hasWorkspace: true,
        hasPreview: true,
      })
      expect(JSON.stringify(publicRun)).not.toContain('D:/private')

      const publicReport = publicVerificationReport(report)
      expect(publicReport.report).toMatchObject({
        screenshots: ['desktop.png'],
      })

      const snapshot = repository.getProjectSnapshot(projectId, 0, 10)!
      expect(JSON.stringify(publicProjectSnapshot(snapshot))).not.toContain('D:/private')
    } finally {
      repository.close()
    }
  })
})
