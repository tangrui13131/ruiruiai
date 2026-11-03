import { Collapse, Descriptions, Tag } from 'antd'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { JsonViewer } from '../components/JsonViewer.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { SelfHealDrillButton } from '../components/SelfHealDrillModal.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { UnifiedDiffViewer } from '../components/UnifiedDiffViewer.tsx'
import type { RepairStrategyDecisionView } from '../api/contracts.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState, useProjectStore } from '../state/ProjectStoreContext.tsx'
import type { ProjectSnapshotView } from '../api/contracts.ts'
import type { Dictionary } from '../locale/types.ts'

/**
 * Render one immutable repair snapshot.
 * @param snapshot - project snapshot containing repairs and strategy decisions.
 * @returns repair history with strategy evidence and real diffs.
 */
export function RepairsView({
  snapshot,
  onLaunched,
}: {
  readonly snapshot: ProjectSnapshotView
  readonly onLaunched?: () => void
}) {
  const { dictionary } = useLocale()
  const repairs = [...snapshot.repairs].sort((left, right) => left.repairRound - right.repairRound)
  const strategies = new Map(snapshot.repairStrategies.map(value => [value.repairRound, value]))
  return (
    <div className="page-stack">
      <PageHeading
        title={dictionary.repairs.title}
        description={dictionary.repairs.description}
        actions={<SelfHealDrillButton projectId={snapshot.project.id} onLaunched={onLaunched} />}
      />
      {repairs.length === 0 ? <EmptyPanel text={dictionary.repairs.noRepairs} /> : (
        <Collapse
          defaultActiveKey={repairs.slice(0, 1).map(repair => repair.id)}
          items={repairs.map((repair) => {
            const strategy = strategies.get(repair.repairRound)
            return {
              key: repair.id,
              label: (
                <span className="page-heading-actions">
                  <strong>{dictionary.repairs.round.replace('{round}', String(repair.repairRound))}</strong>
                  <StatusBadge status={repair.afterStatus} />
                  <Tag>{repair.repairAgentId}</Tag>
                  {strategy === undefined ? null : <Tag color="blue">{strategy.strategyId}</Tag>}
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
                  {strategy === undefined ? null : (
                    <div>
                      <div className="agent-metric-label">{dictionary.repairs.strategy}</div>
                      <Descriptions size="small" bordered column={1}>
                        <Descriptions.Item label={dictionary.repairs.strategyReason}>
                          {strategyReason(strategy.decision, dictionary)}
                        </Descriptions.Item>
                      </Descriptions>
                      <JsonViewer value={strategy.decision} />
                      {strategy.outcome === undefined ? null : (
                        <>
                          <div className="agent-metric-label">
                            {dictionary.repairs.strategyOutcome}
                          </div>
                          <JsonViewer value={strategy.outcome} />
                        </>
                      )}
                    </div>
                  )}
                  <div>
                    <div className="agent-metric-label">{dictionary.repairs.diff}</div>
                    <UnifiedDiffViewer diff={repair.diff} ariaLabel={dictionary.repairs.diff} />
                  </div>
                </div>
              ),
            }
          })}
        />
      )}
    </div>
  )
}

/** Render bounded repair rounds from the active project store. */
export function RepairsPage() {
  const state = useProjectState()
  const store = useProjectStore()
  const snapshot = state.snapshot
  return snapshot === undefined ? null : (
    <RepairsView
      snapshot={snapshot}
      onLaunched={() => { void store.refresh() }}
    />
  )
}

/**
 * Render one localized strategy-selection explanation.
 * @param decision - structured adaptive repair decision.
 * @param dictionary - active locale dictionary.
 * @returns a localized first-selection, switch, or unavailable reason.
 */
export function strategyReason(
  decision: RepairStrategyDecisionView['decision'],
  dictionary: Dictionary,
): string {
  const strategy = decision.selectedStrategy?.id
  if (strategy === undefined) return dictionary.repairs.strategyUnavailable
  if (decision.swappedFromStrategyId !== undefined) {
    return dictionary.repairs.strategySwitched
      .replace('{previous}', decision.swappedFromStrategyId)
      .replace('{strategy}', strategy)
  }
  return dictionary.repairs.strategySelected
    .replace('{categories}', decision.inputSummary.categories.join(', '))
    .replace('{strategy}', strategy)
}
