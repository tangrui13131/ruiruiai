import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { WorkflowControlStateView } from '../api/contracts.ts'
import type { Dictionary } from '../locale/types.ts'

type ControlNodeTypes = Dictionary['dag']['controlNodeTypes']
type ControlNodeLabels = Dictionary['dag']['controlNodeLabels']
type ControlEdgeLabels = Dictionary['dag']['controlEdgeLabels']

/** Definition node type → dictionary key in `dag.controlNodeTypes`. */
const controlNodeTypeKeys: Record<string, keyof ControlNodeTypes> = {
  TASK: 'task',
  SEQUENCE: 'sequence',
  PARALLEL: 'parallel',
  CONDITION: 'condition',
  LOOP: 'loop',
  SUBWORKFLOW: 'subworkflow',
  TERMINAL: 'terminal',
}

/** Shipped definition node label → dictionary key in `dag.controlNodeLabels`. */
const controlNodeLabelKeys: Record<string, keyof ControlNodeLabels> = {
  'Start verification': 'startVerification',
  'Run independent verification': 'runIndependentVerification',
  'Choose verification outcome': 'chooseVerificationOutcome',
  'Bound automatic repair': 'boundAutomaticRepair',
  'Enter repair subworkflow': 'enterRepairSubworkflow',
  'Prepare delivery': 'prepareDelivery',
  'Workflow passed': 'workflowPassed',
  'Workflow escalated': 'workflowEscalated',
  'Run repair Agent': 'runRepairAgent',
  'Repair completed': 'repairCompleted',
}

/** Edge condition value → dictionary key in `dag.controlEdgeLabels`; includes
 * values recorded by older definition versions still replayed from storage. */
const controlEdgeLabelKeys: Record<string, keyof ControlEdgeLabels> = {
  PASS: 'pass',
  FAIL: 'fail',
  INCOMPLETE: 'incomplete',
  COMPLETED: 'completed',
  CONTINUE: 'continue',
  EXHAUSTED: 'exhausted',
}

/**
 * Render one localized control node title with its structural kind.
 * @param dictionary - active locale dictionary.
 * @param node - label and type from the durable workflow definition.
 * @returns two lines: localized label over localized kind; unknown values fall back to raw text.
 */
export function controlNodeTitle(
  dictionary: Dictionary,
  node: { readonly label: string; readonly type: string },
): string {
  const typeKey: keyof ControlNodeTypes | undefined = controlNodeTypeKeys[node.type]
  const labelKey: keyof ControlNodeLabels | undefined = controlNodeLabelKeys[node.label]
  const label = labelKey === undefined ? node.label : dictionary.dag.controlNodeLabels[labelKey]
  const type = typeKey === undefined ? node.type : dictionary.dag.controlNodeTypes[typeKey]
  return `${label}\n${type}`
}

/**
 * Render one localized control edge label.
 * @param dictionary - active locale dictionary.
 * @param value - raw condition status or result from the durable definition.
 * @returns localized label; unknown values fall back to the raw text.
 */
export function controlEdgeTitle(dictionary: Dictionary, value: string): string {
  const key: keyof ControlEdgeLabels | undefined = controlEdgeLabelKeys[value]
  return key === undefined ? value : dictionary.dag.controlEdgeLabels[key]
}

/** Build the read-only React Flow projection for one durable workflow-control snapshot. */
export function buildControlGraph(
  state: WorkflowControlStateView,
  dictionary: Dictionary,
): {
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
        data: { label: controlNodeTitle(dictionary, node) },
        style: {
          width: 190,
          border: isActive ? '2px solid #3b6a9c' : '1px solid #d9d7cf',
          borderRadius: 10,
          background: isActive ? '#e8f0fa' : isComplete ? '#e3ede2' : '#f9f7ee',
          color: '#1c1d1f',
          whiteSpace: 'pre-line',
          fontSize: 12,
        },
      })
    }
    for (const edge of controlGraph.edges) {
      const conditionValue = edge.condition.kind === 'ALWAYS'
        ? undefined
        : edge.condition.status ?? edge.condition.result
      edges.push({
        id: `${controlGraph.id}:${edge.id}`,
        source: `${controlGraph.id}:${edge.from}`,
        target: `${controlGraph.id}:${edge.to}`,
        label: conditionValue === undefined ? undefined : controlEdgeTitle(dictionary, conditionValue),
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: edge.condition.kind === 'LOOP_RESULT' ? '#d97706' : '#8e9096' },
      })
    }
  }
  return { nodes, edges }
}
