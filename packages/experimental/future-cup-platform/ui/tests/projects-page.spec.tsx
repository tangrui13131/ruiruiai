import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { ProjectsPage } from '../src/pages/ProjectsPage.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
                <Route path="/team-builder" element={<div>智能配队工作区</div>} />
                <Route path="/projects/:projectId" element={<div>后继项目</div>} />
              </Routes>
            </MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </LocaleProvider>,
    )
    expect(await screen.findByText('运营数据后台')).toBeTruthy()
    expect(screen.getByText('构建仪表盘与用户管理页')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /智能配队/ }))
    expect(await screen.findByText('智能配队工作区')).toBeTruthy()
  })

  it('creates an upgrade successor from a passed project', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([{
      id: 'project-upgrade-source',
      name: '运营后台',
      requirement: '构建运营后台',
      createdAt: '2026-11-04T10:00:00.000Z',
      lastEventSeq: 40,
      latestRunStatus: 'PASSED',
    }])
    const derive = vi.spyOn(api, 'deriveProject').mockResolvedValue({
      project: {
        id: 'project-upgrade-target',
        name: '运营后台 · v2',
        requirement: '构建运营后台',
        createdAt: '2026-11-04T10:10:00.000Z',
        lastEventSeq: 0,
        sourceProjectId: 'project-upgrade-source',
        sourceProjectName: '运营后台',
        derivationMode: 'UPGRADE',
      },
      runId: 'run-upgrade-target',
    })
    render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <AntApp>
            <MemoryRouter initialEntries={['/']}>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<div>后继项目</div>} />
              </Routes>
            </MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </LocaleProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '基于此项目生成' }))
    fireEvent.change(await screen.findByLabelText('升级需求'), {
      target: { value: '增加搜索筛选与移动端布局' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确\s*认/ }))

    await waitFor(() => {
      expect(derive).toHaveBeenCalledWith('project-upgrade-source', {
        name: '运营后台 · v2',
        mode: 'UPGRADE',
        changeRequest: '增加搜索筛选与移动端布局',
      })
    })
    expect(await screen.findByText('后继项目')).toBeTruthy()
  })

  it('deletes a non-running project when the delete button is clicked', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([{
      id: 'project-done',
      name: '前端生成',
      requirement: '生成简单的前端项目',
      createdAt: '2026-10-31T10:00:00.000Z',
      lastEventSeq: 40,
      latestRunStatus: 'PASSED',
    }])
    const deleteProject = vi.spyOn(api, 'deleteProject').mockResolvedValue(true)
    render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <AntApp>
            <MemoryRouter>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
              </Routes>
            </MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </LocaleProvider>,
    )
    const deleteButton = await screen.findByRole('button', { name: '删除项目' })
    fireEvent.click(deleteButton)
    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith('project-done')
    })
  })

  it('does not report a cancelled run when the server has no active run', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([{
      id: 'project-orphaned',
      name: 'Agent 团队测试',
      requirement: '生成精美前端',
      createdAt: '2026-11-03T10:00:00.000Z',
      lastEventSeq: 3,
      latestRunStatus: 'RUNNING',
    }])
    const cancelRun = vi.spyOn(api, 'cancelRun').mockResolvedValue(false)
    render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <AntApp>
            <MemoryRouter>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
              </Routes>
            </MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </LocaleProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '取消运行' }))

    await waitFor(() => {
      expect(cancelRun).toHaveBeenCalledWith('project-orphaned')
    })
    expect(await screen.findByText('项目取消失败')).toBeTruthy()
    expect(screen.queryByText('运行已取消')).toBeNull()
  })
})
