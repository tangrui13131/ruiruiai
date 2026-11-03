import {
  BugOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Spin,
  Tabs,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { FaultDrillMode, ProjectDrillInfoView } from '../api/contracts.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { StatusBadge } from './StatusBadge.tsx'

export interface SelfHealDrillModalProps {
  readonly projectId: string
  readonly open: boolean
  readonly onClose: () => void
  readonly onLaunched?: () => void
}

/**
 * Interactive Self-Healing Drill and Fault Injection modal.
 * Allows one-click injection of preset compiler or browser faults,
 * or immediate automated re-verification after manual workspace edits.
 */
export function SelfHealDrillModal({
  projectId,
  open,
  onClose,
  onLaunched,
}: SelfHealDrillModalProps) {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drillInfo, setDrillInfo] = useState<ProjectDrillInfoView | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<FaultDrillMode>('preset:typescript-contract')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void api.getProjectDrillInfo(projectId)
      .then((info) => {
        if (active) setDrillInfo(info)
      })
      .catch((error: unknown) => {
        const errorText = error instanceof Error ? error.message : dictionary.drill.launchFailed
        message.error(errorText)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [open, projectId, dictionary.drill.launchFailed, message])

  const handleCopyPath = () => {
    if (!drillInfo?.workspacePath) return
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(drillInfo.workspacePath)
      message.success(dictionary.drill.copied)
    }
  }

  const handleExecute = async (mode: FaultDrillMode) => {
    setSubmitting(true)
    try {
      await api.startSelfHealDrill(projectId, mode)
      message.success(dictionary.drill.launchSuccess)
      onClose()
      onLaunched?.()
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : dictionary.drill.launchFailed
      message.error(errorText)
    } finally {
      setSubmitting(false)
    }
  }

  const canDrill = drillInfo?.canDrill === true

  return (
    <Modal
      open={open}
      title={(
        <Space>
          <ThunderboltOutlined style={{ color: '#fa8c16' }} />
          <span>{dictionary.drill.modalTitle}</span>
        </Space>
      )}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} disabled={submitting}>
          {dictionary.drill.cancel}
        </Button>,
      ]}
      width={720}
      destroyOnHidden
    >
      <div className="page-stack" style={{ gap: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {dictionary.drill.modalDescription}
        </Typography.Paragraph>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin />
          </div>
        ) : (
          <>
            {drillInfo?.latestRunStatus ? (
              <Descriptions size="small" bordered column={2}>
                <Descriptions.Item label={dictionary.drill.latestRun}>
                  <StatusBadge status={drillInfo.latestRunStatus} />
                </Descriptions.Item>
                <Descriptions.Item label={dictionary.drill.workspacePathLabel}>
                  <Space orientation="horizontal" size={8} style={{ width: '100%' }}>
                    <FolderOpenOutlined />
                    <Typography.Text ellipsis copyable={{ text: drillInfo.workspacePath ?? '' }}>
                      {drillInfo.workspacePath ?? dictionary.common.none}
                    </Typography.Text>
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            ) : null}

            {!canDrill ? (
              <Alert
                type="warning"
                showIcon
                title={dictionary.drill.notReady}
              />
            ) : null}

            <Tabs
              activeKey={activeTab}
              onChange={key => setActiveTab(key as FaultDrillMode)}
              items={[
                {
                  key: 'preset:typescript-contract',
                  label: dictionary.drill.tabPresetTs,
                  children: (
                    <Card size="small" variant="borderless">
                      <p>{dictionary.drill.presetTsDesc}</p>
                      <Button
                        type="primary"
                        danger
                        icon={<BugOutlined />}
                        loading={submitting}
                        disabled={!canDrill}
                        onClick={() => { void handleExecute('preset:typescript-contract') }}
                      >
                        {dictionary.drill.injectAndVerify}
                      </Button>
                    </Card>
                  ),
                },
                {
                  key: 'preset:browser-behavior',
                  label: dictionary.drill.tabPresetBrowser,
                  children: (
                    <Card size="small" variant="borderless">
                      <p>{dictionary.drill.presetBrowserDesc}</p>
                      <Button
                        type="primary"
                        danger
                        icon={<BugOutlined />}
                        loading={submitting}
                        disabled={!canDrill}
                        onClick={() => { void handleExecute('preset:browser-behavior') }}
                      >
                        {dictionary.drill.injectAndVerify}
                      </Button>
                    </Card>
                  ),
                },
                {
                  key: 'manual:workspace',
                  label: dictionary.drill.tabManual,
                  children: (
                    <Card size="small" variant="borderless">
                      <p>{dictionary.drill.manualDesc}</p>
                      {drillInfo?.workspacePath ? (
                        <div style={{ marginBottom: 12 }}>
                          <Space>
                            <Typography.Text code copyable={{ text: drillInfo.workspacePath }}>
                              {drillInfo.workspacePath}
                            </Typography.Text>
                            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyPath}>
                              {dictionary.drill.copyPathButton}
                            </Button>
                          </Space>
                        </div>
                      ) : null}
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        loading={submitting}
                        disabled={!canDrill}
                        onClick={() => { void handleExecute('manual:workspace') }}
                      >
                        {dictionary.drill.triggerManualVerify}
                      </Button>
                    </Card>
                  ),
                },
                {
                  key: 'restore:golden',
                  label: dictionary.drill.tabRestore,
                  children: (
                    <Card size="small" variant="borderless">
                      <p>{dictionary.drill.restoreDesc}</p>
                      <Button
                        icon={<ReloadOutlined />}
                        loading={submitting}
                        disabled={!canDrill}
                        onClick={() => { void handleExecute('restore:golden') }}
                      >
                        {dictionary.drill.restoreAndVerify}
                      </Button>
                    </Card>
                  ),
                },
              ]}
            />
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * Trigger button opening the self-healing drill modal.
 */
export function SelfHealDrillButton({
  projectId,
  compact = false,
  onLaunched,
}: {
  readonly projectId: string
  readonly compact?: boolean
  readonly onLaunched?: () => void
}) {
  const [open, setOpen] = useState(false)
  const { dictionary } = useLocale()

  return (
    <>
      <Tooltip title={dictionary.drill.buttonLabel}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          aria-label={dictionary.drill.buttonLabel}
          onClick={() => { setOpen(true) }}
        >
          {compact ? null : dictionary.drill.buttonLabel}
        </Button>
      </Tooltip>
      <SelfHealDrillModal
        projectId={projectId}
        open={open}
        onClose={() => { setOpen(false) }}
        onLaunched={onLaunched}
      />
    </>
  )
}
