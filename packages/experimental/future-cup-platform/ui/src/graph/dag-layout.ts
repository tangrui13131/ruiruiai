import { MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import type { TaskStatus, TaskView } from '../api/contracts.ts'

export interface TaskNodeData extends Record<string, unknown> {
  readonly task: TaskView
  readonly label: string
  readonly status: TaskStatus
}

export interface DagGraph {
  readonly nodes: Node<TaskNodeData>[]
  readonly edges: Edge[]
}

/** Lay out a task DAG by dependency depth using stable task ids for horizontal order. */
export function buildDagGraph(tasks: readonly TaskView[]): DagGraph {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const levels = new Map<string, number>()
  const visiting = new Set<string>()

  function level(taskId: string): number {
    const known = levels.get(taskId)
    if (known !== undefined) return known
    if (visiting.has(taskId)) return 0
    visiting.add(taskId)
    const task = byId.get(taskId)
    const value = task === undefined || task.dependencies.length === 0
      ? 0
      : Math.max(...task.dependencies.map(dependency => level(dependency) + 1))
    visiting.delete(taskId)
    levels.set(taskId, value)
    return value
  }

  const groups = new Map<number, TaskView[]>()
  for (const task of tasks) {
    const depth = level(task.id)
    groups.set(depth, [...groups.get(depth) ?? [], task])
  }
  const nodes = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([depth, group]) => group
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((task, index): Node<TaskNodeData> => ({
        id: task.id,
        type: 'task',
        position: { x: index * 250, y: depth * 160 },
        data: { task, label: task.title, status: task.status },
      })))
  const edges = tasks.flatMap(task => task.dependencies.map((dependency): Edge => ({
    id: `${dependency}->${task.id}`,
    source: dependency,
    target: task.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#7a8d84', strokeWidth: 1.5 },
  })))
  return { nodes, edges }
}
