import { App as AntApp, ConfigProvider, Spin } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell.tsx'
import { LocaleProvider, useLocale } from './locale/LocaleProvider.tsx'
import { ProjectRoute } from './routes/ProjectRoute.tsx'
import { managementTheme } from './theme.ts'

const ProjectsPage = lazy(async () => {
  const module = await import('./pages/ProjectsPage.tsx')
  return { default: module.ProjectsPage }
})
const TeamBuilderPage = lazy(async () => {
  const module = await import('./pages/TeamBuilderPage.tsx')
  return { default: module.TeamBuilderPage }
})
const MyTeamsPage = lazy(async () => {
  const module = await import('./pages/MyTeamsPage.tsx')
  return { default: module.MyTeamsPage }
})
const ProjectOverviewPage = lazy(async () => {
  const module = await import('./pages/ProjectOverviewPage.tsx')
  return { default: module.ProjectOverviewPage }
})
const DagPage = lazy(async () => {
  const module = await import('./pages/DagPage.tsx')
  return { default: module.DagPage }
})
const SchedulerPage = lazy(async () => {
  const module = await import('./pages/SchedulerPage.tsx')
  return { default: module.SchedulerPage }
})
const VerificationPage = lazy(async () => {
  const module = await import('./pages/VerificationPage.tsx')
  return { default: module.VerificationPage }
})
const RepairsPage = lazy(async () => {
  const module = await import('./pages/RepairsPage.tsx')
  return { default: module.RepairsPage }
})
const EventsPage = lazy(async () => {
  const module = await import('./pages/EventsPage.tsx')
  return { default: module.EventsPage }
})
const DeliveryPage = lazy(async () => {
  const module = await import('./pages/DeliveryPage.tsx')
  return { default: module.DeliveryPage }
})

function RouteLoading() {
  const { dictionary } = useLocale()
  return (
    <div style={{ display: 'grid', minHeight: '45vh', placeItems: 'center' }}>
      <Spin size="large" aria-label={dictionary.common.loading} />
    </div>
  )
}

function RoutedApplication() {
  const { locale } = useLocale()
  return (
    <ConfigProvider
      locale={locale === 'zh-CN' ? zhCN : enUS}
      theme={managementTheme}
    >
      <AntApp>
        <HashRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<AppShell><ProjectsPage /></AppShell>} />
              <Route path="/teams" element={<AppShell><MyTeamsPage /></AppShell>} />
              <Route path="/team-builder" element={<AppShell><TeamBuilderPage /></AppShell>} />
              <Route path="/projects/:projectId" element={<ProjectRoute />}>
                <Route index element={<ProjectOverviewPage />} />
                <Route path="dag" element={<DagPage />} />
                <Route path="scheduler" element={<SchedulerPage />} />
                <Route path="verification" element={<VerificationPage />} />
                <Route path="repairs" element={<RepairsPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="delivery" element={<DeliveryPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  )
}

/** Compose locale, theme, Ant Design feedback, routing, and the management shell. */
export function App() {
  return (
    <LocaleProvider>
      <RoutedApplication />
    </LocaleProvider>
  )
}
