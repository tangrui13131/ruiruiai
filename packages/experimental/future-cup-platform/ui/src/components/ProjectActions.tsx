import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Button, Space, Tooltip } from 'antd'
import { useProjectCommands } from '../hooks/useProjectCommands.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState, useProjectStore } from '../state/ProjectStoreContext.tsx'

/** Start or cancel the real project run through the platform API. */
export function ProjectActions({
  projectId,
  compact = false,
}: {
  readonly projectId: string
  readonly compact?: boolean
}) {
  const { dictionary } = useLocale()
  const state = useProjectState()
  const store = useProjectStore()
  const latestRun = state.snapshot?.runs?.at(-1)
  const running = latestRun?.status === 'RUNNING'
  const canRun = latestRun === undefined
  const commands = useProjectCommands(projectId, async () => { await store.refresh() })

  return (
    <Space size={6}>
      {running ? (
        <Tooltip title={dictionary.projects.cancelRun}>
          <Button
            danger
            type={compact ? 'text' : 'default'}
            icon={<PauseCircleOutlined />}
            loading={commands.pending === 'cancel'}
            aria-label={dictionary.projects.cancelRun}
            onClick={() => { void commands.cancel() }}
          >
            {compact ? null : dictionary.projects.cancelRun}
          </Button>
        </Tooltip>
      ) : canRun ? (
        <Tooltip title={dictionary.projects.run}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={commands.pending === 'run'}
            aria-label={dictionary.projects.run}
            onClick={() => { void commands.start() }}
          >
            {compact ? null : dictionary.projects.run}
          </Button>
        </Tooltip>
      ) : (
        <Tooltip title={dictionary.projects.runUnavailable}>
          <Button
            type="default"
            icon={<PlayCircleOutlined />}
            aria-label={dictionary.projects.runUnavailable}
            disabled
          >
            {compact ? null : dictionary.projects.run}
          </Button>
        </Tooltip>
      )}
    </Space>
  )
}
