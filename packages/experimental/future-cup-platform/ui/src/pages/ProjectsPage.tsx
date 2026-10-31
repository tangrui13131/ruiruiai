import {
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Result,
  Skeleton,
  Space,
  Tooltip,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type { ProjectView } from '../api/contracts.ts'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useProjectCommands } from '../hooks/useProjectCommands.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

interface CreateProjectValues {
  readonly name: string
  readonly requirement: string
}

function ProjectCard({
  project,
  onChanged,
}: {
  readonly project: ProjectView
  readonly onChanged: () => Promise<void>
}) {
  const { dictionary, locale } = useLocale()
  const navigate = useNavigate()
  const commands = useProjectCommands(project.id, onChanged)
  const status = project.latestRunStatus ?? project.workflowStatus ?? 'PENDING'
  const running = status === 'RUNNING'
  const canRun = project.latestRunStatus === undefined
  return (
    <article className="project-card">
      <div className="project-card-body">
        <div className="project-card-heading">
          <h3>{project.name}</h3>
          <StatusBadge status={status} />
        </div>
        <p className="project-card-requirement">{project.requirement}</p>
        <div className="project-card-meta">
          <span>{dictionary.projects.lastEvent}: {project.lastEventSeq}</span>
          <span>{new Intl.DateTimeFormat(locale).format(new Date(project.createdAt))}</span>
        </div>
      </div>
      <footer className="project-card-footer">
        <Space size={4}>
          {running ? (
            <Tooltip title={dictionary.projects.cancelRun}>
              <Button
                danger
                type="text"
                icon={<PauseCircleOutlined />}
                loading={commands.pending === 'cancel'}
                aria-label={dictionary.projects.cancelRun}
                onClick={() => { void commands.cancel() }}
              />
            </Tooltip>
          ) : canRun ? (
            <Tooltip title={dictionary.projects.run}>
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                loading={commands.pending === 'run'}
                aria-label={dictionary.projects.run}
                onClick={() => { void commands.start() }}
              />
            </Tooltip>
          ) : (
            <Tooltip title={dictionary.projects.runUnavailable}>
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                aria-label={dictionary.projects.runUnavailable}
                disabled
              />
            </Tooltip>
          )}
        </Space>
        <Button
          type="link"
          icon={<FolderOpenOutlined />}
          onClick={() => { navigate(`/projects/${encodeURIComponent(project.id)}`) }}
        >
          {dictionary.projects.openProject}
        </Button>
      </footer>
    </article>
  )
}

/** List projects, create requirements, and expose project run controls. */
export function ProjectsPage() {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [form] = Form.useForm<CreateProjectValues>()
  const [projects, setProjects] = useState<readonly ProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setProjects(await api.listProjects())
      setError(undefined)
    } catch (loadError: unknown) {
      setError(localizedApiError(loadError, dictionary.errors, dictionary.errors.loadProjects))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function create(values: CreateProjectValues): Promise<void> {
    setCreating(true)
    try {
      const project = await api.createProject(values)
      message.success(dictionary.projects.created)
      setCreateOpen(false)
      form.resetFields()
      navigate(`/projects/${encodeURIComponent(project.id)}`)
    } catch (createError: unknown) {
      message.error(localizedApiError(
        createError,
        dictionary.errors,
        dictionary.errors.createProject,
      ))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        title={dictionary.projects.title}
        description={dictionary.projects.description}
        actions={
          <>
            <Tooltip title={dictionary.common.refresh}>
              <Button
                icon={<ReloadOutlined />}
                aria-label={dictionary.common.refresh}
                onClick={() => { void load() }}
              />
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateOpen(true) }}>
              {dictionary.projects.create}
            </Button>
          </>
        }
      />

      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
      {!loading && error !== undefined ? (
        <Result
          status="error"
          title={dictionary.errors.loadProjects}
          subTitle={error}
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => { void load() }}>
              {dictionary.common.retry}
            </Button>
          }
        />
      ) : null}
      {!loading && error === undefined && projects.length === 0 ? (
        <div className="empty-panel">{dictionary.projects.empty}</div>
      ) : null}
      {!loading && projects.length > 0 ? (
        <section className="project-grid">
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} onChanged={load} />
          ))}
        </section>
      ) : null}

      <Modal
        open={createOpen}
        title={dictionary.projects.createTitle}
        confirmLoading={creating}
        okText={dictionary.common.confirm}
        cancelText={dictionary.common.cancel}
        onCancel={() => { setCreateOpen(false) }}
        onOk={() => { form.submit() }}
      >
        <Form<CreateProjectValues>
          form={form}
          layout="vertical"
          onFinish={(values) => { void create(values) }}
        >
          <Form.Item
            name="name"
            label={dictionary.projects.name}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={120} placeholder={dictionary.projects.namePlaceholder} />
          </Form.Item>
          <Form.Item
            name="requirement"
            label={dictionary.projects.requirement}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea
              rows={8}
              maxLength={20_000}
              showCount
              placeholder={dictionary.projects.requirementPlaceholder}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
