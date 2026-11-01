import { selectRepairStrategy } from
  '@deepseek-ai/dsh-experimental-future-cup-orchestration/src/adaptive-repair.ts'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { RepairsPage, RepairsView, strategyReason } from '../src/pages/RepairsPage.tsx'
import { ProjectStoreProvider } from '../src/state/ProjectStoreContext.tsx'
import { localeDictionaries } from '../src/locale/types.ts'
import { snapshot } from './fixtures.ts'

vi.mock('../src/realtime/project-socket.ts', () => ({
  connectProjectSocket: vi.fn(() => () => {}),
}))

afterEach(cleanup)

function renderRepairs(value: ReturnType<typeof snapshot>) {
  return render(
    <LocaleProvider>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <RepairsView snapshot={value} />
        </AntApp>
      </ConfigProvider>
    </LocaleProvider>,
  )
}

describe('RepairsView', () => {
  it('renders the strategy decision, outcome, and source diff', () => {
    const failureSignature = 'a'.repeat(64)
    const decision = selectRepairStrategy({
      report: {
        verifier: 'future-cup-m3',
        status: 'FAIL',
        failureSignature,
        checks: [{ name: 'typescript', status: 'FAIL', summary: 'TypeScript failed.' }],
        findings: [{
          category: 'typescript',
          code: 'TS2322',
          severity: 'error',
          message: 'Type mismatch',
          target: 'src/App.tsx',
        }],
        routes: ['/'],
        viewports: ['desktop'],
        screenshots: [],
      },
      repairRound: 1,
      maxRepairRounds: 3,
      availableTools: ['fs-read'],
      priorStrategies: [],
    })
    renderRepairs({
      ...snapshot(),
      repairs: [{
        id: 'repair-1',
        projectId: 'project-test',
        repairRound: 1,
        verificationReportId: 'verification-1',
        repairAgentId: 'repair',
        failureSignature,
        errorSummary: 'TS2322: Type mismatch',
        changeSummary: 'Corrected the component prop.',
        diff: '--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1 +1 @@\n-old\n+new',
        beforeStatus: 'FAIL',
        afterStatus: 'PASS',
        startedAt: '2026-10-31T10:00:00.000Z',
        completedAt: '2026-10-31T10:01:00.000Z',
      }],
      repairStrategies: [{
        id: 'repair-strategy-1',
        projectId: 'project-test',
        repairRound: 1,
        failureSignature,
        strategyId: 'typescript-contract',
        decision,
        outcome: {
          status: 'PASS',
          nextAction: 'COMPLETE',
        },
        repairRecordId: 'repair-1',
        createdAt: '2026-10-31T10:00:00.000Z',
        updatedAt: '2026-10-31T10:01:00.000Z',
      }],
    })

    expect(screen.getByText('typescript-contract')).toBeTruthy()
    expect(screen.getByText('按失败类别 typescript 选择 typescript-contract')).toBeTruthy()
    expect(screen.getByText(/COMPLETE/)).toBeTruthy()
    expect(screen.getByText(/Corrected the component prop/)).toBeTruthy()
  })

  it('renders the explicit empty state', () => {
    renderRepairs(snapshot())
    expect(screen.getByText('还没有自动修复记录')).toBeTruthy()
  })

  it('localizes first selection, strategy switching, and exhaustion', () => {
    const dictionary = localeDictionaries['zh-CN']
    const failureSignature = 'd'.repeat(64)
    const report = {
      verifier: 'future-cup-m3' as const,
      status: 'FAIL' as const,
      failureSignature,
      checks: [{ name: 'typescript', status: 'FAIL' as const, summary: 'TypeScript failed.' }],
      findings: [{
        category: 'typescript' as const,
        code: 'TS2322',
        severity: 'error' as const,
        message: 'Type mismatch',
        target: 'src/App.tsx',
      }],
      routes: ['/'],
      viewports: ['desktop'],
      screenshots: [],
    }
    const first = selectRepairStrategy({
      report,
      repairRound: 1,
      maxRepairRounds: 3,
      availableTools: ['fs-read'],
      priorStrategies: [],
    })
    const switched = selectRepairStrategy({
      report,
      repairRound: 2,
      maxRepairRounds: 3,
      availableTools: ['fs-read'],
      priorStrategies: [{
        repairRound: 1,
        failureSignature,
        strategyId: 'typescript-contract',
      }],
    })
    const exhausted = selectRepairStrategy({
      report,
      repairRound: 3,
      maxRepairRounds: 3,
      availableTools: ['fs-read'],
      priorStrategies: [
        {
          repairRound: 1,
          failureSignature,
          strategyId: 'typescript-contract',
        },
        {
          repairRound: 2,
          failureSignature,
          strategyId: 'bounded-regression',
        },
      ],
    })

    expect(strategyReason(first, dictionary)).toBe(
      '按失败类别 typescript 选择 typescript-contract',
    )
    expect(strategyReason(switched, dictionary)).toBe(
      '相同失败签名出现后，从 typescript-contract 切换到 bounded-regression',
    )
    expect(strategyReason(exhausted, dictionary)).toBe('没有剩余可用策略')
  })

  it('sorts rounds and handles missing strategy and outcome evidence', () => {
    const base = snapshot()
    renderRepairs({
      ...base,
      repairs: [
        {
          id: 'repair-2',
          projectId: 'project-test',
          repairRound: 2,
          verificationReportId: 'verification-2',
          repairAgentId: 'repair',
          failureSignature: 'b'.repeat(64),
          errorSummary: 'Second failure',
          changeSummary: 'Second change',
          diff: '',
          beforeStatus: 'FAIL',
          afterStatus: 'PASS',
          startedAt: '2026-10-31T10:02:00.000Z',
          completedAt: '2026-10-31T10:03:00.000Z',
        },
        {
          id: 'repair-1',
          projectId: 'project-test',
          repairRound: 1,
          verificationReportId: 'verification-1',
          repairAgentId: 'repair',
          failureSignature: 'a'.repeat(64),
          errorSummary: 'First failure',
          changeSummary: 'First change',
          diff: '',
          beforeStatus: 'FAIL',
          afterStatus: 'FAIL',
          startedAt: '2026-10-31T10:00:00.000Z',
          completedAt: '2026-10-31T10:01:00.000Z',
        },
        {
          id: 'repair-3',
          projectId: 'project-test',
          repairRound: 3,
          verificationReportId: 'verification-3',
          repairAgentId: 'repair',
          failureSignature: 'c'.repeat(64),
          errorSummary: 'Third failure',
          changeSummary: 'Third change',
          diff: '',
          beforeStatus: 'FAIL',
          afterStatus: 'PASS',
          startedAt: '2026-10-31T10:04:00.000Z',
          completedAt: '2026-10-31T10:05:00.000Z',
        },
      ],
      repairStrategies: [{
        id: 'strategy-2',
        projectId: 'project-test',
        repairRound: 2,
        failureSignature: 'b'.repeat(64),
        strategyId: 'bounded-regression',
        decision: {
          failureSignature: 'b'.repeat(64),
          repairRound: 2,
          maxRepairRounds: 3,
          repeatedSignature: false,
          selectedReason: 'Second strategy',
          candidates: [],
          inputSummary: { categories: ['typescript'], codes: [], targets: [] },
          nextRoundExpectation: 'FIRST_REPAIR',
          reverifyScope: 'FULL_VERIFICATION',
        },
        outcome: { status: 'PASS', nextAction: 'COMPLETE' },
        createdAt: '2026-10-31T10:02:00.000Z',
        updatedAt: '2026-10-31T10:03:00.000Z',
      }, {
        id: 'strategy-3',
        projectId: 'project-test',
        repairRound: 3,
        failureSignature: 'c'.repeat(64),
        strategyId: 'typescript-contract',
        decision: {
          failureSignature: 'c'.repeat(64),
          repairRound: 3,
          maxRepairRounds: 3,
          repeatedSignature: false,
          selectedReason: 'Third strategy',
          candidates: [],
          inputSummary: { categories: ['typescript'], codes: [], targets: [] },
          nextRoundExpectation: 'FIRST_REPAIR',
          reverifyScope: 'FULL_VERIFICATION',
        },
        createdAt: '2026-10-31T10:04:00.000Z',
        updatedAt: '2026-10-31T10:05:00.000Z',
      }],
    })

    expect(screen.getByText('第 1 轮')).toBeTruthy()
    expect(screen.getByText('bounded-regression')).toBeTruthy()
    expect(screen.getByText('typescript-contract')).toBeTruthy()
  })

  it('loads the active store snapshot and preserves the initial null state', async () => {
    vi.spyOn(api, 'getSnapshot').mockResolvedValue(snapshot())
    const loaded = render(
      <LocaleProvider>
        <ProjectStoreProvider projectId="project-test">
          <RepairsPage />
        </ProjectStoreProvider>
      </LocaleProvider>,
    )
    expect(await screen.findByText('还没有自动修复记录')).toBeTruthy()
    loaded.unmount()

    vi.spyOn(api, 'getSnapshot').mockReturnValue(new Promise(() => {}))
    const pending = render(
      <LocaleProvider>
        <ProjectStoreProvider projectId="project-pending">
          <RepairsPage />
        </ProjectStoreProvider>
      </LocaleProvider>,
    )
    await waitFor(() => {
      expect(pending.container.textContent).toBe('')
    })
  })
})
