import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { StatusBadge } from './StatusBadge.tsx'
import type { TaskNodeData } from '../graph/dag-layout.ts'

/** Render one durable DAG task with explicit status text. */
export function TaskNode({ data, selected }: NodeProps<Node<TaskNodeData>>) {
  return (
    <div className={`dag-node${selected === true ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="dag-node-title">{data.task.title}</div>
      <div className="dag-node-meta">
        <StatusBadge status={data.status} />
        <span>{data.task.assignedAgentId ?? data.task.role}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
