import { App } from 'antd'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

/** Run project start and cancel commands with shared pending and feedback state. */
export function useProjectCommands(projectId: string, onChanged: () => void | Promise<void>) {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [pending, setPending] = useState<'run' | 'cancel'>()

  async function start(): Promise<void> {
    setPending('run')
    try {
      await api.startRun(projectId)
      message.success(dictionary.projects.started)
      await onChanged()
    } catch (error: unknown) {
      message.error(localizedApiError(error, dictionary.errors, dictionary.errors.runProject))
    } finally {
      setPending(undefined)
    }
  }

  async function cancel(): Promise<void> {
    setPending('cancel')
    try {
      await api.cancelRun(projectId)
      message.success(dictionary.projects.cancelled)
      await onChanged()
    } catch (error: unknown) {
      message.error(localizedApiError(error, dictionary.errors, dictionary.errors.cancelProject))
    } finally {
      setPending(undefined)
    }
  }

  return { pending, start, cancel }
}
