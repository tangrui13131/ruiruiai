import { describe, expect, it } from 'vitest'
import { ProjectId } from '../src/brand.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { WorkflowControlCoordinator } from '../src/workflow-control-coordinator.ts'

const NOW = () => new Date('2026-11-01T08:00:00.000Z')

function setupProject(projectId: ProjectId): OrchestrationRepository {
  const repository = new OrchestrationRepository(':memory:', {
    now: NOW,
    journalMode: 'delete',
  })
  repository.createProject({
    id: projectId,
    name: 'Workflow control',
    requirement: 'Verify and repair',
    createdAt: NOW().toISOString(),
  }, [])
  return repository
}

describe('WorkflowControlCoordinator', () => {
  it('persists a PASS branch and delivery completion', async () => {
    const projectId = ProjectId('project-control-pass')
    const repository = setupProject(projectId)
    try {
      const coordinator = new WorkflowControlCoordinator(repository, undefined, NOW)
      let state = await coordinator.start(projectId)
      expect(state.activeNodes[0]?.taskRef).toBe('verification')
      state = await coordinator.advance(projectId, {
        type: 'VERIFICATION_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        status: 'PASS',
      })
      expect(state.activeNodes[0]?.taskRef).toBe('delivery')
      state = await coordinator.advance(projectId, {
        type: 'TASK_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        summary: 'Delivery accepted',
      })
      expect(state.status).toBe('PASSED')
      expect((await coordinator.events(projectId)).some(event => event.entry.type === 'edge/selected'))
        .toBe(true)
      expect((await coordinator.get(projectId))?.snapshot).toEqual(state)
    } finally {
      repository.close()
    }
  })

  it('enters repair, returns to verification, and escalates repeated failure', async () => {
    const projectId = ProjectId('project-control-repeat')
    const repository = setupProject(projectId)
    try {
      const coordinator = new WorkflowControlCoordinator(repository, undefined, NOW)
      let state = await coordinator.start(projectId)
      state = await coordinator.advance(projectId, {
        type: 'VERIFICATION_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        status: 'FAIL',
        failureSignature: 'same-failure',
      })
      expect(state.activeNodes[0]?.taskRef).toBe('repair')
      expect(state.frames.at(-1)?.graphId).toBe('repair')
      state = await coordinator.advance(projectId, {
        type: 'TASK_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        summary: 'Repair attempted',
      })
      expect(state.activeNodes[0]?.taskRef).toBe('verification')
      state = await coordinator.advance(projectId, {
        type: 'VERIFICATION_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        status: 'FAIL',
        failureSignature: 'same-failure',
      })
      expect(state.status).toBe('ESCALATED')
      expect(state.escalationReason).toBe('REPEATED_FAILURE')

      const resumed = new WorkflowControlCoordinator(repository, undefined, NOW)
      expect((await resumed.get(projectId))?.snapshot).toEqual(state)
    } finally {
      repository.close()
    }
  })

  it('persists explicit runtime escalation for incomplete verification', async () => {
    const projectId = ProjectId('project-control-incomplete')
    const repository = setupProject(projectId)
    try {
      const coordinator = new WorkflowControlCoordinator(repository, undefined, NOW)
      let state = await coordinator.start(projectId)
      state = await coordinator.advance(projectId, {
        type: 'VERIFICATION_COMPLETED',
        instanceId: state.activeNodes[0]!.instanceId,
        status: 'INCOMPLETE',
      })
      expect(state.activeNodes[0]?.taskRef).toBe('repair')
      state = await coordinator.escalate(projectId, 'VERIFIER_INCOMPLETE')
      expect(state.status).toBe('ESCALATED')
      expect(state.escalationReason).toBe('VERIFIER_INCOMPLETE')
    } finally {
      repository.close()
    }
  })
})
