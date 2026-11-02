import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.ts'
import type {
  AgentDefinitionView,
  AgentRoleTemplateView,
  AgentVersionView,
} from '../api/contracts.ts'
import { localizedApiError } from '../api/errors.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'

const { Paragraph, Text } = Typography

const CONTROLLED_ROLES = [
  'planner',
  'ui-designer',
  'frontend',
  'integration',
  'tester',
  'repair',
  'verifier',
] as const

type ControlledRole = typeof CONTROLLED_ROLES[number]

const ROLE_PRIMARY_CAPABILITY: Readonly<Record<ControlledRole, string>> = {
  planner: 'planning',
  'ui-designer': 'design',
  frontend: 'frontend',
  integration: 'integration',
  tester: 'testing',
  repair: 'repair',
  verifier: 'verification',
}

const MODEL_OPTIONS = [
  { value: 'deepseek-flash', label: 'deepseek-flash' },
  { value: 'deepseek-chat', label: 'deepseek-chat' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
]

function isControlledRole(value: string): value is ControlledRole {
  return (CONTROLLED_ROLES as readonly string[]).includes(value)
}

function nextSemanticVersion(current?: string): string {
  if (current === undefined) return '1.0.0'
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(current.trim())
  if (match === null) return `${current}-next`
  return `${String(match[1])}.${String(Number(match[2]) + 1)}.0`
}

function statusTagColor(status: string): string {
  switch (status) {
    case 'PUBLISHED':
      return 'success'
    case 'VALIDATED':
      return 'processing'
    case 'DEPRECATED':
      return 'error'
    default:
      return 'default'
  }
}

function parseTags(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[,，\s]+/u)
      .map(tag => tag.trim().toLowerCase().replace(/[^a-z0-9._:-]/gu, '-'))
      .filter(tag => /^[a-z0-9][a-z0-9._:-]*$/u.test(tag)),
  )]
}

function sanitizeAgentId(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  return trimmed
}

