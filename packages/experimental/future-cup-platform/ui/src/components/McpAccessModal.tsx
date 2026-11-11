import {
  ApiOutlined,
  CopyOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { McpServerInfoResponseView } from '../api/contracts.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

/** Props for the Future Cup MCP integration guide modal. */
export interface McpAccessModalProps {
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * Modal displaying the live Future Cup MCP endpoint, client configuration JSON,
 * and the catalog of exposed MCP tools, resources, and workflow prompts.
 */
export function McpAccessModal({
  open,
  onClose,
}: McpAccessModalProps) {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [serverInfo, setServerInfo] = useState<McpServerInfoResponseView | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void api.getMcpServerInfo()
      .then((info) => {
        if (active) setServerInfo(info)
      })
      .catch((error: unknown) => {
        const errorText = error instanceof Error ? error.message : dictionary.mcp.loadFailed
        message.error(errorText)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [open, dictionary.mcp.loadFailed, message])

  const origin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'http://127.0.0.1:3090'
  const endpointUrl = `${origin}${serverInfo?.endpointPath ?? '/api/v1/mcp'}`
  const clientConfigJson = JSON.stringify({
    mcpServers: {
      [serverInfo?.name ?? 'future-cup-platform-mcp']: {
        type: 'http',
        url: endpointUrl,
      },
    },
  }, null, 2)

  const copyToClipboard = (text: string, toastMessage: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      message.success(toastMessage)
    }
  }

  return (
    <Modal
      open={open}
      title={(
        <Space>
          <ApiOutlined style={{ color: '#1677ff' }} />
          <span>{dictionary.mcp.modalTitle}</span>
        </Space>
      )}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {dictionary.common.close}
        </Button>,
      ]}
      width={780}
      destroyOnHidden
    >
      <div className="page-stack" style={{ gap: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          {dictionary.mcp.modalDescription}
        </Typography.Paragraph>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin aria-label={dictionary.common.loading} />
          </div>
        ) : (
          <>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label={dictionary.mcp.endpointLabel}>
                <Space wrap>
                  <Typography.Text code>{endpointUrl}</Typography.Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => { copyToClipboard(endpointUrl, dictionary.mcp.copiedEndpoint) }}
                  >
                    {dictionary.mcp.copyEndpoint}
                  </Button>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={dictionary.mcp.protocolLabel}>
                <Tag color="blue">{serverInfo?.protocolVersion ?? '-'}</Tag>
              </Descriptions.Item>
            </Descriptions>

            <Card
              size="small"
              title={dictionary.mcp.configTitle}
              extra={(
                <Button
                  size="small"
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={() => { copyToClipboard(clientConfigJson, dictionary.mcp.copiedConfig) }}
                >
                  {dictionary.mcp.copyConfig}
                </Button>
              )}
            >
              <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto' }}>
                <code>{clientConfigJson}</code>
              </pre>
            </Card>

            {serverInfo === undefined ? null : (
              <Tabs
                items={[
                  {
                    key: 'tools',
                    label: (
                      <Space size={6}>
                        <ToolOutlined />
                        <span>{`${dictionary.mcp.tabTools} (${String(serverInfo.tools.length)})`}</span>
                      </Space>
                    ),
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                        {serverInfo.tools.map(tool => (
                          <Card key={tool.name} size="small">
                            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                              <Typography.Text strong code>{tool.name}</Typography.Text>
                              <Typography.Text type="secondary">{tool.description}</Typography.Text>
                            </Space>
                          </Card>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    key: 'resources',
                    label: (
                      <Space size={6}>
                        <DatabaseOutlined />
                        <span>{`${dictionary.mcp.tabResources} (${String(serverInfo.resources.length)})`}</span>
                      </Space>
                    ),
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                        {serverInfo.resources.map(resource => (
                          <Card key={resource.uri} size="small">
                            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                              <Space wrap>
                                <Typography.Text strong code>{resource.uri}</Typography.Text>
                                <Tag color={resource.isTemplate ? 'purple' : 'green'}>
                                  {resource.isTemplate
                                    ? dictionary.mcp.resourceTemplateTag
                                    : dictionary.mcp.resourceStaticTag}
                                </Tag>
                              </Space>
                              <Typography.Text>{resource.name}</Typography.Text>
                              <Typography.Text type="secondary">{resource.description}</Typography.Text>
                            </Space>
                          </Card>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    key: 'prompts',
                    label: (
                      <Space size={6}>
                        <ThunderboltOutlined />
                        <span>{`${dictionary.mcp.tabPrompts} (${String(serverInfo.prompts.length)})`}</span>
                      </Space>
                    ),
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                        {serverInfo.prompts.map(prompt => (
                          <Card key={prompt.name} size="small">
                            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                              <Typography.Text strong code>{prompt.name}</Typography.Text>
                              <Typography.Text type="secondary">{prompt.description}</Typography.Text>
                              <Space wrap>
                                {prompt.arguments.map(arg => (
                                  <Tag key={arg.name} color={arg.required ? 'gold' : 'default'}>
                                    {`${arg.name} (${arg.required ? dictionary.mcp.promptRequiredArg : dictionary.mcp.promptOptionalArg})`}
                                  </Tag>
                                ))}
                              </Space>
                            </Space>
                          </Card>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Header action button that opens the Future Cup MCP integration guide modal. */
export function McpAccessButton() {
  const [open, setOpen] = useState(false)
  const { dictionary } = useLocale()

  return (
    <>
      <Tooltip title={dictionary.mcp.buttonLabel}>
        <Button
          type="default"
          size="small"
          icon={<ApiOutlined />}
          aria-label={dictionary.mcp.buttonLabel}
          onClick={() => { setOpen(true) }}
        >
          {dictionary.mcp.buttonLabel}
        </Button>
      </Tooltip>
      <McpAccessModal
        open={open}
        onClose={() => { setOpen(false) }}
      />
    </>
  )
}
