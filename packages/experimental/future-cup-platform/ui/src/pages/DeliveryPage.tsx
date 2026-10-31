import { ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Descriptions, Result, Skeleton, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import { api, previewUrl } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import type { DeliveryView } from '../api/contracts.ts'
import { EmptyPanel } from '../components/EmptyPanel.tsx'
import { PageHeading } from '../components/PageHeading.tsx'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { useProjectState, useProjectStore } from '../state/ProjectStoreContext.tsx'

/** Show workspace metadata and the online preview for a verified generated project. */
export function DeliveryPage() {
  const { dictionary } = useLocale()
  const state = useProjectState()
  const store = useProjectStore()
  const snapshot = state.snapshot
  const [delivery, setDelivery] = useState<DeliveryView>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const projectId = snapshot?.project.id

  useEffect(() => {
    if (projectId === undefined) return
    let active = true
    setLoading(true)
    void api.getDelivery(projectId).then((value) => {
      if (active) {
        setDelivery(value)
        setError(undefined)
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(localizedApiError(loadError, dictionary.errors, dictionary.errors.loadDelivery))
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [projectId, dictionary.errors.loadDelivery])

  if (snapshot === undefined) return null
  const latestRun = snapshot.runs?.at(-1)
  const status = delivery?.status ?? latestRun?.status ?? snapshot.workflow?.status ?? 'PENDING'
  const ready = status === 'PASSED'
    && snapshot.workflow?.status !== 'ESCALATED'
    && (latestRun?.hasPreview === true || delivery?.previewUrl !== undefined)
  const url = previewUrl(snapshot.project.id, delivery ?? snapshot.delivery)

  return (
    <div className="page-stack">
      <PageHeading
        title={dictionary.delivery.title}
        description={dictionary.delivery.description}
        actions={
          <>
            <Tooltip title={dictionary.common.refresh}>
              <Button
                icon={<ReloadOutlined />}
                aria-label={dictionary.common.refresh}
                onClick={() => { void store.refresh() }}
              />
            </Tooltip>
            <Button
              type="primary"
              icon={<ExportOutlined />}
              disabled={!ready}
              href={url}
              target="_blank"
            >
              {dictionary.delivery.openPreview}
            </Button>
          </>
        }
      />
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {!loading && error !== undefined ? (
        <Result status="error" title={dictionary.errors.loadDelivery} subTitle={error} />
      ) : null}
      {!loading && error === undefined ? (
        <>
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={dictionary.delivery.runStatus}>
              <StatusBadge status={status} />
            </Descriptions.Item>
            <Descriptions.Item label={dictionary.delivery.workspace}>
              {delivery?.workspacePath
                ?? (latestRun?.hasWorkspace === true
                  ? dictionary.delivery.workspaceReady
                  : dictionary.common.none)}
            </Descriptions.Item>
            <Descriptions.Item label={dictionary.delivery.buildArtifact}>
              {latestRun?.hasPreview === true ? 'dist/' : dictionary.common.none}
            </Descriptions.Item>
            <Descriptions.Item label={dictionary.delivery.preview}>
              {ready ? dictionary.delivery.available : dictionary.delivery.notReady}
            </Descriptions.Item>
          </Descriptions>
          {ready ? (
            <iframe className="preview-frame" src={url} title={dictionary.delivery.preview} />
          ) : (
            <EmptyPanel text={dictionary.delivery.notReady} />
          )}
        </>
      ) : null}
    </div>
  )
}
