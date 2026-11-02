import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
} from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type {
  AgentDefinitionView,
  AgentTeamPageView,
  AgentTeamVersionView,
  AgentTeamView,
} from '../api/contracts.ts'
import { PageHeading } from '../components/PageHeading.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'

type DepartmentKey = AgentTeamVersionView['members'][number]['departmentKey']

interface DraftMember {
  readonly rowId: string
  readonly agentVersionId: string
  readonly displayName: string
  readonly departmentKey: DepartmentKey
  readonly position: number
}

interface CreateTeamValues {
  readonly name: string
  readonly purpose: string
}

const DEPARTMENTS: readonly DepartmentKey[] = [
  'planning',
  'design',
  'frontend-a',
  'frontend-b',
  'integration',
  'verification',
  'repair',
]

/** Render the user-owned Team library and its runtime-member editor. */
export function MyTeamsPage() {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [createForm] = Form.useForm<CreateTeamValues>()
  const [page, setPage] = useState<AgentTeamPageView>()
  const [definitions, setDefinitions] = useState<readonly AgentDefinitionView[]>([])
  const [selectedTeam, setSelectedTeam] = useState<AgentTeamView>()
  const [versions, setVersions] = useState<readonly AgentTeamVersionView[]>([])
  const [members, setMembers] = useState<DraftMember[]>([])
  const [editorVersion, setEditorVersion] = useState('1.0.0')
  const [draftId, setDraftId] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [pending, setPending] = useState<'create' | 'load' | 'save' | 'publish'>()
  const [error, setError] = useState<string>()

  const publishedAgents = definitions.flatMap(definition => (
    definition.versions
      .filter(version => version.status === 'PUBLISHED')
      .map(version => ({
        definition,
        version,
        value: version.id,
        label: `${definition.name} · ${version.version}`,
      }))
  ))

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    setPending('load')
    setError(undefined)
    try {
      const [nextPage, nextDefinitions] = await Promise.all([
        api.listTeams(),
        api.listAgentDefinitions(),
      ])
      setPage(nextPage)
      setDefinitions(nextDefinitions)
      const nextTeam = selectedTeam === undefined
        ? nextPage.items[0]
        : nextPage.items.find(team => team.id === selectedTeam.id) ?? nextPage.items[0]
      setSelectedTeam(nextTeam)
      if (nextTeam !== undefined) await loadVersions(nextTeam)
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.myTeams.loadError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function loadVersions(team: AgentTeamView): Promise<void> {
    const nextVersions = await api.listTeamVersions(team.id)
    setVersions(nextVersions)
  }

  async function create(values: CreateTeamValues): Promise<void> {
    setPending('create')
    setError(undefined)
    try {
      const team = await api.createTeam(values)
      message.success(dictionary.myTeams.created)
      setCreateOpen(false)
      createForm.resetFields()
      setSelectedTeam(team)
      await load()
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.myTeams.createError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function openEditor(team: AgentTeamView): Promise<void> {
    setSelectedTeam(team)
    setPending('load')
    setError(undefined)
    try {
      const nextVersions = await api.listTeamVersions(team.id)
      setVersions(nextVersions)
      const latest = nextVersions.at(-1)
      setEditorVersion(nextVersion(nextVersions))
      setDraftId(undefined)
      setMembers(latest?.members.map(member => ({
        rowId: member.instanceId,
        agentVersionId: member.agentVersionId,
        displayName: member.displayName,
        departmentKey: member.departmentKey,
        position: member.position,
      })) ?? [])
      setEditorOpen(true)
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.myTeams.loadError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  function addMember(): void {
    if (members.length >= 7 || publishedAgents.length === 0) return
    const first = publishedAgents[0]
    if (first === undefined) return
    setMembers(current => [...current, {
      rowId: `member:${String(Date.now())}:${String(current.length)}`,
      agentVersionId: first.value,
      displayName: `${first.definition.name} ${String(current.length + 1)}`,
      departmentKey: 'planning',
      position: current.length + 1,
    }])
  }

  function updateMember(
    rowId: string,
    patch: Partial<Omit<DraftMember, 'rowId'>>,
  ): void {
    setMembers(current => current.map(member => (
      member.rowId === rowId ? { ...member, ...patch } : member
    )))
  }

  function removeMember(rowId: string): void {
    setMembers(current => current.filter(member => member.rowId !== rowId))
  }

  async function saveDraft(): Promise<void> {
    if (selectedTeam === undefined || members.length < 1) return
    setPending('save')
    setError(undefined)
    try {
      const draft = await api.createTeamDraft(selectedTeam.id, {
        version: editorVersion,
        members: members.map(member => ({
          agentVersionId: member.agentVersionId,
          displayName: member.displayName,
          departmentKey: member.departmentKey,
          position: member.position,
        })),
      })
      setDraftId(draft.id)
      setVersions(current => [...current, draft])
      message.success(dictionary.myTeams.saved)
      await load()
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.myTeams.saveError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function publishDraft(): Promise<void> {
    if (selectedTeam === undefined || draftId === undefined) return
    setPending('publish')
    setError(undefined)
    try {
      await api.publishTeamVersion(selectedTeam.id, draftId)
      message.success(dictionary.myTeams.published)
      setDraftId(undefined)
      await load()
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.myTeams.publishError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <div className="page-stack my-teams-page">
      <PageHeading
        title={dictionary.myTeams.title}
        description={dictionary.myTeams.description}
        actions={(
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setCreateOpen(true) }}
          >
            {dictionary.myTeams.create}
          </Button>
        )}
      />
      {error === undefined ? null : (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => { setError(undefined) }}
        />
      )}
      <div className="my-teams-layout">
        <section className="section-panel my-teams-list-panel">
          {page === undefined || page.items.length === 0 ? (
            <Empty description={dictionary.myTeams.empty} />
          ) : (
            <List
              dataSource={page.items}
              renderItem={team => (
                <List.Item
                  className={team.id === selectedTeam?.id ? 'my-team-row selected' : 'my-team-row'}
                  actions={[
                    <Tooltip key="edit" title={dictionary.myTeams.edit}>
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={dictionary.myTeams.edit}
                        disabled={team.status === 'ARCHIVED'}
                        onClick={() => { void openEditor(team) }}
                      />
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<TeamOutlined />}
                    title={(
                      <Space size={6} wrap>
                        <span>{team.name}</span>
                        <Tag>{statusLabel(team.status, dictionary)}</Tag>
                      </Space>
                    )}
                    description={(
                      <Space size={12} wrap>
                        <span>{team.purpose}</span>
                        <span>{dictionary.myTeams.members}: {team.latestVersion?.members.length ?? 0}</span>
                        <span>{dictionary.myTeams.versions}: {team.versionCount}</span>
                        <span>{dictionary.myTeams.usage}: {team.projectUsageCount}</span>
                      </Space>
                    )}
                  />
                </List.Item>
              )}
            />
          )}
        </section>
        <section className="section-panel my-teams-detail-panel">
          {selectedTeam === undefined ? (
            <Empty description={dictionary.myTeams.empty} />
          ) : (
            <>
              <div className="section-panel-heading">
                <h3>{selectedTeam.name}</h3>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  disabled={selectedTeam.status === 'ARCHIVED'}
                  onClick={() => { void openEditor(selectedTeam) }}
                >
                  {dictionary.myTeams.edit}
                </Button>
              </div>
              <p className="my-teams-purpose">{selectedTeam.purpose}</p>
              <div className="my-teams-summary">
                <span>{dictionary.myTeams.members}: {selectedTeam.latestVersion?.members.length ?? 0}</span>
                <span>{dictionary.myTeams.versions}: {versions.length}</span>
                <span>{dictionary.myTeams.usage}: {selectedTeam.projectUsageCount}</span>
              </div>
              <h3>{dictionary.myTeams.versions}</h3>
              {versions.length === 0 ? (
                <Empty description={dictionary.myTeams.empty} />
              ) : (
                <List
                  dataSource={[...versions].reverse()}
                  renderItem={version => (
                    <List.Item>
                      <List.Item.Meta
                        title={(
                          <Space size={6}>
                            <span>{version.version}</span>
                            <Tag>{version.status === 'PUBLISHED'
                              ? dictionary.myTeams.publishedStatus
                              : dictionary.myTeams.draft}</Tag>
                          </Space>
                        )}
                        description={`${version.members.length} ${dictionary.myTeams.members}`}
                      />
                    </List.Item>
                  )}
                />
              )}
            </>
          )}
        </section>
      </div>

      <Modal
        title={dictionary.myTeams.createTitle}
        open={createOpen}
        confirmLoading={pending === 'create'}
        onCancel={() => { setCreateOpen(false) }}
        onOk={() => { createForm.submit() }}
        okText={dictionary.myTeams.create}
        cancelText={dictionary.common.cancel}
      >
        <Form<CreateTeamValues>
          form={createForm}
          layout="vertical"
          onFinish={(values) => { void create(values) }}
        >
          <Form.Item
            name="name"
            label={dictionary.myTeams.name}
            rules={[{ required: true, message: dictionary.myTeams.name }]}
          >
            <Input maxLength={160} placeholder={dictionary.myTeams.namePlaceholder} />
          </Form.Item>
          <Form.Item
            name="purpose"
            label={dictionary.myTeams.purpose}
            rules={[{ required: true, message: dictionary.myTeams.purpose }]}
          >
            <Input.TextArea rows={3} maxLength={4_000} placeholder={dictionary.myTeams.purposePlaceholder} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${dictionary.myTeams.edit} · ${selectedTeam?.name ?? ''}`}
        open={editorOpen}
        width={760}
        onCancel={() => { setEditorOpen(false) }}
        footer={[
          <Button key="cancel" onClick={() => { setEditorOpen(false) }}>
            {dictionary.common.cancel}
          </Button>,
          <Button
            key="save"
            icon={<SaveOutlined />}
            loading={pending === 'save'}
            disabled={members.length < 1}
            onClick={() => { void saveDraft() }}
          >
            {dictionary.myTeams.saveDraft}
          </Button>,
          <Button
            key="publish"
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={pending === 'publish'}
            disabled={draftId === undefined}
            onClick={() => { void publishDraft() }}
          >
            {dictionary.myTeams.publish}
          </Button>,
        ]}
      >
        <div className="my-team-editor">
          <label className="team-builder-label" htmlFor="team-version">
            {dictionary.myTeams.version}
          </label>
          <Input
            id="team-version"
            value={editorVersion}
            onChange={(event) => { setEditorVersion(event.target.value) }}
          />
          <div className="my-team-editor-heading">
            <span>{dictionary.myTeams.members} ({members.length}/7)</span>
            <Tooltip title={members.length >= 7 ? dictionary.myTeams.maxMembers : dictionary.myTeams.addMember}>
              <Button
                type="text"
                icon={<PlusOutlined />}
                aria-label={dictionary.myTeams.addMember}
                disabled={members.length >= 7 || publishedAgents.length === 0}
                onClick={addMember}
              />
            </Tooltip>
          </div>
          {publishedAgents.length === 0 ? (
            <Alert type="warning" showIcon title={dictionary.myTeams.noAgents} />
          ) : null}
          {members.map(member => (
            <div className="my-team-editor-row" key={member.rowId}>
              <Select
                value={member.agentVersionId}
                options={publishedAgents.map(agent => ({
                  value: agent.value,
                  label: agent.label,
                }))}
                aria-label={dictionary.myTeams.agent}
                onChange={(value: string) => {
                  const selected = publishedAgents.find(agent => agent.value === value)
                  updateMember(member.rowId, {
                    agentVersionId: value,
                    ...selected === undefined
                      ? {}
                      : { displayName: selected.definition.name },
                  })
                }}
              />
              <Input
                value={member.displayName}
                aria-label={dictionary.myTeams.displayName}
                placeholder={dictionary.myTeams.displayName}
                onChange={(event) => {
                  updateMember(member.rowId, { displayName: event.target.value })
                }}
              />
              <Select
                value={member.departmentKey}
                options={DEPARTMENTS.map(department => ({
                  value: department,
                  label: dictionary.myTeams.departments[department],
                }))}
                aria-label={dictionary.myTeams.department}
                onChange={(value: DepartmentKey) => {
                  updateMember(member.rowId, { departmentKey: value })
                }}
              />
              <InputNumber
                min={1}
                max={64}
                value={member.position}
                aria-label={dictionary.myTeams.position}
                onChange={(value) => {
                  updateMember(member.rowId, { position: value ?? 1 })
                }}
              />
              <Tooltip title={dictionary.myTeams.removeMember}>
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={dictionary.myTeams.removeMember}
                  onClick={() => { removeMember(member.rowId) }}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function nextVersion(versions: readonly AgentTeamVersionView[]): string {
  const latest = versions.at(-1)?.version
  if (latest === undefined) return '1.0.0'
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(latest)
  if (match === null) return latest
  return `${match[1]}.${match[2]}.${String(Number(match[3]) + 1)}`
}

function statusLabel(
  status: AgentTeamView['status'],
  dictionary: ReturnType<typeof useLocale>['dictionary'],
): string {
  switch (status) {
    case 'ACTIVE':
      return dictionary.myTeams.active
    case 'ARCHIVED':
      return dictionary.myTeams.archived
  }
}
