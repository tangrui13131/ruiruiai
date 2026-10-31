import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusBadge } from '../src/components/StatusBadge.tsx'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'

describe('StatusBadge', () => {
  afterEach(cleanup)

  it.each([
    ['PENDING', '待处理'],
    ['READY', '就绪'],
    ['RUNNING', '运行中'],
    ['COMPLETED', '已完成'],
    ['PASSED', '已通过'],
    ['PASS', '通过'],
    ['WARNING', '警告'],
    ['FAILED', '失败'],
    ['FAIL', '失败'],
    ['BLOCKED', '已阻断'],
    ['CANCELLED', '已取消'],
    ['ESCALATED', '已升级'],
    ['INCOMPLETE', '未完成'],
    ['SKIPPED', '已跳过'],
  ])('renders %s as a localized Chinese label', (status, label) => {
    render(
      <LocaleProvider>
        <StatusBadge status={status} />
      </LocaleProvider>,
    )
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('renders English labels and preserves unknown statuses', () => {
    const { rerender } = render(
      <LocaleProvider initialLocale="en">
        <StatusBadge status="RUNNING" />
      </LocaleProvider>,
    )
    expect(screen.getByText('Running')).toBeTruthy()
    rerender(
      <LocaleProvider initialLocale="en">
        <StatusBadge status="FUTURE_STATE" />
      </LocaleProvider>,
    )
    expect(screen.getByText('FUTURE_STATE')).toBeTruthy()
  })
})
