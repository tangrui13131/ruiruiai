import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import type { AgentDefinitionView, AgentTeamPageView, AgentTeamVersionView } from '../src/api/contracts.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { MyTeamsPage } from '../src/pages/MyTeamsPage.tsx'

const teamVersion: AgentTeamVersionView = {
  id: 'team-version-1',
  teamId: 'team-1',
  ownerId: 'user-1',
  name: 'operations-team',
  version: '1.0.0',
  purpose: 'Deliver an operations console.',
  status: 'PUBLISHED',
  members: [{
    instanceId: 'planner:instance-1',
    displayName: 'Planner',
    role: 'planner',
    definitionId: 'planner',
    agentVersionId: 'planner-1.0.0',
    departmentKey: 'planning',
    position: 1,
  }],
  requiredCapabilities: { planning: 1 },
  requiredConcurrency: 1,
  concurrencyCapacity: 1,
  capabilityCoverage: [],
}

const teamPage: AgentTeamPageView = {
  items: [{
    id: 'team-1',
    ownerId: 'user-1',
    name: 'operations-team',
    purpose: 'Deliver an operations console.',
    status: 'ACTIVE',
    latestVersion: teamVersion,
    versionCount: 1,
    projectUsageCount: 2,
  }],
  total: 1,
  offset: 0,
  limit: 24,
}

const definitions: AgentDefinitionView[] = [{
  id: 'planner',
  name: 'Planner',
  purpose: 'Plan the delivery.',
  discoveryTags: ['planner'],
  status: 'PUBLISHED',
  versions: [{
    id: 'planner-1.0.0',
    version: '1.0.0',
    role: 'planner',
    model: 'deepseek-flash',
    capabilities: { planning: 1 },
    toolAllowlist: ['fs-read'],
    status: 'PUBLISHED',
  }],
}]

function renderPage() {
  return render(
    <LocaleProvider>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <MemoryRouter initialEntries={['/teams']}>
            <MyTeamsPage />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MyTeamsPage', () => {
  it('renders owned Teams and opens the runtime-member editor', async () => {
    vi.spyOn(api, 'listTeams').mockResolvedValue(teamPage)
    vi.spyOn(api, 'listAgentDefinitions').mockResolvedValue(definitions)
    vi.spyOn(api, 'listTeamVersions').mockResolvedValue([teamVersion])

    renderPage()

    expect(await screen.findAllByText('operations-team')).toHaveLength(2)
    expect(screen.getAllByText(/项目使用/)).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑成员' }).at(-1) as HTMLElement)

    expect(await screen.findByDisplayValue('Planner')).toBeTruthy()
    expect(screen.getByText(/1\/7/)).toBeTruthy()
  })

  it('creates a logical Team from the create dialog', async () => {
    vi.spyOn(api, 'listTeams').mockResolvedValue({ ...teamPage, items: [], total: 0 })
    vi.spyOn(api, 'listAgentDefinitions').mockResolvedValue(definitions)
    const create = vi.spyOn(api, 'createTeam').mockResolvedValue(teamPage.items[0] as never)
    renderPage()

    fireEvent.click((await screen.findAllByRole('button', { name: /创建团队/ }))[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: 'new-team' } })
    fireEvent.change(screen.getByLabelText('团队目标'), { target: { value: 'Deliver a new project.' } })
    const createButtons = screen.getAllByRole('button', { name: /创建团队/ })
    fireEvent.click(createButtons.at(-1) as HTMLElement)

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'new-team',
        purpose: 'Deliver a new project.',
      })
    })
  })
})
