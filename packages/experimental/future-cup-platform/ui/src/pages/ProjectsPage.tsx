import {
  ApartmentOutlined,
  ArrowRightOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
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
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type {
  AgentDefinitionView,
  AgentTeamView,
  DeriveProjectRequest,
  ProjectDerivationMode,
  ProjectSnapshotView,
  ProjectView,
} from '../api/contracts.ts'
import { PageHeading } from '../components/PageHeading.tsx'
import { SelfHealDrillButton } from '../components/SelfHealDrillModal.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useProjectCommands } from '../hooks/useProjectCommands.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

function Digits({ value }: { readonly value: string }) {
  return (
    <span className="digits" key={value}>
      {[...value].map((char, index) => (
        /\d/u.test(char) ? (
          <span className="digit-window" key={index}>
            <span
              className="digit-roll"
              style={{ '--delay': `${String((value.length - index) * 35)}ms` } as CSSProperties}
            >
              {char}
            </span>
          </span>
        ) : (
          <span className="digit-separator" key={index}>{char}</span>
        )
      ))}
    </span>
  )
}

/**
 * Index of the stage currently running. A return value equal to `stageCount`
 * means every stage is done and none is running, so the renderer must not draw
 * a spinner on the last stage of a passed project.
 */
function computeActiveStage(
  project: ProjectView | undefined,
  snapshot: ProjectSnapshotView | undefined,
  stageCount: number,
): number {
  const status = project?.latestRunStatus ?? project?.workflowStatus ?? 'PENDING'
  if (status === 'PASSED') return stageCount
  const tasks = snapshot?.tasks ?? []
  if (tasks.length === 0) return status === 'RUNNING' ? 0 : -1
  const lastRunningStage = stageCount - 2
  if ((snapshot?.verificationReports.length ?? 0) > 0) return lastRunningStage
  const roleStage: Readonly<Record<string, number>> = {
    planner: 0,
    'ui-designer': 1,
    frontend: 2,
    tester: 2,
    integration: 3,
    verifier: lastRunningStage,
    repair: lastRunningStage,
  }
  let highestActive = 0
  for (const task of tasks) {
    const stageIdx = roleStage[task.role] ?? 2
    if (task.status === 'RUNNING') {
      highestActive = Math.max(highestActive, stageIdx)
    } else if (task.status === 'COMPLETED') {
      highestActive = Math.max(highestActive, Math.min(lastRunningStage, stageIdx + 1))
    }
  }
  return highestActive
}

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
  const [definitions, setDefinitions] = useState<readonly AgentDefinitionView[]>([])
  const [focusSnapshot, setFocusSnapshot] = useState<ProjectSnapshotView>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const [deriveSource, setDeriveSource] = useState<ProjectView>()
  const [deriveOpen, setDeriveOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deriving, setDeriving] = useState(false)
  const [query, setQuery] = useState('')
  const [teamIndex, setTeamIndex] = useState(0)
  const [dragX, setDragX] = useState(0)
  const pullStart = useRef<number | null>(null)
  const projectsListRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const deriveMode = Form.useWatch('mode', deriveForm) ?? 'UPGRADE'

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const [nextProjects, nextTeams, nextDefinitions] = await Promise.all([
        api.listProjects(),
        api.listTeams().then(page => page.items).catch(() => [] as AgentTeamView[]),
        api.listAgentDefinitions().catch(() => [] as AgentDefinitionView[]),
      ])
      setProjects(nextProjects)
      setTeams(nextTeams)
      setDefinitions(nextDefinitions)
      setError(undefined)
      const activeOrLatest = nextProjects.find(
        item => (item.latestRunStatus ?? item.workflowStatus) === 'RUNNING',
      ) ?? nextProjects[0]
      if (activeOrLatest !== undefined) {
        await api.getSnapshot(activeOrLatest.id, 0, 100)
          .then((snap) => { setFocusSnapshot(snap) })
          .catch(() => { setFocusSnapshot(undefined) })
      } else {
        setFocusSnapshot(undefined)
      }
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

  const stageItems = [
    { key: 'planning', label: dictionary.projects.activePanel.stages.planning, role: 'PLANNER' },
    { key: 'design', label: dictionary.projects.activePanel.stages.design, role: 'DESIGNER' },
    { key: 'frontend', label: dictionary.projects.activePanel.stages.frontend, role: 'FRONTEND' },
    { key: 'integration', label: dictionary.projects.activePanel.stages.integration, role: 'INTEGRATOR' },
    { key: 'verification', label: dictionary.projects.activePanel.stages.verification, role: 'VERIFIER' },
    { key: 'delivery', label: dictionary.projects.activePanel.stages.delivery, role: 'DELIVERY' },
  ]
  const focusProject = projects.find(
    item => (item.latestRunStatus ?? item.workflowStatus) === 'RUNNING',
  ) ?? projects[0]
  const activeStage = computeActiveStage(focusProject, focusSnapshot, stageItems.length)
  const stagePercent = focusProject === undefined
    ? 0
    : activeStage < 0
      ? 0
      : Math.round(Math.min(activeStage + 1, stageItems.length) / stageItems.length * 100)
  const launchedProjects = projects.filter(item => item.latestRunStatus !== undefined).length
  const publishedDefinitions = definitions.filter(item => item.status === 'PUBLISHED')
  const agentTotalCount = publishedDefinitions.length > 0 ? publishedDefinitions.length : 7
  const completedTaskCount = focusSnapshot === undefined
    ? projects.filter(item => (item.latestRunStatus ?? item.workflowStatus) === 'PASSED').length * 6
    : focusSnapshot.tasks.filter(task => task.status === 'COMPLETED').length
  const latestReport = focusSnapshot?.verificationReports.at(-1)
  const checkTotal = latestReport?.report.checks.length ?? 0
  const checkPassed = latestReport?.report.checks.filter(item => item.status === 'PASS').length ?? 0
  const passRateStr = checkTotal > 0
    ? (checkPassed / checkTotal * 100).toFixed(1)
    : projects.some(item => item.latestRunStatus === 'PASSED')
      ? '100'
      : '00.0'

  const activeTeams = teams.filter(item => item.status === 'ACTIVE')
  const currentTeam = activeTeams.length > 0
    ? activeTeams[teamIndex % activeTeams.length]
    : undefined
  const rosterPreview = (publishedDefinitions.length > 0
    ? publishedDefinitions.slice(0, 4).map(def => ({
      id: def.id,
      initials: def.name.slice(0, 2).toUpperCase(),
      name: def.name,
    }))
    : [
      { id: 'planner', initials: 'PL', name: 'Planner' },
      { id: 'ui-designer', initials: 'UI', name: 'UI Designer' },
      { id: 'frontend', initials: 'FE', name: 'Frontend' },
      { id: 'verifier', initials: 'QA', name: 'Verifier' },
    ])

  const filteredProjects = projects.filter(item => (
    query.trim() === ''
    || item.name.toLowerCase().includes(query.trim().toLowerCase())
    || item.requirement.toLowerCase().includes(query.trim().toLowerCase())
  ))

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">{dictionary.projects.workbenchEyebrow}</span>
          <h1>
            {dictionary.projects.workbenchHeadlinePrefix}
            <span>{dictionary.projects.workbenchHeadlineHighlight}</span>
          </h1>
          <p>{dictionary.projects.workbenchSubtitle}</p>
        </div>
        <div className="page-heading-actions">
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
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <div className="metric-label">
            <span>{dictionary.projects.metrics.totalProjects}</span>
            <ProjectOutlined />
          </div>
          <Digits value={String(projects.length).padStart(2, '0')} />
          <p>
            <span className="blue-text">{launchedProjects}</span>
            <span>{dictionary.projects.metrics.projectsNote}</span>
            <span className="metric-note">PROJECTS</span>
          </p>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            <span>{dictionary.projects.metrics.agentsTitle}</span>
            <RobotOutlined />
          </div>
          <Digits value={String(agentTotalCount).padStart(2, '0')} />
          <p>
            <i className="blue-dot" />
            <span>7 {dictionary.projects.metrics.agentsNote}</span>
            <span className="metric-note">AGENTS</span>
          </p>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            <span>{dictionary.projects.metrics.completedTasks}</span>
            <CheckCircleOutlined />
          </div>
          <Digits value={String(completedTaskCount).padStart(2, '0')} />
          <p>
            <span className="blue-text">DAG</span>
            <span>{dictionary.projects.metrics.tasksNote}</span>
            <span className="metric-note">TASKS</span>
          </p>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            <span>{dictionary.projects.metrics.passRate}</span>
            <span className="live-label"><i className="blue-dot" />LIVE</span>
          </div>
          <div className="rate-number">
            <Digits value={passRateStr} />
            <span>%</span>
          </div>
          <p>
            <span className="blue-text">E2E</span>
            <span>{dictionary.projects.metrics.passRateNote}</span>
            <span className="metric-note">QUALITY</span>
          </p>
        </article>
      </section>

      <div className="workspace-grid">
        <section className="neu-panel execution-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{dictionary.projects.activePanel.eyebrow}</span>
              <h2>{dictionary.projects.activePanel.title}</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => { projectsListRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
            >
              {dictionary.projects.activePanel.allProjects} <ArrowRightOutlined />
            </button>
          </div>
          {focusProject === undefined ? (
            <div className="empty-panel">{dictionary.projects.activePanel.emptyHint}</div>
          ) : (
            <>
              <div className="project-heading">
                <span className="project-emblem"><ApartmentOutlined /></span>
                <div>
                  <h3>{focusProject.name}</h3>
                  <p>React <span>·</span> TypeScript <span>·</span> Vite <span>·</span> Ant Design</p>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <StatusBadge
                    status={focusProject.latestRunStatus ?? focusProject.workflowStatus ?? 'PENDING'}
                  />
                </div>
              </div>
              <div className="dag-canvas">
                <div className="dag-topline">
                  <span><i className="blue-dot" />{dictionary.projects.activePanel.dagTitle}</span>
                  <span>SEQ / {String(focusProject.lastEventSeq).padStart(3, '0')}</span>
                </div>
                <div className="dag-flow">
                  {stageItems.map((item, idx) => {
                    const stateClass = idx < activeStage
                      ? 'done'
                      : idx === activeStage
                        ? 'current'
                        : 'pending'
                    return (
                      <div className={`dag-step ${stateClass}`} key={item.key}>
                        <span className="dag-node-pill">
                          {idx < activeStage ? (
                            <span>✓</span>
                          ) : idx === activeStage ? (
                            <span className="node-spinner" />
                          ) : (
                            <span className="pending-dot" />
                          )}
                        </span>
                        <strong>{item.label}</strong>
                        <small>{item.role}</small>
                      </div>
                    )
                  })}
                </div>
                <div className="dag-bottomline">
                  <span>
                    {activeStage >= stageItems.length
                      ? dictionary.projects.activePanel.stageAllDone
                      : dictionary.projects.activePanel.stageProgress.replace(
                        '{current}',
                        String(Math.max(1, activeStage + 1)),
                      )}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => { navigate(`/projects/${encodeURIComponent(focusProject.id)}/dag`) }}
                  >
                    {dictionary.nav.dag} <ArrowRightOutlined />
                  </button>
                </div>
              </div>
              <div className="project-progress">
                <div>
                  <span>{dictionary.projects.activePanel.progressLabel}</span>
                  <strong>{stagePercent}<small>%</small></strong>
                </div>
                <div className="recessed-track">
                  <span style={{ width: `${String(stagePercent)}%` }} />
                </div>
              </div>
              <div className="execution-footer">
                <div className="avatar-stack">
                  {['PL', 'UI', 'FE', 'QA'].map(tag => <span key={tag}>{tag}</span>)}
                  <small>
                    {dictionary.projects.activePanel.agentCount.replace(
                      '{count}',
                      String(currentTeam?.latestVersion?.members.length ?? 7),
                    )}
                  </small>
                </div>
                <Button
                  size="small"
                  onClick={() => { navigate(`/projects/${encodeURIComponent(focusProject.id)}`) }}
                >
                  {dictionary.projects.openProject} <ArrowRightOutlined />
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="neu-panel team-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{dictionary.projects.crewPanel.eyebrow}</span>
              <h2>{dictionary.projects.crewPanel.title}</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => { navigate('/teams') }}
            >
              {dictionary.projects.crewPanel.viewAll} <ArrowRightOutlined />
            </button>
          </div>
          <div className="crew-content">
            <div className="team-list">
              {rosterPreview.map(member => (
                <button
                  type="button"
                  className="team-member"
                  key={member.id}
                  onClick={() => { navigate('/agents') }}
                >
                  <span className="member-avatar">{member.initials}</span>
                  <span><strong>{member.name}</strong></span>
                  <span className="member-activity">
                    <i className="blue-dot" />
                    {dictionary.statuses.ready}
                  </span>
                </button>
              ))}
            </div>
            <div className="stack-area">
              <div className="team-card-back back-two" />
              <div className="team-card-back back-one" />
              <button
                type="button"
                className="pull-card"
                style={{
                  transform: `translate(${String(dragX)}px, ${String(Math.abs(dragX) * -0.12)}px) rotate(${String(-4 + dragX * 0.03)}deg)`,
                }}
                onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
                  pullStart.current = event.clientX
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
                  if (pullStart.current !== null) {
                    setDragX(Math.max(-110, Math.min(110, event.clientX - pullStart.current)))
                  }
                }}
                onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
                  const distance = event.clientX - (pullStart.current ?? event.clientX)
                  pullStart.current = null
                  setDragX(0)
                  if (Math.abs(distance) > 65 || Math.abs(distance) < 5) {
                    navigate('/teams')
                  }
                }}
                onPointerCancel={() => {
                  pullStart.current = null
                  setDragX(0)
                }}
                onClick={(event) => {
                  if (event.detail === 0) navigate('/teams')
                }}
              >
                <div className="pull-card-top">
                  <span>{dictionary.projects.crewPanel.featuredLabel}</span>
                  <span className="blue-text">{dictionary.projects.crewPanel.readyLabel}</span>
                </div>
                <span className="featured-icon"><TeamOutlined /></span>
                <h3>{currentTeam?.name ?? dictionary.projects.defaultTeam}</h3>
                <p>{currentTeam?.purpose ?? dictionary.projects.crewPanel.defaultPurpose}</p>
                <div className="pull-card-bottom">
                  <span>
                    <strong>
                      {String(currentTeam?.latestVersion?.members.length ?? 7).padStart(2, '0')}
                    </strong>
                    {dictionary.projects.crewPanel.membersUnit}
                  </span>
                  <span>{dictionary.projects.crewPanel.pullHint} <ArrowRightOutlined /></span>
                </div>
              </button>
              <div className="stack-pagination">
                <span>
                  {String((activeTeams.length > 0 ? (teamIndex % activeTeams.length) + 1 : 1)).padStart(2, '0')}
                  {' / '}
                  {String(Math.max(1, activeTeams.length)).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  aria-label={dictionary.projects.crewPanel.nextTeam}
                  onClick={() => { setTeamIndex(value => value + 1) }}
                >
                  <ArrowRightOutlined />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div ref={projectsListRef} className="page-stack">
        <div className="section-panel-heading" style={{ marginBottom: 4 }}>
          <PageHeading
            title={dictionary.projects.title}
            description={dictionary.projects.description}
          />
          {projects.length > 0 ? (
            <label className="search-field">
              <SearchOutlined />
              <input
                aria-label={dictionary.projects.searchPlaceholder}
                placeholder={dictionary.projects.searchPlaceholder}
                value={query}
                onChange={(event) => { setQuery(event.target.value) }}
              />
            </label>
          ) : null}
        </div>

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
        {!loading && projects.length > 0 && filteredProjects.length === 0 ? (
          <div className="empty-panel">{dictionary.projects.noMatchingProjects}</div>
        ) : null}
        {!loading && filteredProjects.length > 0 ? (
          <section className="project-grid">
            {filteredProjects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onChanged={load}
                onDerive={openDerive}
              />
            ))}
          </section>
        ) : null}
      </div>

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
