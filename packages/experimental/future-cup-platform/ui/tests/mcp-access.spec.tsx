import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { McpAccessButton, McpAccessModal } from '../src/components/McpAccessModal.tsx'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { localeDictionaries } from '../src/locale/types.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderWithProviders(element: React.ReactElement) {
  return render(
    <LocaleProvider>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          {element}
        </AntApp>
      </ConfigProvider>
    </LocaleProvider>,
  )
}

const mockMcpServerInfo = {
  name: 'future-cup-platform-mcp',
  version: '1.0.0',
  protocolVersion: '2025-11-25',
  endpointPath: '/api/v1/mcp',
  tools: [
    {
      name: 'future_cup_recommend_team',
      description: 'Recommend a validated Agent team.',
      inputSchema: { type: 'object' },
    },
    {
      name: 'future_cup_start_run',
      description: 'Start the multi-Agent DAG execution.',
      inputSchema: { type: 'object' },
    },
  ],
  resources: [
    {
      uri: 'future-cup://projects',
      name: 'Future Cup Projects Catalog',
      description: 'All frontend engineering projects.',
      mimeType: 'application/json',
      isTemplate: false,
    },
    {
      uri: 'future-cup://projects/{projectId}/memory',
      name: 'Project Structured Memory',
      description: 'Structured project memory entries.',
      mimeType: 'application/json',
      isTemplate: true,
    },
  ],
  prompts: [
    {
      name: 'delegate-frontend-project',
      description: 'Recommend a specialized Agent team and launch execution.',
      arguments: [
        {
          name: 'requirement',
          description: 'Frontend requirement.',
          required: true,
        },
        {
          name: 'projectName',
          description: 'Optional project name.',
          required: false,
        },
      ],
    },
  ],
}

describe('McpAccessModal & McpAccessButton', () => {
  const dictionary = localeDictionaries['zh-CN']

  it('loads MCP server info, switches tabs, and copies endpoint and config JSON', async () => {
    vi.spyOn(api, 'getMcpServerInfo').mockResolvedValue(mockMcpServerInfo)
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    const onClose = vi.fn()
    renderWithProviders(
      <McpAccessModal open={true} onClose={onClose} />,
    )

    expect(await screen.findByText('future_cup_recommend_team')).toBeTruthy()
    expect(screen.getByText('future_cup_start_run')).toBeTruthy()
    expect(screen.getByText('2025-11-25')).toBeTruthy()

    // Copy endpoint URL
    const copyEndpointBtn = screen.getByRole('button', { name: new RegExp(dictionary.mcp.copyEndpoint) })
    fireEvent.click(copyEndpointBtn)
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/mcp'))

    // Copy client config JSON
    const copyConfigBtn = screen.getByRole('button', { name: new RegExp(dictionary.mcp.copyConfig) })
    fireEvent.click(copyConfigBtn)
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('"future-cup-platform-mcp"'))

    // Switch to Resources tab
    const resourcesTab = screen.getByRole('tab', { name: new RegExp('只读资源') })
    fireEvent.click(resourcesTab)
    expect(await screen.findByText('future-cup://projects')).toBeTruthy()
    expect(screen.getByText(dictionary.mcp.resourceStaticTag)).toBeTruthy()
    expect(screen.getByText(dictionary.mcp.resourceTemplateTag)).toBeTruthy()

    // Switch to Prompts tab
    const promptsTab = screen.getByRole('tab', { name: new RegExp('工作流模板') })
    fireEvent.click(promptsTab)
    expect(await screen.findByText('delegate-frontend-project')).toBeTruthy()
    expect(screen.getByText(`requirement (${dictionary.mcp.promptRequiredArg})`)).toBeTruthy()
    expect(screen.getByText(`projectName (${dictionary.mcp.promptOptionalArg})`)).toBeTruthy()
  })

  it('opens and closes modal via McpAccessButton and handles load errors gracefully', async () => {
    vi.spyOn(api, 'getMcpServerInfo').mockRejectedValueOnce(new Error('MCP endpoint offline'))

    renderWithProviders(<McpAccessButton />)

    const triggerButton = screen.getByRole('button', { name: new RegExp(dictionary.mcp.buttonLabel) })
    fireEvent.click(triggerButton)

    expect(await screen.findByText(dictionary.mcp.modalTitle)).toBeTruthy()
    await waitFor(() => {
      expect(api.getMcpServerInfo).toHaveBeenCalledTimes(1)
    })

    const closeBtn = screen.getByRole('button', { name: dictionary.common.close })
    fireEvent.click(closeBtn)
  })
})
