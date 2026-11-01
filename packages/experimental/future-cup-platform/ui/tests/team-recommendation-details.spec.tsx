import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TeamRecommendationPlanView } from '../src/api/contracts.ts'
import { TeamRecommendationDetails } from '../src/components/TeamRecommendationDetails.tsx'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { teamRecommendationPlan } from './team-fixtures.ts'

type Recommendation = NonNullable<TeamRecommendationPlanView['recommendation']>

afterEach(cleanup)

function renderDetails(recommendation: Recommendation) {
  return render(
    <LocaleProvider>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <TeamRecommendationDetails recommendation={recommendation} />
        </AntApp>
      </ConfigProvider>
    </LocaleProvider>,
  )
}

describe('TeamRecommendationDetails', () => {
  it('renders the complete satisfied recommendation', () => {
    const recommendation = teamRecommendationPlan().recommendation
    if (recommendation === undefined) throw new Error('missing recommendation fixture')
    renderDetails(recommendation)

    expect(screen.getByText('Frontend Agent')).toBeTruthy()
    expect(screen.getByText('基于已发布模板 future-cup-default-team@1.0.0')).toBeTruthy()
    expect(screen.getByText('frontend 已覆盖')).toBeTruthy()
    expect(screen.getByText('没有额外风险')).toBeTruthy()
  })

  it('renders gaps, empty tools, failed coverage, and structured risks', () => {
    const recommendation = teamRecommendationPlan().recommendation
    if (recommendation === undefined) throw new Error('missing recommendation fixture')
    const member = recommendation.members[0]
    if (member === undefined) throw new Error('missing recommendation member')
    const coverage = recommendation.capabilityCoverage[0]
    if (coverage === undefined) throw new Error('missing capability coverage fixture')
    renderDetails({
      ...recommendation,
      sourceTemplate: undefined,
      members: [{ ...member, toolAllowlist: [] }],
      capabilityCoverage: [{
        ...coverage,
        satisfied: false,
        covered: 0,
        required: 0,
      }],
      missingCapabilities: [{
        capability: 'testing',
        required: 1,
        covered: 0,
        reason: 'missing-role',
      }],
      risks: [{
        kind: 'capability-gap',
        capability: 'testing',
        message: 'ignored',
      }],
    })

    expect(screen.getByText('无工具')).toBeTruthy()
    expect(screen.getByText('frontend 未覆盖')).toBeTruthy()
    expect(screen.getByText('testing')).toBeTruthy()
    expect(screen.getByText(/能力 testing 覆盖不足/)).toBeTruthy()
  })
})
