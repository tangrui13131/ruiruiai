import { ReloadOutlined } from '@ant-design/icons'
import { Button, Result, Spin } from 'antd'
import { Outlet, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell.tsx'
import { useLocale } from '../locale/LocaleProvider.tsx'
import { localizedErrorCode } from '../api/errors.ts'
import { ProjectStoreProvider, useProjectState, useProjectStore } from '../state/ProjectStoreContext.tsx'

function ProjectContent({ projectId }: { readonly projectId: string }) {
  const { dictionary } = useLocale()
  const state = useProjectState()
  const store = useProjectStore()

  if (state.phase === 'loading' && state.snapshot === undefined) {
    return (
      <AppShell projectId={projectId} projectState={state}>
        <div style={{ display: 'grid', minHeight: '50vh', placeItems: 'center' }}>
          <Spin size="large" />
        </div>
      </AppShell>
    )
  }

  if (state.snapshot === undefined) {
    return (
      <AppShell projectId={projectId} projectState={state}>
        <Result
          status="error"
          title={dictionary.errors.loadProject}
          subTitle={localizedErrorCode(
            state.errorCode,
            dictionary.errors,
            dictionary.errors.loadProject,
          )}
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => { void store.start() }}>
              {dictionary.common.retry}
            </Button>
          }
        />
      </AppShell>
    )
  }

  return (
    <AppShell projectId={projectId} projectState={state}>
      {state.errorCode === undefined ? null : (
        <div role="alert" style={{ marginBottom: 12, color: '#b91c1c' }}>
          {localizedErrorCode(
            state.errorCode,
            dictionary.errors,
            dictionary.errors.realtimeData,
          )}
        </div>
      )}
      <Outlet />
    </AppShell>
  )
}

/** Load one durable project before rendering any project-scoped view. */
export function ProjectRoute() {
  const { projectId } = useParams()
  if (projectId === undefined || projectId === '') throw new Error('Project route requires a projectId')
  return (
    <ProjectStoreProvider projectId={projectId}>
      <ProjectContent projectId={projectId} />
    </ProjectStoreProvider>
  )
}
