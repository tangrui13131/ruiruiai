import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Progress, Skeleton, Spin, Tooltip } from 'antd'
import { Link } from 'react-router-dom'
import { localizedApiError } from '../api/errors.ts'
import type { AgentView } from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useProjectAgents } from '../hooks/useProjectAgents.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState, useProjectStore } from '../state/ProjectStoreContext.tsx'

function AgentHistorySummary({ agent }: { readonly agent: AgentView }) {
  const { dictionary } = useLocale()
  const hasHistory = agent.historicalExecutionCount > 0
  const successPercent = hasHistory
    ? Math.max(0, Math.min(100, Math.round(
      agent.historicalSuccessCount / agent.historicalExecutionCount * 100,
    )))
    : 0
  const historySummary = hasHistory
    ? dictionary.overview.executionHistory
      .replace('{success}', String(agent.historicalSuccessCount))
      .replace('{total}', String(agent.historicalExecutionCount))
    : dictionary.overview.noHistoricalExecutions
  return (
    <div className="agent-history">
      <div className="agent-history-heading">
        <span className="agent-metric-label">{dictionary.overview.successRate}</span>
        <span className="agent-metric-value">
          {hasHistory ? `${successPercent}%` : dictionary.common.noData}
        </span>
      </div>
      <Progress
        aria-label={`${dictionary.overview.successRate}: ${
          hasHistory ? `${successPercent}%` : dictionary.common.noData
        }. ${historySummary}`}
        size="small"
        percent={successPercent}
        showInfo={false}
        strokeColor={hasHistory ? '#304bc7' : '#d8ccc2'}
      />
      <div className="agent-history-detail">{historySummary}</div>
    </div>
  )
}

/** Render one Agent's capacity, live load, and observed execution history. */
export function AgentCard({ agent }: { readonly agent: AgentView }) {
  const { dictionary } = useLocale()
  return (
    <article className="agent-row">
      <div className="agent-row-heading">
        <div>
          <div className="agent-row-name">{agent.name}</div>
          <div className="agent-row-role">{agent.role}</div>
        </div>
        <StatusBadge status={agent.available ? 'READY' : 'CANCELLED'} />
      </div>
      <div className="agent-metrics">
        <div>
          <div className="agent-metric-label">{dictionary.overview.capacity}</div>
          <div className="agent-metric-value">{agent.maxConcurrency}</div>
        </div>
        <div>
          <div className="agent-metric-label">{dictionary.overview.load}</div>
          <div className="agent-metric-value">{agent.currentLoad}</div>
        </div>
      </div>
      <AgentHistorySummary agent={agent} />
      <div className="agent-capabilities">
        {dictionary.overview.capabilities}: {Object.entries(agent.capabilities).map(([key, value]) => `${key} ${String(value)}`).join(', ')}
      </div>
    </article>
  )
}

/** Show project facts, latest run state, workflow state, and the Agent roster. */
export function ProjectOverviewPage() {
  const { dictionary } = useLocale()
  const state = useProjectState()
  const store = useProjectStore()
  const snapshot = state.snapshot
  const agentState = useProjectAgents(
    snapshot?.project.id,
    snapshot?.lastEventSeq ?? 0,
  )

  if (snapshot === undefined) return null
  const latestRun = snapshot.runs?.at(-1)
  const completedTasks = snapshot.tasks.filter(task => task.status === 'COMPLETED').length

  return (
    <div className="page-stack">
      <PageHeading
        title={dictionary.overview.title}
        description={snapshot.project.requirement}
        actions={
          <Tooltip title={dictionary.common.refresh}>
            <Button
              icon={<ReloadOutlined />}
              aria-label={dictionary.common.refresh}
              onClick={() => { void store.refresh() }}
            />
          </Tooltip>
        }
      />
      {snapshot.project.sourceProjectName === undefined ? null : (
        <Alert
          type="info"
          showIcon
          message={(
            <span>
              {dictionary.projects.derivedFrom}:{' '}
              {snapshot.project.sourceProjectId === undefined
                ? snapshot.project.sourceProjectName
                : (
                  <Link to={`/projects/${encodeURIComponent(snapshot.project.sourceProjectId)}`}>
                    {snapshot.project.sourceProjectName}
                  </Link>
                )}
            </span>
          )}
          description={snapshot.project.derivationMode === 'UPGRADE'
            ? snapshot.project.changeRequest
            : dictionary.projects.derivedRegenerate}
        />
      )}
      <section className="metric-strip">
        <div className="metric-cell">
          <div className="metric-cell-label">{dictionary.projects.status}</div>
          <div className="metric-cell-value">
            <StatusBadge status={latestRun?.status ?? snapshot.workflow?.status ?? 'PENDING'} />
          </div>
        </div>
        <div className="metric-cell">
          <div className="metric-cell-label">{dictionary.overview.tasks}</div>
          <div className="metric-cell-value">{completedTasks} / {snapshot.tasks.length}</div>
        </div>
        <div className="metric-cell">
          <div className="metric-cell-label">{dictionary.projects.lastEvent}</div>
          <div className="metric-cell-value">{snapshot.lastEventSeq}</div>
        </div>
        <div className="metric-cell">
          <div className="metric-cell-label">{dictionary.overview.workflow}</div>
          <div className="metric-cell-value">
            <StatusBadge status={snapshot.workflow?.status ?? 'PENDING'} />
          </div>
        </div>
      </section>

      <section className="section-panel">
        <div className="section-panel-heading">
          <h3>{dictionary.overview.agents}</h3>
          <span className="agent-metric-label">
            {agentState.agents.length}
            {agentState.refreshing ? <Spin size="small" style={{ marginLeft: 6 }} /> : null}
          </span>
        </div>
        {agentState.loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {agentState.error === undefined ? null : (
          <Alert
            type="error"
            showIcon
            message={dictionary.errors.loadAgents}
            description={localizedApiError(
              agentState.error,
              dictionary.errors,
              dictionary.errors.loadAgents,
            )}
            action={
              <Button size="small" onClick={agentState.retry}>
                {dictionary.common.retry}
              </Button>
            }
          />
        )}
        {!agentState.loading && agentState.agents.length === 0 && agentState.error === undefined ? (
          <EmptyPanel text={dictionary.common.noData} />
        ) : null}
        {agentState.agents.length > 0 ? (
          <div className="agent-grid">
            {agentState.agents.map(agent => <AgentCard key={agent.id} agent={agent} />)}
          </div>
        ) : null}
      </section>
    </div>
  )
}
