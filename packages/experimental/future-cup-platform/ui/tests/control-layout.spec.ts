import { describe, expect, it } from 'vitest'
import { workflowControlStateSchema } from '../src/api/contracts.ts'
import { buildControlGraph, controlEdgeTitle, controlNodeTitle } from '../src/graph/control-layout.ts'
import { localeDictionaries } from '../src/locale/types.ts'

const dictionary = localeDictionaries['zh-CN']

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
    const graph = buildControlGraph(state, dictionary)
    expect(graph.nodes.map(node => node.id)).toEqual([
      'main:verify',
      'main:repair-loop',
      'main:delivery',
    ])
    expect(graph.nodes.find(node => node.id === 'main:verify')?.style).toMatchObject({
      background: '#e8f0fa',
    })
    expect(graph.nodes.find(node => node.id === 'main:delivery')?.style).toMatchObject({
      background: '#e3ede2',
    })
    expect(graph.edges.map(edge => edge.label)).toContain('失败')
    expect(graph.edges.find(edge => edge.id === 'main:loop-to-verify')?.style)
      .toMatchObject({ stroke: '#d97706' })
  })

  it('localizes shipped node labels and structural kinds, falling back to raw text', () => {
    expect(controlNodeTitle(dictionary, { label: 'Start verification', type: 'SEQUENCE' }))
      .toBe('开始验证\n序列')
    expect(controlNodeTitle(dictionary, { label: 'Repair completed', type: 'TERMINAL' }))
      .toBe('修复完成\n终止')
    expect(controlNodeTitle(dictionary, { label: 'Verify', type: 'TASK' }))
      .toBe('Verify\n任务')
    expect(controlNodeTitle(dictionary, { label: 'Future node', type: 'FUTURE_KIND' }))
      .toBe('Future node\nFUTURE_KIND')
  })

  it('localizes edge condition values from current and older definition versions', () => {
    expect(controlEdgeTitle(dictionary, 'PASS')).toBe('已通过')
    expect(controlEdgeTitle(dictionary, 'FAIL')).toBe('失败')
    expect(controlEdgeTitle(dictionary, 'COMPLETED')).toBe('已完成')
    expect(controlEdgeTitle(dictionary, 'CONTINUE')).toBe('继续')
    expect(controlEdgeTitle(dictionary, 'EXHAUSTED')).toBe('轮次耗尽')
    expect(controlEdgeTitle(dictionary, 'FUTURE_STATUS')).toBe('FUTURE_STATUS')
  })
})
