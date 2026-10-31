import { describe, expect, it } from 'vitest'
import { buildDagGraph } from '../src/graph/dag-layout.ts'
import { task } from './fixtures.ts'

describe('buildDagGraph', () => {
  it('lays out dependency depth and creates stable edges', () => {
    const graph = buildDagGraph([
      task('design'),
      task('dashboard', ['design']),
      task('users', ['design']),
      task('integration', ['dashboard', 'users']),
    ])
    const positions = Object.fromEntries(graph.nodes.map(node => [node.id, node.position]))
    expect(positions.design?.y).toBe(0)
    expect(positions.dashboard?.y).toBe(160)
    expect(positions.users?.y).toBe(160)
    expect(positions.integration?.y).toBe(320)
    expect(graph.edges.map(edge => edge.id)).toEqual([
      'design->dashboard',
      'design->users',
      'dashboard->integration',
      'users->integration',
    ])
  })
})
