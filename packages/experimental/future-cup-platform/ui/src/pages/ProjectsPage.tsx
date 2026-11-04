import {
  BranchesOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Skeleton,
  Space,
  Tooltip,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type {
  AgentTeamView,
  DeriveProjectRequest,
  ProjectDerivationMode,
  ProjectView,
} from '../api/contracts.ts'
import { PageHeading } from '../components/PageHeading.tsx'
import { SelfHealDrillButton } from '../components/SelfHealDrillModal.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useProjectCommands } from '../hooks/useProjectCommands.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

interface CreateProjectValues {
  readonly name: string
  readonly requirement: string
  readonly teamVersionId?: string
}

interface DeriveProjectValues {
  readonly name: string
  readonly mode: ProjectDerivationMode
  readonly changeRequest?: string
}

function ProjectCard({
  project,
  onChanged,
  onDerive,
}: {
  readonly project: ProjectView
  readonly onChanged: () => Promise<void>
  readonly onDerive: (project: ProjectView) => void
}) {
  const { dictionary, locale } = useLocale()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const commands = useProjectCommands(project.id, onChanged)
  const [deleting, setDeleting] = useState(false)
  const status = project.latestRunStatus ?? project.workflowStatus ?? 'PENDING'
  const running = status === 'RUNNING'
  const canRun = project.latestRunStatus === undefined
  const canDerive = project.latestRunStatus === 'PASSED'

  async function remove(): Promise<void> {
    setDeleting(true)
    try {
      await api.deleteProject(project.id)
      message.success(dictionary.projects.deleted)
      await onChanged()
    } catch (deleteError: unknown) {
      message.error(localizedApiError(
        deleteError,
        dictionary.errors,
        dictionary.errors.deleteProject,
      ))
    } finally {
      setDeleting(false)
    }
  }

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
            <SelfHealDrillButton
              projectId={project.id}
              compact
              onLaunched={onChanged}
            />
          )}
          <Tooltip title={canDerive ? dictionary.projects.derive : dictionary.projects.deriveUnavailable}>
            <Button
              type="text"
              icon={<BranchesOutlined />}
              disabled={!canDerive}
              aria-label={dictionary.projects.derive}
              onClick={() => { onDerive(project) }}
            />
          </Tooltip>
          <Tooltip title={dictionary.projects.deleteProject}>
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              loading={deleting}
              disabled={running}
              aria-label={dictionary.projects.deleteProject}
              onClick={() => { void remove() }}
            />
          </Tooltip>
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
  const [deriveForm] = Form.useForm<DeriveProjectValues>()
  const [projects, setProjects] = useState<readonly ProjectView[]>([])
  const [teams, setTeams] = useState<readonly AgentTeamView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const [deriveSource, setDeriveSource] = useState<ProjectView>()
  const [deriveOpen, setDeriveOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deriving, setDeriving] = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const deriveMode = Form.useWatch('mode', deriveForm) ?? 'UPGRADE'

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const [nextProjects, nextTeams] = await Promise.all([
        api.listProjects(),
        api.listTeams().then(page => page.items).catch(() => [] as AgentTeamView[]),
      ])
      setProjects(nextProjects)
      setTeams(nextTeams)
      setError(undefined)
    } catch (loadError: unknown) {
      setError(localizedApiError(loadError, dictionary.errors, dictionary.errors.loadProjects))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    const requestedTeamVersionId = searchParams.get('teamVersionId')
    if (requestedTeamVersionId !== null && requestedTeamVersionId.trim() !== '') {
      form.setFieldValue('teamVersionId', requestedTeamVersionId)
      setCreateOpen(true)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('teamVersionId')
      setSearchParams(nextParams, { replace: true })
    }
  }, [form, searchParams, setSearchParams])

  useEffect(() => {
    const requestedProjectId = searchParams.get('deriveProjectId')
    if (requestedProjectId === null || requestedProjectId === '') return
    const source = projects.find(project => project.id === requestedProjectId)
    if (source === undefined) return
    openDerive(source)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('deriveProjectId')
    setSearchParams(nextParams, { replace: true })
  }, [projects, searchParams, setSearchParams])

  const teamOptions = [
    { value: '', label: dictionary.projects.defaultTeam },
    ...teams
      .filter(team => team.status === 'ACTIVE' && team.latestVersion?.status === 'PUBLISHED')
      .map(team => ({
        value: team.latestVersion?.id ?? '',
        label: `${team.name} · ${team.latestVersion?.version ?? ''}`,
      })),
  ]

  async function create(values: CreateProjectValues): Promise<void> {
    setCreating(true)
    try {
      const project = await api.createProject({
        name: values.name,
        requirement: values.requirement,
        ...(values.teamVersionId === undefined || values.teamVersionId === ''
          ? {}
          : { teamVersionId: values.teamVersionId }),
      })
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

  function openDerive(project: ProjectView): void {
    setDeriveSource(project)
    deriveForm.resetFields()
    deriveForm.setFieldsValue({
      name: `${project.name} · v2`,
      mode: 'UPGRADE',
      changeRequest: '',
    })
    setDeriveOpen(true)
  }

  async function derive(values: DeriveProjectValues): Promise<void> {
    if (deriveSource === undefined) return
    setDeriving(true)
    try {
      const input: DeriveProjectRequest = {
        name: values.name,
        mode: values.mode,
        ...values.mode === 'UPGRADE' && values.changeRequest !== undefined
          ? { changeRequest: values.changeRequest }
          : {},
      }
      const result = await api.deriveProject(deriveSource.id, input)
      message.success(dictionary.projects.deriveSuccess)
      setDeriveOpen(false)
      setDeriveSource(undefined)
      deriveForm.resetFields()
      navigate(`/projects/${encodeURIComponent(result.project.id)}`)
    } catch (deriveError: unknown) {
      message.error(localizedApiError(
        deriveError,
        dictionary.errors,
        dictionary.errors.deriveProject,
      ))
    } finally {
      setDeriving(false)
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
            <Button
              icon={<TeamOutlined />}
              onClick={() => { navigate('/team-builder') }}
            >
              {dictionary.teamBuilder.entry}
            </Button>
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
            <ProjectCard
              key={project.id}
              project={project}
              onChanged={load}
              onDerive={openDerive}
            />
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
            name="teamVersionId"
            label={dictionary.projects.team}
            initialValue=""
          >
            <Select options={teamOptions} aria-label={dictionary.projects.team} />
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

      <Modal
        open={deriveOpen}
        title={dictionary.projects.deriveTitle}
        confirmLoading={deriving}
        okText={dictionary.common.confirm}
        cancelText={dictionary.common.cancel}
        onCancel={() => {
          setDeriveOpen(false)
          setDeriveSource(undefined)
        }}
        onOk={() => { deriveForm.submit() }}
      >
        <Form<DeriveProjectValues>
          form={deriveForm}
          layout="vertical"
          onFinish={(values) => { void derive(values) }}
        >
          <p className="project-derive-hint">{dictionary.projects.deriveHint}</p>
          <Form.Item
            name="name"
            label={dictionary.projects.deriveName}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="mode" label={dictionary.projects.deriveMode}>
            <Select
              options={[
                { value: 'UPGRADE', label: dictionary.projects.deriveUpgrade },
                { value: 'REGENERATE', label: dictionary.projects.deriveRegenerate },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="changeRequest"
            label={dictionary.projects.deriveChangeRequest}
            rules={deriveMode === 'UPGRADE'
              ? [{ required: true, whitespace: true }]
              : []}
          >
            <Input.TextArea
              rows={6}
              maxLength={20_000}
              showCount
              placeholder={dictionary.projects.deriveChangeRequestPlaceholder}
              disabled={deriveMode === 'REGENERATE'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
