import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
} from '@xyflow/react'
import { Descriptions, Drawer, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { TaskView } from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { JsonViewer } from '../components/JsonViewer.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { TaskNode } from '../components/TaskNode.tsx'
import { buildDagGraph } from '../graph/dag-layout.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

const nodeTypes = { task: TaskNode }

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
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_event, node) => { setSelected(node.data.task) }}
          fitView
          minZoom={0.35}
          maxZoom={1.4}
        >
          <Background color="#cbd7d1" gap={22} size={1} />
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
  const snapshot = useProjectState().snapshot
  if (snapshot === undefined) return null
  return (
    <div className="page-stack">
      <PageHeading title={dictionary.dag.title} description={dictionary.dag.description} />
      <ReactFlowProvider>
        <DagCanvas tasks={snapshot.tasks} />
      </ReactFlowProvider>
    </div>
  )
}
