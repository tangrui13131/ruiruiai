import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import type { SchedulerDecisionView } from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import type { Dictionary } from '../locale/types.ts'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

type Candidate = SchedulerDecisionView['candidates'][number]

const roleReasonPrefix = 'highest weighted score for role '
const retryReasonPrefix = 'highest weighted score for reassignment of retry '
const failureReasonPrefix = 'previous attempt failed with '
const capabilitiesRejectionPrefix = 'missing required capabilities: '

/**
 * Render one localized selection reason.
 * @param dictionary - active locale dictionary.
 * @param reason - raw selection reason emitted by the scheduler.
 * @returns a localized retry or role reason; unknown text falls back to the raw reason.
 */
export function schedulerReason(dictionary: Dictionary, reason: string): string {
  if (reason.startsWith(retryReasonPrefix)) {
    return dictionary.scheduler.reasonRetry.replace('{retry}', reason.slice(retryReasonPrefix.length))
  }
  if (reason.startsWith(roleReasonPrefix)) {
    const roles = dictionary.teamBuilder.roles
    const role = reason.slice(roleReasonPrefix.length)
    const label = role in roles ? roles[role as keyof typeof roles] : role
    return dictionary.scheduler.reasonRole.replace('{role}', label)
  }
  return reason
}

/**
 * Render one localized reassignment reason.
 * @param dictionary - active locale dictionary.
 * @param reason - raw reassignment reason emitted by the scheduler.
 * @returns a localized failure reason; unknown text falls back to the raw reason.
 */
export function schedulerReassignReason(dictionary: Dictionary, reason: string): string {
  if (!reason.startsWith(failureReasonPrefix)) return reason
  return dictionary.scheduler.reasonFailure.replace('{code}', reason.slice(failureReasonPrefix.length))
}

/**
 * Render one localized candidate rejection reason.
 * @param dictionary - active locale dictionary.
 * @param reason - raw rejection reason emitted by the scheduler.
 * @returns a localized rejection reason; unknown text falls back to the raw reason.
 */
export function schedulerRejectionReason(dictionary: Dictionary, reason: string): string {
  if (reason === 'excluded after the previous failed assignment') return dictionary.scheduler.rejectedExcluded
  if (reason === 'Agent is unavailable') return dictionary.scheduler.rejectedUnavailable
  if (reason === 'Agent is at concurrency capacity') return dictionary.scheduler.rejectedConcurrency
  if (reason.startsWith(capabilitiesRejectionPrefix)) {
    return dictionary.scheduler.rejectedCapabilities
      .replace('{capabilities}', reason.slice(capabilitiesRejectionPrefix.length))
  }
  return reason
}

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
      render: (value: string | undefined) => value === undefined
        ? dictionary.common.none
        : schedulerRejectionReason(dictionary, value),
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
                  <Tag>{selected.selectedAgentId}</Tag>
                </div>
                <div>
                  <div className="agent-metric-label">{dictionary.scheduler.reason}</div>
                  <p>{schedulerReason(dictionary, selected.selectedReason)}</p>
                  {selected.reassignReason === undefined ? null : (
                    <>
                      <div className="agent-metric-label">{dictionary.scheduler.reassign}</div>
                      <p>{schedulerReassignReason(dictionary, selected.reassignReason)}</p>
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
