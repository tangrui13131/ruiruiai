import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { WorkflowControlStateView } from '../api/contracts.ts'

/** Build the read-only React Flow projection for one durable workflow-control snapshot. */
export function buildControlGraph(state: WorkflowControlStateView): {
  readonly nodes: Node[]
  readonly edges: Edge[]
} {
  const completed = new Set(state.snapshot.journal
    .filter(entry => entry.type === 'node/completed')
    .map(entry => `${entry.graphId ?? ''}:${entry.nodeId ?? ''}`))
  const active = new Set(state.snapshot.activeNodes
    .map(node => `${node.graphId}:${node.nodeId}`))
  const nodes: Node[] = []
  const edges: Edge[] = []
  for (const [graphIndex, controlGraph] of state.snapshot.definition.graphs.entries()) {
    for (const [nodeIndex, node] of controlGraph.nodes.entries()) {
      const id = `${controlGraph.id}:${node.id}`
      const isActive = active.has(id)
      const isComplete = completed.has(id)
      nodes.push({
        id,
        position: {
          x: (nodeIndex % 4) * 230,
          y: graphIndex * 260 + Math.floor(nodeIndex / 4) * 130,
        },
        data: { label: `${node.label}\n${node.type}` },
        style: {
          width: 190,
          border: isActive ? '2px solid #1677ff' : '1px solid #9eb2aa',
          borderRadius: 8,
          background: isActive ? '#e6f4ff' : isComplete ? '#e8f5e9' : '#ffffff',
          whiteSpace: 'pre-line',
          fontSize: 12,
        },
      })
    }
    for (const edge of controlGraph.edges) {
      edges.push({
        id: `${controlGraph.id}:${edge.id}`,
        source: `${controlGraph.id}:${edge.from}`,
        target: `${controlGraph.id}:${edge.to}`,
        label: edge.condition.kind === 'ALWAYS'
          ? undefined
          : edge.condition.status ?? edge.condition.result,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: edge.condition.kind === 'LOOP_RESULT' ? '#7c3aed' : '#60786d' },
      })
    }
  }
  return { nodes, edges }
}
