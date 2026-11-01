import { describe, expect, it } from 'vitest'
import { workflowControlStateSchema } from '../src/api/contracts.ts'
import { buildControlGraph } from '../src/graph/control-layout.ts'

const state = workflowControlStateSchema.parse({
  projectId: 'project-control',
  definitionId: 'workflow-control',
  definitionVersion: 1,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  snapshot: {
    snapshotVersion: 1,
    revision: 2,
    status: 'RUNNING',
    definition: {
      version: 1,
      id: 'workflow-control',
      label: 'Control',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'verify',
        nodes: [
          { id: 'verify', label: 'Verify', type: 'TASK', taskRef: 'verification' },
          { id: 'repair-loop', label: 'Repair loop', type: 'LOOP' },
          { id: 'delivery', label: 'Delivery', type: 'TASK', taskRef: 'delivery' },
        ],
        edges: [
          {
            id: 'verify-to-loop',
            from: 'verify',
            to: 'repair-loop',
            condition: { kind: 'VERIFICATION_STATUS', status: 'FAIL' },
          },
          {
            id: 'loop-to-verify',
            from: 'repair-loop',
            to: 'verify',
            condition: { kind: 'LOOP_RESULT', result: 'CONTINUE' },
          },
        ],
      }],
    },
    activeNodes: [{
      instanceId: 'verify@1',
      graphId: 'main',
      nodeId: 'verify',
      taskRef: 'verification',
      expectedResult: 'VERIFICATION',
    }],
    loopStates: [],
    journal: [{
      seq: 1,
      type: 'node/completed',
      graphId: 'main',
      nodeId: 'delivery',
    }],
  },
})

describe('control graph layout', () => {
  it('projects active, completed, conditional, and loop state into React Flow', () => {
    const graph = buildControlGraph(state)
    expect(graph.nodes.map(node => node.id)).toEqual([
      'main:verify',
      'main:repair-loop',
      'main:delivery',
    ])
    expect(graph.nodes.find(node => node.id === 'main:verify')?.style).toMatchObject({
      background: '#e6f4ff',
    })
    expect(graph.nodes.find(node => node.id === 'main:delivery')?.style).toMatchObject({
      background: '#e8f5e9',
    })
    expect(graph.edges.map(edge => edge.label)).toContain('FAIL')
    expect(graph.edges.find(edge => edge.id === 'main:loop-to-verify')?.style)
      .toMatchObject({ stroke: '#7c3aed' })
  })
})
