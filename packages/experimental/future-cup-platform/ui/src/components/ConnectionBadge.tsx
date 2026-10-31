import { Badge, Tooltip } from 'antd'
import type { BadgeProps } from 'antd'
import { useLocale } from '../locale/LocaleProvider.tsx'
import type { RealtimeStatus } from '../realtime/project-socket.ts'

const STATUS_COLOR: Readonly<Record<RealtimeStatus, BadgeProps['status']>> = {
  connected: 'success',
  connecting: 'processing',
  reconnecting: 'warning',
  disconnected: 'error',
}

/** Render realtime connectivity with text available through a tooltip. */
export function ConnectionBadge({ status }: { readonly status: RealtimeStatus }) {
  const { dictionary } = useLocale()
  const label = status === 'connected'
    ? dictionary.common.connected
    : status === 'reconnecting' || status === 'connecting'
      ? dictionary.common.reconnecting
      : dictionary.common.disconnected
  return (
    <Tooltip title={label}>
      <Badge status={STATUS_COLOR[status]} text={<span className="desktop-only">{label}</span>} />
    </Tooltip>
  )
}
