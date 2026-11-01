import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Alert, Progress, Tag } from 'antd'
import type { TeamRecommendationPlanView } from '../api/contracts.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import {
  format,
  memoryAccessLabel,
  memoryKindLabel,
  riskLabel,
  roleLabel,
} from '../team/recommendation-labels.ts'

type Recommendation = NonNullable<TeamRecommendationPlanView['recommendation']>

/** Render the complete, inspectable recommendation produced by the server. */
export function TeamRecommendationDetails({
  recommendation,
}: {
  readonly recommendation: Recommendation
}) {
  const { dictionary } = useLocale()
  const coveredCount = recommendation.capabilityCoverage
    .filter(coverage => coverage.satisfied)
    .length

  return (
    <div className="page-stack">
      <section>
        <div className="section-panel-heading">
          <h3>{dictionary.teamBuilder.summaryTitle}</h3>
          {recommendation.sourceTemplate === undefined ? null : (
            <Tag color="cyan">
              {format(dictionary.teamBuilder.sourceTemplate, {
                name: recommendation.sourceTemplate.name,
                version: recommendation.sourceTemplate.version,
              })}
            </Tag>
          )}
        </div>
        <div className="metric-strip">
          <div className="metric-cell">
            <div className="metric-cell-label">{dictionary.teamBuilder.instances}</div>
            <div className="metric-cell-value">
              {recommendation.concurrency.instanceCount}
            </div>
          </div>
          <div className="metric-cell">
            <div className="metric-cell-label">{dictionary.teamBuilder.concurrency}</div>
            <div className="metric-cell-value">
              {recommendation.concurrency.estimatedParallelism}
              <span className="team-metric-suffix">
                / {recommendation.concurrency.aggregateCapacity}
              </span>
            </div>
          </div>
          <div className="metric-cell">
            <div className="metric-cell-label">{dictionary.teamBuilder.capabilities}</div>
            <div className="metric-cell-value">
              {coveredCount} / {recommendation.capabilityCoverage.length}
            </div>
          </div>
          <div className="metric-cell">
            <div className="metric-cell-label">{dictionary.teamBuilder.tools}</div>
            <div className="metric-cell-value">
              {recommendation.toolPolicy.allowedTools.length}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-panel-heading">
          <h3>
            <TeamOutlined />
            {dictionary.teamBuilder.members}
          </h3>
          <Tag>{recommendation.members.length}</Tag>
        </div>
        <div className="team-member-list">
          {recommendation.members.map(member => (
            <article className="team-member-row" key={member.agentVersionId}>
              <div className="team-member-heading">
                <div className="team-member-title">
                  <span className="team-member-role">
                    {roleLabel(dictionary, member.role)}
                  </span>
                  <span className="team-member-name">{member.name}</span>
                  <span className="team-member-version">
                    {member.definitionId}@{member.definitionVersion}
                  </span>
                </div>
                <Tag color="geekblue">
                  {format(dictionary.teamBuilder.memberInstances, {
                    count: String(member.instanceCount),
                  })}
                </Tag>
              </div>
              <div className="team-member-grid">
                <div>
                  <div className="agent-metric-label">{dictionary.teamBuilder.concurrency}</div>
                  <div className="team-member-value">
                    {format(dictionary.teamBuilder.memberCapacity, {
                      count: String(member.maxConcurrency),
                    })}
                  </div>
                </div>
                <div>
                  <div className="agent-metric-label">{dictionary.teamBuilder.memberTools}</div>
                  <div className="team-tag-line">
                    {member.toolAllowlist.length === 0
                      ? <span>{dictionary.teamBuilder.noTools}</span>
                      : member.toolAllowlist.map(tool => <Tag key={tool}>{tool}</Tag>)}
                  </div>
                </div>
                <div>
                  <div className="agent-metric-label">{dictionary.teamBuilder.memberMemory}</div>
                  <div className="team-tag-line">
                    <Tag icon={<DatabaseOutlined />}>
                      {memoryAccessLabel(dictionary, member.memoryPolicy.access)}
                    </Tag>
                    {member.memoryPolicy.kinds.map(kind => (
                      <Tag key={kind}>{memoryKindLabel(dictionary, kind)}</Tag>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="agent-metric-label">{dictionary.teamBuilder.capabilities}</div>
                  <div className="team-tag-line">
                    {Object.entries(member.capabilities).map(([capability, value]) => (
                      <Tag key={capability}>{capability} {value}</Tag>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-panel-heading">
          <h3>
            <SafetyCertificateOutlined />
            {dictionary.teamBuilder.capabilities}
          </h3>
        </div>
        <div className="team-coverage-list">
          {recommendation.capabilityCoverage.map((coverage) => {
            const percent = Math.min(
              100,
              Math.round((coverage.covered / Math.max(1, coverage.required)) * 100),
            )
            return (
              <div className="team-coverage-row" key={coverage.capability}>
                <div className="team-coverage-heading">
                  <span>
                    {coverage.satisfied
                      ? <CheckCircleOutlined className="team-status-good" />
                      : <CloseCircleOutlined className="team-status-bad" />}
                    {format(
                      coverage.satisfied
                        ? dictionary.teamBuilder.capabilityCovered
                        : dictionary.teamBuilder.capabilityGap,
                      { capability: coverage.capability },
                    )}
                  </span>
                  <span className="team-coverage-value">
                    {coverage.covered} / {coverage.required}
                  </span>
                </div>
                <Progress
                  percent={percent}
                  showInfo={false}
                  size="small"
                  strokeColor={coverage.satisfied ? '#0f766e' : '#dc2626'}
                />
              </div>
            )
          })}
        </div>
      </section>

      {recommendation.missingCapabilities.length === 0 ? null : (
        <Alert
          type="error"
          showIcon
          title={dictionary.teamBuilder.missingCapabilities}
          description={recommendation.missingCapabilities
            .map(capability => capability.capability)
            .join(', ')}
        />
      )}

      <section>
        <div className="section-panel-heading">
          <h3>
            <ExclamationCircleOutlined />
            {dictionary.teamBuilder.risks}
          </h3>
        </div>
        {recommendation.risks.length === 0 ? (
          <div className="team-empty-line">{dictionary.teamBuilder.noRisks}</div>
        ) : (
          <div className="team-risk-list">
            {recommendation.risks.map((risk, index) => (
              <Alert
                key={`${risk.kind}-${String(index)}`}
                type="warning"
                showIcon
                title={riskLabel(dictionary, risk)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="team-policy-strip">
        <span>
          <ToolOutlined />
          {dictionary.teamBuilder.tools}
        </span>
        <div className="team-tag-line">
          {recommendation.toolPolicy.allowedTools.map(tool => <Tag key={tool}>{tool}</Tag>)}
        </div>
        <span>
          <ThunderboltOutlined />
          {dictionary.teamBuilder.memberMemory}
        </span>
        <div className="team-tag-line">
          <Tag>{memoryAccessLabel(dictionary, recommendation.memoryPolicy.allowedAccess)}</Tag>
          {recommendation.memoryPolicy.allowedKinds.map(kind => (
            <Tag key={kind}>{memoryKindLabel(dictionary, kind)}</Tag>
          ))}
        </div>
      </section>
    </div>
  )
}
