import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  BranchesOutlined,
  DashboardOutlined,
  FundProjectionScreenOutlined,
  MenuOutlined,
  ProjectOutlined,
  RobotOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  TranslationOutlined,
} from '@ant-design/icons'
import {
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Space,
  Tooltip,
} from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useLocale } from '../locale/LocaleProvider.tsx'
import type { ProjectStoreState } from '../state/project-store.ts'
import { ConnectionBadge } from './ConnectionBadge.tsx'
import { ProjectActions } from './ProjectActions.tsx'
import { StatusBadge } from './StatusBadge.tsx'

const { Header, Sider, Content } = Layout

function useNavigation(projectId?: string): MenuProps['items'] {
  const { dictionary } = useLocale()
  if (projectId === undefined) {
    return [
      {
        key: 'projects',
        icon: <ProjectOutlined />,
        label: <Link to="/">{dictionary.nav.projects}</Link>,
      },
      {
        key: 'agents',
        icon: <RobotOutlined />,
        label: <Link to="/agents">{dictionary.nav.agents}</Link>,
      },
      {
        key: 'teams',
        icon: <TeamOutlined />,
        label: <Link to="/teams">{dictionary.nav.teams}</Link>,
      },
      {
        key: 'team-builder',
        icon: <TeamOutlined />,
        label: <Link to="/team-builder">{dictionary.teamBuilder.entry}</Link>,
      },
    ]
  }
  const base = `/projects/${encodeURIComponent(projectId)}`
  return [
    {
      key: 'overview',
      icon: <DashboardOutlined />,
      label: <Link to={base}>{dictionary.nav.overview}</Link>,
    },
    {
      key: 'dag',
      icon: <ApartmentOutlined />,
      label: <Link to={`${base}/dag`}>{dictionary.nav.dag}</Link>,
    },
    {
      key: 'scheduler',
      icon: <BranchesOutlined />,
      label: <Link to={`${base}/scheduler`}>{dictionary.nav.scheduler}</Link>,
    },
    {
      key: 'verification',
      icon: <SafetyCertificateOutlined />,
      label: <Link to={`${base}/verification`}>{dictionary.nav.verification}</Link>,
    },
    {
      key: 'repairs',
      icon: <ToolOutlined />,
      label: <Link to={`${base}/repairs`}>{dictionary.nav.repairs}</Link>,
    },
    {
      key: 'events',
      icon: <ThunderboltOutlined />,
      label: <Link to={`${base}/events`}>{dictionary.nav.events}</Link>,
    },
    {
      key: 'delivery',
      icon: <RocketOutlined />,
      label: <Link to={`${base}/delivery`}>{dictionary.nav.delivery}</Link>,
    },
    {
      key: 'hq',
      icon: <FundProjectionScreenOutlined />,
      label: (
        <a
          className="app-sider-menu-link"
          href={`/hq/index.html?projectId=${encodeURIComponent(projectId)}`}
          target="_blank"
          rel="noreferrer"
        >
          {dictionary.nav.hq}
        </a>
      ),
    },
  ]
}

function selectedKey(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  const projectIndex = segments.indexOf('projects')
  return segments[projectIndex + 2] ?? 'overview'
}

function LanguageMenu() {
  const { locale, setLocale, dictionary } = useLocale()
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectedKeys: [locale],
        items: [
          { key: 'zh-CN', label: dictionary.chinese },
          { key: 'en', label: dictionary.english },
        ],
        onClick: ({ key }) => { setLocale(key === 'en' ? 'en' : 'zh-CN') },
      }}
    >
      <Tooltip title={dictionary.language}>
        <Button type="text" icon={<TranslationOutlined />} aria-label={dictionary.language} />
      </Tooltip>
    </Dropdown>
  )
}

/** Render the management application's navigation and project chrome. */
export function AppShell({
  projectId,
  projectState,
  children,
}: {
  readonly projectId?: string
  readonly projectState?: ProjectStoreState
  readonly children: ReactNode
}) {
  const { dictionary } = useLocale()
  const location = useLocation()
  const screens = Grid.useBreakpoint()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const project = projectState?.snapshot?.project
  const items = useNavigation(projectId)
  const activeKey = projectId === undefined
    ? location.pathname === '/team-builder'
      ? 'team-builder'
      : location.pathname === '/agents'
        ? 'agents'
        : location.pathname === '/teams' ? 'teams' : 'projects'
    : selectedKey(location.pathname)
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[activeKey]}
      items={items}
      onClick={() => { setDrawerOpen(false) }}
    />
  )
  const sidebar = (
    <>
      <div className="app-brand">
        <div className="app-brand-mark">FC</div>
        <div className="app-brand-copy">
          <span className="app-brand-title">{dictionary.appName}</span>
          <span className="app-brand-subtitle">{dictionary.appSubtitle}</span>
        </div>
      </div>
      {project === undefined ? null : (
        <div className="app-sider-project">
          <Link
            className="app-sider-project-back"
            to="/"
            onClick={() => { setDrawerOpen(false) }}
          >
            <ArrowLeftOutlined />
            <span>{dictionary.common.backToProjects}</span>
          </Link>
          <span className="app-sider-project-name">{project.name}</span>
        </div>
      )}
      {menu}
    </>
  )

  return (
    <Layout className="app-shell">
      {screens.lg === true ? (
        <Sider width={232} className="app-sider">{sidebar}</Sider>
      ) : (
        <Drawer
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false) }}
          placement="left"
          size={260}
          styles={{ body: { padding: 0, background: '#17211d' } }}
          title={null}
        >
          {sidebar}
        </Drawer>
      )}
      <Layout className="app-main">
        <Header className="app-header">
          <div className="app-header-leading">
            {screens.lg === true ? null : (
              <Tooltip title={dictionary.common.menu}>
                <Button
                  className="mobile-menu-button"
                  type="text"
                  icon={<MenuOutlined />}
                  aria-label={dictionary.common.menu}
                  onClick={() => { setDrawerOpen(true) }}
                />
              </Tooltip>
            )}
            <div className="app-header-title">
              <h1>{project?.name ?? dictionary.appName}</h1>
              <p>{project?.requirement ?? dictionary.appSubtitle}</p>
            </div>
            {project === undefined ? null : (
              <Space size={6}>
                <StatusBadge status={
                  projectState?.snapshot?.runs?.at(-1)?.status
                  ?? project.workflowStatus
                  ?? project.latestRunStatus
                  ?? 'PENDING'
                } />
                <ConnectionBadge status={projectState?.connection ?? 'disconnected'} />
              </Space>
            )}
          </div>
          <div className="app-header-actions">
            {projectId === undefined ? null : <ProjectActions projectId={projectId} compact />}
            <LanguageMenu />
          </div>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
