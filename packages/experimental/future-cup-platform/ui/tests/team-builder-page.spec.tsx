import { App as AntApp, ConfigProvider, Form } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import type { TeamRecommendationPlanView } from '../src/api/contracts.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { localeDictionaries } from '../src/locale/types.ts'
import {
  clarificationAnswers,
  ProfileSummary,
  QuestionField,
  requireTeamBuilderPlan,
  TeamBuilderPage,
} from '../src/pages/TeamBuilderPage.tsx'
import { teamProfile, teamRecommendationPlan } from './team-fixtures.ts'

function renderPage() {
  return render(
    <LocaleProvider>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <MemoryRouter initialEntries={['/team-builder']}>
            <TeamBuilderPage />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </LocaleProvider>,
  )
}

afterEach(cleanup)

describe('TeamBuilderPage', () => {
  it('validates and converts every structured clarification type', () => {
    const questions: TeamRecommendationPlanView['questions'] = [
      { type: 'page-count', prompt: 'pages', minimum: 1, maximum: 10 },
      {
        type: 'module-parallelism',
        prompt: 'modules',
        minimumModuleCount: 1,
        maximumModuleCount: 10,
        options: [{ value: 'balanced', label: 'Balanced' }],
      },
      {
        type: 'quality-verification',
        prompt: 'quality',
        options: [{
          value: 'high',
          label: 'High',
          testingRequired: true,
          qualityLevel: 'high',
          riskLevel: 'high',
        }],
      },
    ]
    expect(clarificationAnswers(questions, {
      pageCount: 3,
      moduleCount: 2,
      parallelism: 'balanced',
      quality: 'high',
    })).toEqual([
      { type: 'page-count', count: 3 },
      { type: 'module-parallelism', moduleCount: 2, parallelism: 'balanced' },
      { type: 'quality-verification', level: 'high' },
    ])

    expect(() => clarificationAnswers(questions, {})).toThrow(/Page count/)
    expect(() => clarificationAnswers(questions, { pageCount: 1 }))
      .toThrow(/Module count/)
    expect(() => clarificationAnswers(questions, {
      pageCount: 1,
      moduleCount: 2,
      parallelism: 'serial',
    })).toThrow(/Verification level/)
    const plan = teamRecommendationPlan()
    expect(requireTeamBuilderPlan(plan)).toBe(plan)
    expect(() => requireTeamBuilderPlan(undefined)).toThrow(/not available/)
  })

  it('renders module and quality clarification controls', () => {
    const dictionary = localeDictionaries['zh-CN']
    const { rerender } = render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <Form>
            <QuestionField
              dictionary={dictionary}
              question={{
                type: 'module-parallelism',
                prompt: 'modules',
                minimumModuleCount: 1,
                maximumModuleCount: 4,
                options: [
                  { value: 'serial', label: 'Serial' },
                  { value: 'balanced', label: 'Balanced' },
                ],
              }}
            />
          </Form>
        </ConfigProvider>
      </LocaleProvider>,
    )
    expect(screen.getByText('独立模块数量')).toBeTruthy()
    expect(screen.getByText('并行方式')).toBeTruthy()

    rerender(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <Form>
            <QuestionField
              dictionary={dictionary}
              question={{
                type: 'quality-verification',
                prompt: 'quality',
                options: [{
                  value: 'critical',
                  label: 'Critical',
                  testingRequired: true,
                  qualityLevel: 'critical',
                  riskLevel: 'critical',
                }],
              }}
            />
          </Form>
        </ConfigProvider>
      </LocaleProvider>,
    )
    expect(screen.getByText('验证等级')).toBeTruthy()
  })

  it('renders missing optional profile values as explicit dashes', () => {
    render(
      <LocaleProvider>
        <ConfigProvider locale={zhCN}>
          <ProfileSummary plan={{
            ...teamRecommendationPlan(),
            profile: {
              goal: teamProfile.goal,
            },
          }} />
        </ConfigProvider>
      </LocaleProvider>,
    )
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(6)
    expect(screen.getByText('否')).toBeTruthy()
  })

  it('structures a requirement, asks for clarification, and adopts the recommendation', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      readyForRecommendation: false,
      questions: [{
        type: 'page-count',
        prompt: 'How many pages?',
        minimum: 1,
        maximum: 20,
      }],
    })
    const recommend = vi.spyOn(api, 'recommendTeam').mockResolvedValue(teamRecommendationPlan())
    const adopt = vi.spyOn(api, 'adoptTeam').mockResolvedValue({
      projectId: 'project-recommended',
      teamVersion: {
        id: 'team-recommended',
        name: 'operations-dashboard',
        version: '1.0.0',
        purpose: teamProfile.goal,
        concurrencyCapacity: 2,
        memberCount: 1,
      },
    })
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建仪表盘和用户管理两个页面，需要并行开发和验证' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))

    expect(await screen.findByText('还需要确认这些信息')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /查看团队建议/ }))

    expect(await screen.findByText('Frontend Agent')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：运营数据后台'), {
      target: { value: '运营数据后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /采用并创建项目/ }))

    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(expect.objectContaining({
        projectName: '运营数据后台',
        profile: teamProfile,
        answers: [{ type: 'page-count', count: 2 }],
      }))
    })
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({
      profile: teamProfile,
      answers: [{ type: 'page-count', count: 2 }],
    }))
  })

  it('applies one natural-language adjustment and replays it on adoption', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      questions: [],
      readyForRecommendation: true,
    })
    vi.spyOn(api, 'recommendTeam').mockResolvedValue(teamRecommendationPlan())
    const adjusted = teamRecommendationPlan()
    vi.spyOn(api, 'adjustTeamRecommendation').mockResolvedValue({
      ...adjusted,
      adjustments: [{
        intent: { type: 'reduce-concurrency', maximum: 2 },
        changes: [{ kind: 'parallelism', from: 4, to: 2 }],
        explanation: 'Parallelism reduced.',
      }],
    })
    const adopt = vi.spyOn(api, 'adoptTeam').mockResolvedValue({
      projectId: 'project-adjusted',
      teamVersion: {
        id: 'team-adjusted',
        name: 'adjusted-team',
        version: '1.0.0',
        purpose: teamProfile.goal,
        concurrencyCapacity: 2,
        memberCount: 1,
      },
    })
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('Frontend Agent')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：减少一个前端实例，或降低并发到 2'), {
      target: { value: '降低并发到 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '应用调整' }))

    expect(await screen.findByText('降低并行上限')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：运营数据后台'), {
      target: { value: '调整后的运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /采用并创建项目/ }))

    await waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(expect.objectContaining({
        adjustments: ['降低并发到 2'],
        projectName: '调整后的运营后台',
      }))
    })
  })

  it('returns to requirement editing and ignores empty Enter submissions', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      readyForRecommendation: false,
      questions: [{
        type: 'page-count',
        prompt: 'How many pages?',
        minimum: 1,
        maximum: 20,
      }],
    })
    const recommend = vi.spyOn(api, 'recommendTeam')
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('还需要确认这些信息')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /返回修改需求/ }))
    expect(screen.getByLabelText('要交付什么')).toHaveProperty('value', '构建双页运营后台')
    expect(screen.queryByText('还需要确认这些信息')).toBeNull()
    expect(recommend).not.toHaveBeenCalled()
  })

  it('validates Enter submission for empty adjustment and project names', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      questions: [],
      readyForRecommendation: true,
    })
    vi.spyOn(api, 'recommendTeam').mockResolvedValue(teamRecommendationPlan())
    const adjust = vi.spyOn(api, 'adjustTeamRecommendation')
    const adopt = vi.spyOn(api, 'adoptTeam')
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('Frontend Agent')).toBeTruthy()
    fireEvent.keyDown(screen.getByPlaceholderText('例如：减少一个前端实例，或降低并发到 2'), {
      key: 'Enter',
    })
    fireEvent.keyDown(screen.getByPlaceholderText('例如：运营数据后台'), {
      key: 'Enter',
    })
    expect(adjust).not.toHaveBeenCalled()
    expect(adopt).not.toHaveBeenCalled()
  })

  it('shows localized errors for recommendation, adjustment, and adoption failures', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      readyForRecommendation: false,
      questions: [{
        type: 'page-count',
        prompt: 'How many pages?',
        minimum: 1,
        maximum: 20,
      }],
    })
    vi.spyOn(api, 'recommendTeam').mockRejectedValue(new Error('network'))
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('还需要确认这些信息')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /查看团队建议/ }))
    expect(await screen.findByText('团队推荐失败')).toBeTruthy()
  })

  it('shows and dismisses a requirement-structuring error', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockRejectedValue(new Error('offline'))
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('团队推荐失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => {
      expect(screen.queryByText('团队推荐失败')).toBeNull()
    })
  })

  it('shows adjustment errors and blocks incomplete teams from adoption', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      questions: [],
      readyForRecommendation: true,
    })
    const incomplete = teamRecommendationPlan()
    const recommendation = incomplete.recommendation
    if (recommendation === undefined) throw new Error('missing recommendation fixture')
    vi.spyOn(api, 'recommendTeam').mockResolvedValue({
      ...incomplete,
      recommendation: {
        ...recommendation,
        missingCapabilities: [{
          capability: 'testing',
          required: 1,
          covered: 0,
          reason: 'missing-role',
        }],
      },
    })
    const adopt = vi.spyOn(api, 'adoptTeam')
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('当前团队不完整，请先补齐缺失能力')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：运营数据后台'), {
      target: { value: '不完整团队' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('例如：运营数据后台'), {
      key: 'Enter',
    })
    expect(adopt).not.toHaveBeenCalled()
  })

  it('shows an explicit error when adjustment or adoption fails', async () => {
    vi.spyOn(api, 'structureTeamRequirement').mockResolvedValue({
      profile: teamProfile,
      questions: [],
      readyForRecommendation: true,
    })
    vi.spyOn(api, 'recommendTeam').mockResolvedValue(teamRecommendationPlan())
    vi.spyOn(api, 'adjustTeamRecommendation').mockRejectedValue(new Error('adjust failed'))
    vi.spyOn(api, 'adoptTeam').mockRejectedValue(new Error('adopt failed'))
    renderPage()

    fireEvent.change(screen.getByLabelText('要交付什么'), {
      target: { value: '构建双页运营后台' },
    })
    fireEvent.click(screen.getByRole('button', { name: /生成团队建议/ }))
    expect(await screen.findByText('Frontend Agent')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：减少一个前端实例，或降低并发到 2'), {
      target: { value: '降低并发' },
    })
    fireEvent.click(screen.getByRole('button', { name: '应用调整' }))
    expect(await screen.findByText('团队调整失败')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：运营数据后台'), {
      target: { value: '失败项目' },
    })
    fireEvent.click(screen.getByRole('button', { name: /采用并创建项目/ }))
    expect(await screen.findByText('团队采用失败')).toBeTruthy()
  })
})
