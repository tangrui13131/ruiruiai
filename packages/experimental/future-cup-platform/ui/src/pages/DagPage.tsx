import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
} from '@xyflow/react'
import { Descriptions, Drawer, Space, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type {
  TaskView,
  WorkflowControlEventView,
  WorkflowControlStateView,
} from '../api/contracts.ts'
import { api } from '../api/client.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { JsonViewer } from '../components/JsonViewer.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { TaskNode } from '../components/TaskNode.tsx'
import { buildControlGraph } from '../graph/control-layout.ts'
import { buildDagGraph } from '../graph/dag-layout.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

const nodeTypes = { task: TaskNode }

function ControlCanvas({
  state,
  events,
}: {
  readonly state: WorkflowControlStateView
  readonly events: readonly WorkflowControlEventView[]
}) {
  const { dictionary } = useLocale()
  const graph = useMemo(() => buildControlGraph(state), [state])
  const activeCount = state.snapshot.activeNodes.length
  const recent = events.slice(-8).reverse()
  return (
    <section>
      <div className="section-panel-heading">
        <div>
          <h3>{dictionary.dag.workflowTitle}</h3>
          <p>{dictionary.dag.workflowDescription}</p>
        </div>
        <Space wrap>
          <Tag color={state.snapshot.status === 'PASSED' ? 'green' : 'blue'}>
            {state.snapshot.status}
          </Tag>
          <Tag>{dictionary.dag.active}: {activeCount}</Tag>
        </Space>
      </div>
      <div className="dag-frame">
        <ReactFlowProvider>
          <ReactFlow
            id="workflow-control-dag"
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            minZoom={0.3}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background color="#d6c8bc" gap={22} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div className="agent-metric-label" style={{ marginTop: 16 }}>
        {dictionary.dag.controlEvents}
      </div>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {recent.map(event => (
          <div key={event.seq}>
            <Tag>{String(event.seq)}</Tag>
            <code>{event.entry.type}</code>
            {event.entry.nodeId === undefined ? null : (
              <span style={{ marginLeft: 8 }}>{event.entry.nodeId}</span>
            )}
          </div>
        ))}
      </Space>
    </section>
  )
}

function DagCanvas({ tasks }: { readonly tasks: readonly TaskView[] }) {
  const { dictionary } = useLocale()
  const graph = useMemo(() => buildDagGraph(tasks), [tasks])
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [selected, setSelected] = useState<TaskView>()
  useEffect(() => { setNodes(graph.nodes) }, [graph.nodes, setNodes])
  if (tasks.length === 0) return <EmptyPanel text={dictionary.common.noData} />
  return (
    <>
      <div className="dag-frame">
        <ReactFlow
          id="task-dag"
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_event, node) => { setSelected(node.data.task) }}
          fitView
          minZoom={0.35}
          maxZoom={1.4}
        >
          <Background color="#d6c8bc" gap={22} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>
      <Drawer
        open={selected !== undefined}
        width={560}
        title={dictionary.dag.taskDetails}
        onClose={() => { setSelected(undefined) }}
      >
        {selected === undefined ? null : (
          <div className="page-stack">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={dictionary.dag.id}>{selected.id}</Descriptions.Item>
              <Descriptions.Item label={dictionary.overview.tasks}>{selected.title}</Descriptions.Item>
              <Descriptions.Item label={dictionary.dag.role}>{selected.role}</Descriptions.Item>
              <Descriptions.Item label={dictionary.dag.revision}>{selected.revision}</Descriptions.Item>
              <Descriptions.Item label={dictionary.dag.retries}>{selected.retryCount}</Descriptions.Item>
              <Descriptions.Item label={dictionary.dag.dependency}>
                {selected.dependencies.length === 0
                  ? dictionary.common.none
                  : selected.dependencies.map(value => <Tag key={value}>{value}</Tag>)}
              </Descriptions.Item>
              <Descriptions.Item label={dictionary.dag.writeScope}>
                {selected.writeScopes.map(value => <Tag key={value}>{value}</Tag>)}
              </Descriptions.Item>
            </Descriptions>
            <JsonViewer value={selected} />
          </div>
        )}
      </Drawer>
    </>
  )
}

/** Render durable task dependencies with React Flow. */
export function DagPage() {
  const { dictionary } = useLocale()
  const { projectId } = useParams()
  const snapshot = useProjectState().snapshot
  const [controlState, setControlState] = useState<WorkflowControlStateView>()
  const [controlEvents, setControlEvents] = useState<WorkflowControlEventView[]>([])
  useEffect(() => {
    if (projectId === undefined) return
    let current = true
    void Promise.all([
      api.getWorkflowControl(projectId),
      api.listWorkflowControlEvents(projectId),
    ]).then(([state, events]) => {
      if (!current) return
      setControlState(state)
      setControlEvents(events)
    }).catch(() => {
      if (!current) return
      setControlState(undefined)
      setControlEvents([])
    })
    return () => { current = false }
  }, [projectId, snapshot?.lastEventSeq])
  if (snapshot === undefined) return null
  return (
    <div className="page-stack">
      <PageHeading title={dictionary.dag.title} description={dictionary.dag.description} />
      <ReactFlowProvider>
        <DagCanvas tasks={snapshot.tasks} />
      </ReactFlowProvider>
      {controlState === undefined
        ? <EmptyPanel text={dictionary.dag.workflowEmpty} />
        : <ControlCanvas state={controlState} events={controlEvents} />}
    </div>
  )
}
