import type { AgentView, ProjectSnapshotView, TaskView } from '../src/api/contracts.ts'

export function agent(
  id: string,
  currentLoad = 0,
  historicalSuccessRate = 0.75,
  historicalSuccessCount = 0,
  historicalExecutionCount = 0,
): AgentView {
  return {
    id,
    name: id,
    role: 'frontend',
    capabilities: { frontend: 1 },
    maxConcurrency: 1,
    currentLoad,
    historicalSuccessRate,
    historicalSuccessCount,
    historicalExecutionCount,
    available: currentLoad < 1,
  }
}

export function task(
  id: string,
  dependencies: string[] = [],
  status: TaskView['status'] = 'PENDING',
): TaskView {
  return {
    id,
    projectId: 'project-test',
    title: id,
    description: `${id} description`,
    role: id === 'integration' ? 'integration' : 'frontend',
    priority: 50,
    dependencies,
    requiredCapabilities: { frontend: 1 },
    writeScopes: ['src/'],
    status,
    revision: 1,
    retryCount: 0,
    excludedAgentIds: [],
    createdAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
  }
}

export function snapshot(tasks: readonly TaskView[] = []): ProjectSnapshotView {
  return {
    project: {
      id: 'project-test',
      name: 'Test project',
      requirement: 'Build a dashboard',
      createdAt: '2026-10-31T10:00:00.000Z',
      lastEventSeq: 0,
    },
    tasks: [...tasks],
    decisions: [],
    executions: [],
    verificationReports: [],
    repairs: [],
    repairStrategies: [],
    runs: [],
    events: [],
    lastEventSeq: 0,
  }
}
