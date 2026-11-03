import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { AgentCard } from '../src/pages/ProjectOverviewPage.tsx'
import { agent } from './fixtures.ts'

describe('AgentCard', () => {
  afterEach(cleanup)

  it('labels the bar as a historical success rate and exposes its sample size', () => {
    render(
      <LocaleProvider>
        <AgentCard agent={agent('ui-designer', 0, 0.5, 1, 2)} />
      </LocaleProvider>,
    )

    expect(screen.getByText('历史成功率')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('共 2 次执行，成功 1 次')).toBeTruthy()
  })

  it('does not show the profile fallback as observed history without an execution', () => {
    render(
      <LocaleProvider>
        <AgentCard agent={agent('repair', 0, 0.75, 0, 0)} />
      </LocaleProvider>,
    )

    expect(screen.getByText('暂无数据')).toBeTruthy()
    expect(screen.getByText('暂无历史执行记录')).toBeTruthy()
    expect(screen.queryByText('75%')).toBeNull()
  })
})
