import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import type { SchedulerDecisionView } from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

type Candidate = SchedulerDecisionView['candidates'][number]

/** Explain every scheduling candidate and the selected Agent. */
export function SchedulerPage() {
  const { dictionary } = useLocale()
  const snapshot = useProjectState().snapshot
  const [selectedId, setSelectedId] = useState<string>()
  if (snapshot === undefined) return null
  const selected = snapshot.decisions.find(value => value.id === selectedId) ?? snapshot.decisions.at(-1)
  const columns: ColumnsType<Candidate> = [
    {
      title: dictionary.scheduler.candidate,
      dataIndex: 'agentId',
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: dictionary.scheduler.eligible,
      dataIndex: 'eligible',
      render: (value: boolean) => <StatusBadge status={value ? 'READY' : 'BLOCKED'} />,
    },
    {
      title: dictionary.scheduler.rejected,
      dataIndex: 'rejectionReason',
      render: (value: string | undefined) => value ?? dictionary.common.none,
    },
    { title: dictionary.scheduler.score, dataIndex: 'score', render: (value: number) => value.toFixed(4) },
    {
      title: dictionary.scheduler.capability,
      dataIndex: ['terms', 'capabilityContribution'],
      render: (value: number) => value.toFixed(4),
    },
    {
      title: dictionary.scheduler.success,
      dataIndex: ['terms', 'successContribution'],
      render: (value: number) => value.toFixed(4),
    },
    {
      title: dictionary.scheduler.availability,
      dataIndex: ['terms', 'availabilityContribution'],
      render: (value: number) => value.toFixed(4),
    },
    {
      title: dictionary.scheduler.priority,
      dataIndex: ['terms', 'priorityContribution'],
      render: (value: number) => value.toFixed(4),
    },
    {
      title: dictionary.scheduler.loadPenalty,
      dataIndex: ['terms', 'loadPenaltyContribution'],
      render: (value: number) => value.toFixed(4),
    },
  ]
  return (
    <div className="page-stack">
      <PageHeading title={dictionary.scheduler.title} description={dictionary.scheduler.description} />
      {snapshot.decisions.length === 0 ? <EmptyPanel text={dictionary.common.noData} /> : (
        <div className="scheduler-layout">
          <div className="decision-list">
            {snapshot.decisions.map(decision => (
              <button
                className="decision-button"
                type="button"
                key={decision.id}
                aria-pressed={decision.id === selected?.id}
                onClick={() => { setSelectedId(decision.id) }}
              >
                <div className="decision-title">{decision.taskId}</div>
                <div className="decision-meta">
                  {dictionary.scheduler.selected}: {decision.selectedAgentId}
                </div>
                <div className="decision-meta">{new Date(decision.createdAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
          <section className="section-panel">
            {selected === undefined ? <EmptyPanel text={dictionary.common.noData} /> : (
              <div className="page-stack">
                <div className="section-panel-heading">
                  <h3>{selected.taskId}</h3>
                  <Tag color="cyan">{selected.selectedAgentId}</Tag>
                </div>
                <div>
                  <div className="agent-metric-label">{dictionary.scheduler.reason}</div>
                  <p>{selected.selectedReason}</p>
                  {selected.reassignReason === undefined ? null : (
                    <>
                      <div className="agent-metric-label">{dictionary.scheduler.reassign}</div>
                      <p>{selected.reassignReason}</p>
                    </>
                  )}
                </div>
                <Table
                  rowKey="agentId"
                  size="small"
                  pagination={false}
                  scroll={{ x: 860 }}
                  columns={columns}
                  dataSource={[...selected.candidates]}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
