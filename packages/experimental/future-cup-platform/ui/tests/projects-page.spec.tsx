import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { ProjectsPage } from '../src/pages/ProjectsPage.tsx'

describe('ProjectsPage', () => {
  it('renders durable projects returned by the API', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([{
      id: 'project-page',
      name: '运营数据后台',
      requirement: '构建仪表盘与用户管理页',
      createdAt: '2026-10-31T10:00:00.000Z',
      lastEventSeq: 3,
      latestRunStatus: 'RUNNING',
    }])
    render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <AntApp>
            <MemoryRouter>
              <ProjectsPage />
            </MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </LocaleProvider>,
    )
    expect(await screen.findByText('运营数据后台')).toBeTruthy()
    expect(screen.getByText('构建仪表盘与用户管理页')).toBeTruthy()
  })
})