/** Browse built-in and custom Agent definitions, manage versions, and customize prompts. */
export function AgentsPage() {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [definitions, setDefinitions] = useState<AgentDefinitionView[]>([])
  const [templates, setTemplates] = useState<AgentRoleTemplateView[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const [modalError, setModalError] = useState<string>()

  // Create custom Agent modal state
  const [createOpen, setCreateOpen] = useState(false)
  const [customId, setCustomId] = useState('')
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [role, setRole] = useState<ControlledRole>('frontend')
  const [version, setVersion] = useState('1.0.0')
  const [model, setModel] = useState('deepseek-flash')
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [memoryAccess, setMemoryAccess] = useState<'NONE' | 'READ' | 'WRITE'>('READ')
  const [capabilityWeight, setCapabilityWeight] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [autoPublish, setAutoPublish] = useState(true)

  // New version modal state
  const [versionOpen, setVersionOpen] = useState(false)

  // Edit metadata modal state
  const [editMetaOpen, setEditMetaOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPurpose, setEditPurpose] = useState('')
  const [editTagsText, setEditTagsText] = useState('')

  const templateByRole = useMemo(() => {
    const map = new Map<string, AgentRoleTemplateView>()
    for (const item of templates) {
      map.set(item.role, item)
    }
    return map
  }, [templates])

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true)
    try {
      const [loadedDefinitions, loadedTemplates] = await Promise.all([
        api.listAgentDefinitions(),
        api.listAgentRoleTemplates().catch(() => []),
      ])
      setDefinitions(loadedDefinitions)
      setTemplates(loadedTemplates)
      setError(undefined)
      setSelectedId((current) => {
        const target = preferredId ?? current
        if (target !== undefined && loadedDefinitions.some(item => item.id === target)) {
          return target
        }
        return loadedDefinitions[0]?.id
      })
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.errors.loadAgents,
      ))
    } finally {
      setLoading(false)
    }
  }, [dictionary.errors])

  useEffect(() => {
    void load()
  }, [load])

  const selectedDefinition = useMemo(
    () => definitions.find(item => item.id === selectedId) ?? definitions[0],
    [definitions, selectedId],
  )

  const filteredDefinitions = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return definitions.filter((definition) => {
      const versions = definition.versions ?? []
      const matchesRole = roleFilter === 'ALL'
        || versions.some(item => item.role === roleFilter)
      if (!matchesRole) return false
      if (query === '') return true
      return definition.name.toLowerCase().includes(query)
        || definition.id.toLowerCase().includes(query)
        || definition.purpose.toLowerCase().includes(query)
        || definition.discoveryTags.some(tag => tag.toLowerCase().includes(query))
    })
  }, [definitions, roleFilter, searchText])

  function applyRoleTemplate(nextRole: ControlledRole): void {
    setRole(nextRole)
    const tpl = templateByRole.get(nextRole)
    const capName = ROLE_PRIMARY_CAPABILITY[nextRole]
    if (tpl !== undefined) {
      setModel(tpl.defaultModel)
      setPrompt(tpl.defaultPrompt)
      setMaxConcurrency(tpl.defaultMaxConcurrency)
      setMemoryAccess(tpl.defaultMemoryPolicy.access)
      setCapabilityWeight(tpl.defaultCapabilities[capName] ?? 1)
      if (tagsText.trim() === '') {
        setTagsText(tpl.defaultTags.join(', '))
      }
    }
  }

  function openCreateModal(source?: AgentDefinitionView): void {
    setModalError(undefined)
    const latestVersion = source?.versions?.[source.versions.length - 1]
    const initialRole: ControlledRole = latestVersion !== undefined && isControlledRole(latestVersion.role)
      ? latestVersion.role
      : 'frontend'
    const tpl = templateByRole.get(initialRole)
    const capName = ROLE_PRIMARY_CAPABILITY[initialRole]
    setRole(initialRole)
    setCustomId('')
    if (source !== undefined) {
      setName(`${source.name} Pro`)
      setPurpose(source.purpose)
      setTagsText(source.discoveryTags.join(', '))
      setVersion('1.0.0')
      setModel(latestVersion?.model ?? tpl?.defaultModel ?? 'deepseek-flash')
      setMaxConcurrency(latestVersion?.maxConcurrency ?? tpl?.defaultMaxConcurrency ?? 1)
      setMemoryAccess(latestVersion?.memoryPolicy?.access ?? tpl?.defaultMemoryPolicy.access ?? 'READ')
      setCapabilityWeight(latestVersion?.capabilities[capName] ?? 1)
      setPrompt(latestVersion?.prompt ?? tpl?.defaultPrompt ?? '')
    } else {
      setName('')
      setPurpose(tpl?.defaultPurpose ?? '')
      setTagsText((tpl?.defaultTags ?? [initialRole]).join(', '))
      setVersion('1.0.0')
      setModel(tpl?.defaultModel ?? 'deepseek-flash')
      setMaxConcurrency(tpl?.defaultMaxConcurrency ?? 1)
      setMemoryAccess(tpl?.defaultMemoryPolicy.access ?? 'READ')
      setCapabilityWeight(tpl?.defaultCapabilities[capName] ?? 1)
      setPrompt(tpl?.defaultPrompt ?? '')
    }
    setAutoPublish(true)
    setCreateOpen(true)
  }

  function openNewVersionModal(definition: AgentDefinitionView): void {
    setModalError(undefined)
    const versions = definition.versions ?? []
    const latest = versions[versions.length - 1]
    const initialRole: ControlledRole = latest !== undefined && isControlledRole(latest.role)
      ? latest.role
      : 'frontend'
    const tpl = templateByRole.get(initialRole)
    const capName = ROLE_PRIMARY_CAPABILITY[initialRole]
    setRole(initialRole)
    setVersion(nextSemanticVersion(latest?.version))
    setModel(latest?.model ?? tpl?.defaultModel ?? 'deepseek-flash')
    setMaxConcurrency(latest?.maxConcurrency ?? tpl?.defaultMaxConcurrency ?? 1)
    setMemoryAccess(latest?.memoryPolicy?.access ?? tpl?.defaultMemoryPolicy.access ?? 'READ')
    setCapabilityWeight(latest?.capabilities[capName] ?? 1)
    setPrompt(latest?.prompt ?? tpl?.defaultPrompt ?? '')
    setAutoPublish(true)
    setVersionOpen(true)
  }

  function openEditMetaModal(definition: AgentDefinitionView): void {
    setModalError(undefined)
    setEditName(definition.name)
    setEditPurpose(definition.purpose)
    setEditTagsText(definition.discoveryTags.join(', '))
    setEditMetaOpen(true)
  }

  function buildMemoryPolicy(access: 'NONE' | 'READ' | 'WRITE', targetRole: ControlledRole) {
    if (access === 'NONE') {
      return { access: 'NONE' as const, kinds: [] as const }
    }
    const tpl = templateByRole.get(targetRole)
    const kinds = tpl?.defaultMemoryPolicy.kinds.length
      ? tpl.defaultMemoryPolicy.kinds
      : (['requirement', 'design-decision'] as const)
    return { access, kinds }
  }

  async function handleCreateAgent(): Promise<void> {
    if (name.trim() === '' || purpose.trim() === '' || prompt.trim() === '') return
    setPending('create')
    setModalError(undefined)
    try {
      const capName = ROLE_PRIMARY_CAPABILITY[role]
      const tags = parseTags(tagsText)
      const id = sanitizeAgentId(customId)
      const created = await api.createAgentDefinition({
        ...(id === undefined ? {} : { id }),
        name: name.trim(),
        purpose: purpose.trim(),
        discoveryTags: tags.length > 0 ? tags : [role === 'ui-designer' ? 'design' : role],
      })
      await api.createAgentVersion(created.id, {
        version: version.trim() || '1.0.0',
        role,
        model: model.trim() || 'deepseek-flash',
        prompt: prompt.trim(),
        capabilities: { [capName]: capabilityWeight },
        memoryPolicy: buildMemoryPolicy(memoryAccess, role),
        maxConcurrency,
        autoPublish,
      })
      message.success(autoPublish ? dictionary.agents.published : dictionary.agents.created)
      setCreateOpen(false)
      await load(created.id)
    } catch (operationError: unknown) {
      setModalError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.createError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function handleCreateVersion(): Promise<void> {
    if (selectedDefinition === undefined || prompt.trim() === '') return
    setPending('new-version')
    setModalError(undefined)
    try {
      const capName = ROLE_PRIMARY_CAPABILITY[role]
      await api.createAgentVersion(selectedDefinition.id, {
        version: version.trim() || '1.1.0',
        role,
        model: model.trim() || 'deepseek-flash',
        prompt: prompt.trim(),
        capabilities: { [capName]: capabilityWeight },
        memoryPolicy: buildMemoryPolicy(memoryAccess, role),
        maxConcurrency,
        autoPublish,
      })
      message.success(dictionary.agents.published)
      setVersionOpen(false)
      await load(selectedDefinition.id)
    } catch (operationError: unknown) {
      setModalError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.publishError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function handleUpdateMeta(): Promise<void> {
    if (selectedDefinition === undefined || editName.trim() === '' || editPurpose.trim() === '') {
      return
    }
    setPending('edit-meta')
    setModalError(undefined)
    try {
      const tags = parseTags(editTagsText)
      await api.updateAgentDefinition(selectedDefinition.id, {
        name: editName.trim(),
        purpose: editPurpose.trim(),
        ...(tags.length > 0 ? { discoveryTags: tags } : {}),
      })
      message.success(dictionary.agents.updated)
      setEditMetaOpen(false)
      await load(selectedDefinition.id)
    } catch (operationError: unknown) {
      setModalError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.updateError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function handleValidateAndPublish(
    definition: AgentDefinitionView,
    targetVersion: AgentVersionView,
  ): Promise<void> {
    setPending(`publish:${targetVersion.id}`)
    setError(undefined)
    try {
      if (targetVersion.status === 'DRAFT') {
        await api.validateAgentVersion(definition.id, targetVersion.id)
      }
      await api.publishAgentVersion(definition.id, targetVersion.id)
      message.success(dictionary.agents.published)
      await load(definition.id)
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.publishError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function handleDeprecate(definition: AgentDefinitionView): Promise<void> {
    setPending(`deprecate:${definition.id}`)
    setError(undefined)
    try {
      await api.deprecateAgentDefinition(definition.id)
      message.success(dictionary.agents.deprecated)
      await load(definition.id)
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.deprecateError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  async function handleDelete(definition: AgentDefinitionView): Promise<void> {
    setPending(`delete:${definition.id}`)
    setError(undefined)
    try {
      await api.deleteAgentDefinition(definition.id)
      message.success(dictionary.agents.deleted)
      await load()
    } catch (operationError: unknown) {
      setError(localizedApiError(
        operationError,
        dictionary.errors,
        dictionary.agents.deleteError,
      ))
    } finally {
      setPending(undefined)
    }
  }

  function roleLabel(roleValue: string): string {
    if (isControlledRole(roleValue)) {
      return dictionary.teamBuilder.roles[roleValue]
    }
    return roleValue
  }

  function statusLabel(statusValue: string): string {
    const labels = dictionary.agents.statusLabels as Readonly<Record<string, string>>
    return labels[statusValue] ?? statusValue
  }

  return (
    <div className="page-stack agents-page">
      <PageHeading
        title={dictionary.agents.title}
        description={dictionary.agents.description}
        actions={(
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => { void load(selectedDefinition?.id) }}
            >
              {dictionary.common.refresh}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { openCreateModal() }}
            >
              {dictionary.agents.create}
            </Button>
          </Space>
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

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card>
            <Space orientation="vertical" style={{ width: '100%', marginBottom: 12 }} size={8}>
              <Row gutter={8}>
                <Col span={10}>
                  <Select
                    style={{ width: '100%' }}
                    value={roleFilter}
                    onChange={(value) => { setRoleFilter(value) }}
                    options={[
                      { value: 'ALL', label: dictionary.agents.filterAllRoles },
                      ...CONTROLLED_ROLES.map(item => ({
                        value: item,
                        label: dictionary.teamBuilder.roles[item],
                      })),
                    ]}
                  />
                </Col>
                <Col span={14}>
                  <Input.Search
                    allowClear
                    value={searchText}
                    onChange={(event) => { setSearchText(event.target.value) }}
                    placeholder={dictionary.agents.searchPlaceholder}
                  />
                </Col>
              </Row>
            </Space>

            {filteredDefinitions.length === 0 && !loading ? (
              <EmptyPanel text={dictionary.agents.empty} />
            ) : (
              <List
                loading={loading}
                dataSource={filteredDefinitions}
                renderItem={(definition) => {
                  const versions = definition.versions ?? []
                  const latest = versions[versions.length - 1]
                  const isBuiltin = definition.builtin === true
                  const inUse = (definition.usageCount ?? 0) > 0
                  const canDelete = !isBuiltin && !inUse
                  const deleteHint = isBuiltin
                    ? dictionary.agents.builtinProtectedHint
                    : inUse
                      ? dictionary.agents.inUseHint
                      : dictionary.agents.deleteAgent
                  return (
                    <List.Item
                      className={selectedDefinition?.id === definition.id
                        ? 'my-team-row my-team-row-active'
                        : 'my-team-row'}
                      onClick={() => { setSelectedId(definition.id) }}
                      actions={[
                        <Tooltip key="clone" title={dictionary.agents.clone}>
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            aria-label={`${dictionary.agents.clone} ${definition.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              openCreateModal(definition)
                            }}
                          />
                        </Tooltip>,
                        <Tooltip key="delete" title={deleteHint}>
                          <Button
                            type="text"
                            size="small"
                            danger
                            disabled={!canDelete}
                            icon={<DeleteOutlined />}
                            loading={pending === `delete:${definition.id}`}
                            aria-label={`${dictionary.agents.deleteAgent} ${definition.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDelete(definition)
                            }}
                          />
                        </Tooltip>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<RobotOutlined />}
                        title={(
                          <Space wrap size={6}>
                            <Text strong>{definition.name}</Text>
                            <Tag color={isBuiltin ? 'blue' : 'cyan'}>
                              {isBuiltin ? dictionary.agents.builtinTag : dictionary.agents.customTag}
                            </Tag>
                            {latest === undefined ? null : (
                              <Tag color="geekblue">{roleLabel(latest.role)}</Tag>
                            )}
                            <Tag color={statusTagColor(definition.status)}>
                              {statusLabel(definition.status)}
                            </Tag>
                          </Space>
                        )}
                        description={(
                          <Space orientation="vertical" size={2}>
                            <Text type="secondary">{definition.purpose}</Text>
                            <Space size={12} wrap>
                              <Text type="secondary">ID: {definition.id}</Text>
                              <Text type="secondary">
                                {dictionary.agents.versionsTitle}: {String(versions.length)}
                              </Text>
                              <Text type="secondary">
                                {dictionary.agents.usageCount}: {String(definition.usageCount ?? 0)}
                              </Text>
                            </Space>
                          </Space>
                        )}
                      />
                    </List.Item>
                  )
                }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          {selectedDefinition === undefined ? (
            <Card>
              <Empty description={dictionary.agents.empty} />
            </Card>
          ) : (
            <Card
              title={(
                <Space wrap>
                  <Text strong>{selectedDefinition.name}</Text>
                  <Tag color={selectedDefinition.builtin === true ? 'blue' : 'cyan'}>
                    {selectedDefinition.builtin === true
                      ? dictionary.agents.builtinTag
                      : dictionary.agents.customTag}
                  </Tag>
                  <Tag color={statusTagColor(selectedDefinition.status)}>
                    {statusLabel(selectedDefinition.status)}
                  </Tag>
                </Space>
              )}
              extra={(
                <Space wrap>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => { openCreateModal(selectedDefinition) }}
                  >
                    {dictionary.agents.clone}
                  </Button>
                  {selectedDefinition.status === 'DRAFT' || selectedDefinition.status === 'VALIDATED' ? (
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => { openEditMetaModal(selectedDefinition) }}
                    >
                      {dictionary.agents.editMeta}
                    </Button>
                  ) : null}
                  {selectedDefinition.status === 'DEPRECATED' ? null : (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => { openNewVersionModal(selectedDefinition) }}
                    >
                      {dictionary.agents.newVersion}
                    </Button>
                  )}
                  {selectedDefinition.status === 'PUBLISHED' && selectedDefinition.builtin !== true ? (
                    <Button
                      danger
                      icon={<StopOutlined />}
                      loading={pending === `deprecate:${selectedDefinition.id}`}
                      onClick={() => { void handleDeprecate(selectedDefinition) }}
                    >
                      {dictionary.agents.deprecate}
                    </Button>
                  ) : null}
                  {selectedDefinition.builtin !== true && (selectedDefinition.usageCount ?? 0) === 0 ? (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={pending === `delete:${selectedDefinition.id}`}
                      onClick={() => { void handleDelete(selectedDefinition) }}
                    >
                      {dictionary.agents.deleteAgent}
                    </Button>
                  ) : null}
                </Space>
              )}
            >
              <Paragraph>{selectedDefinition.purpose}</Paragraph>
              <Space wrap style={{ marginBottom: 16 }}>
                <Tag>ID: {selectedDefinition.id}</Tag>
                {selectedDefinition.discoveryTags.map(tag => (
                  <Tag key={tag} color="default">#{tag}</Tag>
                ))}
              </Space>

              <Typography.Title level={5}>{dictionary.agents.versionsTitle}</Typography.Title>
              <List
                dataSource={selectedDefinition.versions ?? []}
                locale={{ emptyText: dictionary.common.noData }}
                renderItem={(ver) => {
                  const verStatus = ver.status ?? selectedDefinition.status
                  const canPublish = verStatus === 'DRAFT' || verStatus === 'VALIDATED'
                  return (
                    <List.Item
                      actions={canPublish ? [
                        <Button
                          key="publish"
                          type="primary"
                          size="small"
                          icon={<CheckCircleOutlined />}
                          loading={pending === `publish:${ver.id}`}
                          onClick={() => { void handleValidateAndPublish(selectedDefinition, ver) }}
                        >
                          {dictionary.agents.validateAndPublish}
                        </Button>,
                      ] : []}
                    >
                      <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                        <Space wrap>
                          <Text strong>{ver.version}</Text>
                          <Tag color="geekblue">{roleLabel(ver.role)}</Tag>
                          <Tag color={statusTagColor(verStatus)}>{statusLabel(verStatus)}</Tag>
                          <Tag>{dictionary.agents.model}: {ver.model}</Tag>
                          {ver.maxConcurrency === undefined ? null : (
                            <Tag>{dictionary.agents.maxConcurrency}: {String(ver.maxConcurrency)}</Tag>
                          )}
                          {ver.memoryPolicy === undefined ? null : (
                            <Tag>
                              {dictionary.agents.memoryAccess}: {
                                dictionary.teamBuilder.memoryAccess[ver.memoryPolicy.access]
                              }
                            </Tag>
                          )}
                        </Space>
                        <Space wrap size={4}>
                          {Object.entries(ver.capabilities).map(([cap, weight]) => (
                            <Tag key={cap} color="cyan">
                              {cap}: {String(weight)}
                            </Tag>
                          ))}
                        </Space>
                        {ver.prompt === undefined ? null : (
                          <Paragraph
                            style={{
                              marginBottom: 0,
                              padding: '8px 12px',
                              background: '#f6f8fa',
                              borderRadius: 6,
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'monospace',
                              fontSize: 12,
                            }}
                            ellipsis={{ rows: 3, expandable: true, symbol: dictionary.common.details }}
                          >
                            {ver.prompt}
                          </Paragraph>
                        )}
                      </Space>
                    </List.Item>
                  )
                }}
              />
            </Card>
          )}
        </Col>
      </Row>

      <Modal
        title={dictionary.agents.createTitle}
        open={createOpen}
        width={680}
        onCancel={() => {
          setCreateOpen(false)
          setModalError(undefined)
        }}
        onOk={() => { void handleCreateAgent() }}
        confirmLoading={pending === 'create'}
        okText={dictionary.common.confirm}
        cancelText={dictionary.common.cancel}
      >
        <Form layout="vertical">
          {modalError === undefined ? null : (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              title={modalError}
            />
          )}
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item label={dictionary.agents.role} required>
                <Select
                  value={role}
                  onChange={(nextRole: ControlledRole) => { applyRoleTemplate(nextRole) }}
                  options={CONTROLLED_ROLES.map(item => ({
                    value: item,
                    label: `${dictionary.teamBuilder.roles[item]} (${item})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={dictionary.agents.name} required>
                <Input
                  value={name}
                  onChange={(event) => { setName(event.target.value) }}
                  placeholder={dictionary.agents.namePlaceholder}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item label={dictionary.agents.id}>
                <Input
                  value={customId}
                  onChange={(event) => { setCustomId(event.target.value) }}
                  placeholder={dictionary.agents.idPlaceholder}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label={dictionary.agents.tags}>
                <Input
                  value={tagsText}
                  onChange={(event) => { setTagsText(event.target.value) }}
                  placeholder={dictionary.agents.tagsPlaceholder}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={dictionary.agents.purpose} required>
            <Input.TextArea
              rows={2}
              value={purpose}
              onChange={(event) => { setPurpose(event.target.value) }}
              placeholder={dictionary.agents.purposePlaceholder}
            />
          </Form.Item>

          <Row gutter={12}>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.version} required>
                <Input
                  value={version}
                  onChange={(event) => { setVersion(event.target.value) }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.model} required>
                <Select
                  value={model}
                  onChange={(value) => { setModel(value) }}
                  options={MODEL_OPTIONS}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.maxConcurrency}>
                <InputNumber
                  min={1}
                  max={16}
                  style={{ width: '100%' }}
                  value={maxConcurrency}
                  onChange={(value) => { setMaxConcurrency(value ?? 1) }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.capabilityWeight}>
                <InputNumber
                  min={0.1}
                  max={1}
                  step={0.1}
                  style={{ width: '100%' }}
                  value={capabilityWeight}
                  onChange={(value) => { setCapabilityWeight(value ?? 1) }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={dictionary.agents.memoryAccess}>
            <Select
              value={memoryAccess}
              onChange={(value) => { setMemoryAccess(value) }}
              options={[
                { value: 'NONE', label: dictionary.teamBuilder.memoryAccess.NONE },
                { value: 'READ', label: dictionary.teamBuilder.memoryAccess.READ },
                { value: 'WRITE', label: dictionary.teamBuilder.memoryAccess.WRITE },
              ]}
            />
          </Form.Item>

          <Form.Item
            label={(
              <Space>
                <span>{dictionary.agents.prompt}</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    const tpl = templateByRole.get(role)
                    if (tpl !== undefined) setPrompt(tpl.defaultPrompt)
                  }}
                >
                  {dictionary.agents.resetPrompt}
                </Button>
              </Space>
            )}
            required
          >
            <Input.TextArea
              rows={6}
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value) }}
              placeholder={dictionary.agents.promptPlaceholder}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Checkbox
              checked={autoPublish}
              onChange={(event) => { setAutoPublish(event.target.checked) }}
            >
              {dictionary.agents.autoPublish}
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${dictionary.agents.newVersionTitle}${selectedDefinition === undefined ? '' : ` · ${selectedDefinition.name}`}`}
        open={versionOpen}
        width={680}
        onCancel={() => {
          setVersionOpen(false)
          setModalError(undefined)
        }}
        onOk={() => { void handleCreateVersion() }}
        confirmLoading={pending === 'new-version'}
        okText={dictionary.common.confirm}
        cancelText={dictionary.common.cancel}
      >
        <Form layout="vertical">
          {modalError === undefined ? null : (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              title={modalError}
            />
          )}
          <Row gutter={12}>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.version} required>
                <Input
                  value={version}
                  onChange={(event) => { setVersion(event.target.value) }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.role} required>
                <Select
                  value={role}
                  onChange={(nextRole: ControlledRole) => { applyRoleTemplate(nextRole) }}
                  options={CONTROLLED_ROLES.map(item => ({
                    value: item,
                    label: dictionary.teamBuilder.roles[item],
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.model} required>
                <Select
                  value={model}
                  onChange={(value) => { setModel(value) }}
                  options={MODEL_OPTIONS}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item label={dictionary.agents.maxConcurrency}>
                <InputNumber
                  min={1}
                  max={16}
                  style={{ width: '100%' }}
                  value={maxConcurrency}
                  onChange={(value) => { setMaxConcurrency(value ?? 1) }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={dictionary.agents.prompt} required>
            <Input.TextArea
              rows={6}
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value) }}
              placeholder={dictionary.agents.promptPlaceholder}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Checkbox
              checked={autoPublish}
              onChange={(event) => { setAutoPublish(event.target.checked) }}
            >
              {dictionary.agents.autoPublish}
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={dictionary.agents.editMetaTitle}
        open={editMetaOpen}
        onCancel={() => {
          setEditMetaOpen(false)
          setModalError(undefined)
        }}
        onOk={() => { void handleUpdateMeta() }}
        confirmLoading={pending === 'edit-meta'}
        okText={dictionary.common.confirm}
        cancelText={dictionary.common.cancel}
      >
        <Form layout="vertical">
          {modalError === undefined ? null : (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              title={modalError}
            />
          )}
          <Form.Item label={dictionary.agents.name} required>
            <Input
              value={editName}
              onChange={(event) => { setEditName(event.target.value) }}
            />
          </Form.Item>
          <Form.Item label={dictionary.agents.purpose} required>
            <Input.TextArea
              rows={3}
              value={editPurpose}
              onChange={(event) => { setEditPurpose(event.target.value) }}
            />
          </Form.Item>
          <Form.Item label={dictionary.agents.tags}>
            <Input
              value={editTagsText}
              onChange={(event) => { setEditTagsText(event.target.value) }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
