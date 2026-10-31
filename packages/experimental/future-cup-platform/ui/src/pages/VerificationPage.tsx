import { Alert, Collapse, Image, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { screenshotUrl } from '../api/client.ts'
import type {
  VerificationReportView,
} from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState } from '../state/ProjectStoreContext.tsx'

interface CheckRow {
  readonly name: string
  readonly status: string
  readonly summary: string
}

function ReportBody({ report, projectId }: {
  readonly report: VerificationReportView
  readonly projectId: string
}) {
  const { dictionary } = useLocale()
  const columns: ColumnsType<CheckRow> = [
    { title: dictionary.verification.checks, dataIndex: 'name' },
    {
      title: dictionary.projects.status,
      dataIndex: 'status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    { title: dictionary.verification.findings, dataIndex: 'summary' },
  ]
  return (
    <div className="page-stack">
      <div className="page-heading-actions">
        <Tag>{report.report.verifier}</Tag>
        <StatusBadge status={report.status} />
        {report.failureSignature === undefined
          ? null
          : <Tag color="red">{dictionary.verification.signature}: {report.failureSignature.slice(0, 16)}</Tag>}
      </div>
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        scroll={{ x: 620 }}
        columns={columns}
        dataSource={[...report.report.checks]}
      />
      {report.report.findings.map(finding => (
        <Alert
          key={`${finding.category}-${finding.code}-${finding.target ?? ''}`}
          type={finding.severity === 'error' ? 'error' : 'warning'}
          showIcon
          message={`${finding.code}: ${finding.message}`}
          description={finding.target}
        />
      ))}
      <div>
        <div className="agent-metric-label">{dictionary.verification.routes}</div>
        <div style={{ marginTop: 6 }}>
          {report.report.routes.map(route => <Tag key={route}>{route}</Tag>)}
        </div>
      </div>
      <div>
        <div className="agent-metric-label">{dictionary.verification.viewports}</div>
        <div style={{ marginTop: 6 }}>
          {report.report.viewports.map(viewport => <Tag key={viewport}>{viewport}</Tag>)}
        </div>
      </div>
      <div>
        <div className="agent-metric-label">{dictionary.verification.screenshots}</div>
        {report.report.screenshots.length === 0 ? (
          <EmptyPanel text={dictionary.verification.noScreenshots} />
        ) : (
          <Image.PreviewGroup>
            <div className="screenshot-grid" style={{ marginTop: 8 }}>
              {report.report.screenshots.map((path) => {
                const url = screenshotUrl(projectId, path)
                return (
                  <figure className="screenshot-item" key={path}>
                    <Image src={url} alt={path.split(/[\\/]/u).at(-1) ?? path} />
                    <figcaption className="screenshot-caption">{path.split(/[\\/]/u).at(-1) ?? path}</figcaption>
                  </figure>
                )
              })}
            </div>
          </Image.PreviewGroup>
        )}
      </div>
    </div>
  )
}

/** Render verification checks, findings, routes, and screenshot evidence. */
export function VerificationPage() {
  const { dictionary } = useLocale()
  const snapshot = useProjectState().snapshot
  if (snapshot === undefined) return null
  const reports = [...snapshot.verificationReports].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )
  return (
    <div className="page-stack">
      <PageHeading title={dictionary.verification.title} description={dictionary.verification.description} />
      {reports.length === 0 ? <EmptyPanel text={dictionary.verification.noReports} /> : (
        <Collapse
          defaultActiveKey={reports[0]?.id}
          items={reports.map(report => ({
            key: report.id,
            label: (
              <span className="page-heading-actions">
                <StatusBadge status={report.status} />
                <span>{report.id}</span>
                <span className="event-time">{new Date(report.createdAt).toLocaleString()}</span>
              </span>
            ),
            children: <ReportBody report={report} projectId={snapshot.project.id} />,
          }))}
        />
      )}
    </div>
  )
}
