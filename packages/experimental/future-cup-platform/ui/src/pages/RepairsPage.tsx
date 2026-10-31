import { Collapse, Descriptions, Tag } from 'antd'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { UnifiedDiffViewer } from '../components/UnifiedDiffViewer.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

/** Render bounded repair rounds, before/after states, summaries, and real diffs. */
export function RepairsPage() {
  const { dictionary } = useLocale()
  const snapshot = useProjectState().snapshot
  if (snapshot === undefined) return null
  const repairs = [...snapshot.repairs].sort((left, right) => left.repairRound - right.repairRound)
  return (
    <div className="page-stack">
      <PageHeading title={dictionary.repairs.title} description={dictionary.repairs.description} />
      {repairs.length === 0 ? <EmptyPanel text={dictionary.repairs.noRepairs} /> : (
        <Collapse
          defaultActiveKey={repairs[0]?.id === undefined ? [] : [repairs[0].id]}
          items={repairs.map(repair => ({
            key: repair.id,
            label: (
              <span className="page-heading-actions">
                <strong>{dictionary.repairs.round.replace('{round}', String(repair.repairRound))}</strong>
                <StatusBadge status={repair.afterStatus} />
                <Tag>{repair.repairAgentId}</Tag>
              </span>
            ),
            children: (
              <div className="page-stack">
                <Descriptions size="small" bordered column={1}>
                  <Descriptions.Item label={dictionary.repairs.before}>
                    <StatusBadge status={repair.beforeStatus} />
                  </Descriptions.Item>
                  <Descriptions.Item label={dictionary.repairs.after}>
                    <StatusBadge status={repair.afterStatus} />
                  </Descriptions.Item>
                  <Descriptions.Item label={dictionary.repairs.error}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{repair.errorSummary}</pre>
                  </Descriptions.Item>
                  <Descriptions.Item label={dictionary.repairs.change}>
                    {repair.changeSummary}
                  </Descriptions.Item>
                  <Descriptions.Item label={dictionary.verification.signature}>
                    <code>{repair.failureSignature}</code>
                  </Descriptions.Item>
                </Descriptions>
                <div>
                  <div className="agent-metric-label">{dictionary.repairs.diff}</div>
                  <UnifiedDiffViewer diff={repair.diff} ariaLabel={dictionary.repairs.diff} />
                </div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  )
}
