import { App } from 'antd'
import { useState } from 'react'
import { api } from '../api/client.ts'
import { localizedApiError } from '../api/errors.ts'
import { useLocale } from '../locale/LocaleProvider.tsx'

/** Run project start and cancel commands with shared pending and feedback state. */
export function useProjectCommands(projectId: string, onChanged: () => void | Promise<void>) {
  const { dictionary } = useLocale()
  const { message } = App.useApp()
  const [pending, setPending] = useState<'run' | 'cancel' | 'rerun'>()

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
      const cancelled = await api.cancelRun(projectId)
      if (!cancelled) {
        message.error(dictionary.errors.cancelProject)
        await onChanged()
        return
      }
      message.success(dictionary.projects.cancelled)
      await onChanged()
    } catch (error: unknown) {
      message.error(localizedApiError(error, dictionary.errors, dictionary.errors.cancelProject))
    } finally {
      setPending(undefined)
    }
  }

  async function rerun(name: string): Promise<string | undefined> {
    setPending('rerun')
    try {
      const result = await api.rerunProject(projectId, { name })
      message.success(dictionary.projects.rerunStarted)
      await onChanged()
      return result.project.id
    } catch (error: unknown) {
      message.error(localizedApiError(error, dictionary.errors, dictionary.errors.rerunProject))
      return undefined
    } finally {
      setPending(undefined)
    }
  }

  return { pending, start, cancel, rerun }
}
