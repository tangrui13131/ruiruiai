import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { SelfHealDrillButton, SelfHealDrillModal } from '../src/components/SelfHealDrillModal.tsx'
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

describe('SelfHealDrillModal & SelfHealDrillButton', () => {
  const dictionary = localeDictionaries['zh-CN']
  const mockDrillInfo = {
    projectId: 'project-test-drill',
    canDrill: true,
    workspacePath: 'D:/mock/runs/drill-workspace',
    latestRunStatus: 'PASSED',
    availableModes: [
      'preset:typescript-contract' as const,
      'preset:browser-behavior' as const,
      'manual:workspace' as const,
      'restore:golden' as const,
    ],
  }

  it('renders drill info and launches preset typescript contract fault drill', async () => {
    vi.spyOn(api, 'getProjectDrillInfo').mockResolvedValue(mockDrillInfo)
    const startDrillMock = vi.spyOn(api, 'startSelfHealDrill').mockResolvedValue({
      runId: 'run-drill-123',
      mode: 'preset:typescript-contract',
      injectedFault: {
        mode: 'preset:typescript-contract',
        description: 'TS Contract Fault',
      },
    })

    const onClose = vi.fn()
    const onLaunched = vi.fn()

    renderWithProviders(
      <SelfHealDrillModal
        projectId="project-test-drill"
        open={true}
        onClose={onClose}
        onLaunched={onLaunched}
      />,
    )

    expect(await screen.findByText(dictionary.drill.modalTitle)).toBeTruthy()
    expect(screen.getByText('D:/mock/runs/drill-workspace')).toBeTruthy()
    expect(screen.getByText(dictionary.drill.presetTsDesc)).toBeTruthy()

    const injectButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.injectAndVerify) })
    fireEvent.click(injectButton)

    await waitFor(() => {
      expect(startDrillMock).toHaveBeenCalledWith('project-test-drill', 'preset:typescript-contract')
      expect(onClose).toHaveBeenCalled()
      expect(onLaunched).toHaveBeenCalled()
    })
  })

  it('switches to manual mode, copies path, and launches manual workspace drill', async () => {
    vi.spyOn(api, 'getProjectDrillInfo').mockResolvedValue(mockDrillInfo)
    const startDrillMock = vi.spyOn(api, 'startSelfHealDrill').mockResolvedValue({
      runId: 'run-drill-manual',
      mode: 'manual:workspace',
    })

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    renderWithProviders(
      <SelfHealDrillModal
        projectId="project-test-drill"
        open={true}
        onClose={vi.fn()}
      />,
    )

    await screen.findByText(dictionary.drill.modalTitle)

    // Switch tab to manual
    const manualTab = screen.getByRole('tab', { name: dictionary.drill.tabManual })
    fireEvent.click(manualTab)

    expect(await screen.findByText(dictionary.drill.manualDesc)).toBeTruthy()

    // Test copy button
    const copyButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.copyPathButton) })
    fireEvent.click(copyButton)
    expect(writeTextMock).toHaveBeenCalledWith('D:/mock/runs/drill-workspace')

    // Submit manual verification
    const submitButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.triggerManualVerify) })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(startDrillMock).toHaveBeenCalledWith('project-test-drill', 'manual:workspace')
    })
  })

  it('switches to golden restore mode and executes restoration drill', async () => {
    vi.spyOn(api, 'getProjectDrillInfo').mockResolvedValue(mockDrillInfo)
    const startDrillMock = vi.spyOn(api, 'startSelfHealDrill').mockResolvedValue({
      runId: 'run-drill-restore',
      mode: 'restore:golden',
    })

    renderWithProviders(
      <SelfHealDrillModal
        projectId="project-test-drill"
        open={true}
        onClose={vi.fn()}
      />,
    )

    await screen.findByText(dictionary.drill.modalTitle)

    // Switch tab to restore
    const restoreTab = screen.getByRole('tab', { name: dictionary.drill.tabRestore })
    fireEvent.click(restoreTab)

    expect(await screen.findByText(dictionary.drill.restoreDesc)).toBeTruthy()

    const restoreButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.restoreAndVerify) })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(startDrillMock).toHaveBeenCalledWith('project-test-drill', 'restore:golden')
    })
  })

  it('shows warning alert when project cannot drill', async () => {
    vi.spyOn(api, 'getProjectDrillInfo').mockResolvedValue({
      projectId: 'project-not-ready',
      canDrill: false,
      availableModes: [
        'preset:typescript-contract' as const,
        'preset:browser-behavior' as const,
        'manual:workspace' as const,
        'restore:golden' as const,
      ],
    })

    renderWithProviders(
      <SelfHealDrillModal
        projectId="project-not-ready"
        open={true}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText(dictionary.drill.notReady)).toBeTruthy()
    const injectButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.injectAndVerify) })
    expect(injectButton.hasAttribute('disabled')).toBe(true)
  })

  it('opens modal when SelfHealDrillButton is clicked', async () => {
    vi.spyOn(api, 'getProjectDrillInfo').mockResolvedValue(mockDrillInfo)

    renderWithProviders(
      <SelfHealDrillButton projectId="project-test-drill" />,
    )

    const triggerButton = screen.getByRole('button', { name: new RegExp(dictionary.drill.buttonLabel) })
    fireEvent.click(triggerButton)

    expect(await screen.findByText(dictionary.drill.modalTitle)).toBeTruthy()
  })
})
