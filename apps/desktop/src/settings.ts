/** API-key persistence for the desktop shell, encrypted with the OS credential store. */
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appendLog } from './log.js'
import { isPortableMode } from './portable.js'

interface StoredSettings {
  readonly version: 1
  readonly portable?: boolean
  readonly apiKey?: { readonly encrypted?: string; readonly plain?: string }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Read the configured DeepSeek API key.
 *
 * `DEEPSEEK_API_KEY` wins so development and CI can bypass the first-run dialog.
 * @returns the key, or `undefined` when no usable key is stored.
 */
export function loadApiKey(): string | undefined {
  const environmentKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (environmentKey !== undefined && environmentKey !== '') return environmentKey
  const path = settingsPath()
  if (!existsSync(path)) return undefined
  if (isPortableMode()) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredSettings
      const plain = parsed.apiKey?.plain
      if (typeof plain === 'string' && plain.trim() !== '') return plain.trim()
    } catch (error) {
      appendLog(`settings: failed to read the portable API key: ${String(error)}`)
    }
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredSettings
    const encrypted = parsed.apiKey?.encrypted
    if (typeof encrypted !== 'string' || encrypted.length === 0) return undefined
    if (!safeStorage.isEncryptionAvailable()) {
      appendLog('settings: OS credential encryption is unavailable; ignoring the stored key')
      return undefined
    }
    const key = safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim()
    return key === '' ? undefined : key
  } catch (error) {
    appendLog(`settings: failed to read the stored API key: ${String(error)}`)
    return undefined
  }
}

/**
 * Encrypt and persist the API key.
 * @param key - non-empty DeepSeek API key.
 */
export function saveApiKey(key: string): void {
  const trimmed = key.trim()
  if (trimmed === '') throw new Error('API Key 不能为空')
  if (isPortableMode()) {
    const path = settingsPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ version: 1, portable: true, apiKey: { plain: trimmed } }, null, 2)}\n`,
      { mode: 0o600 },
    )
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全存储，无法保存 API Key')
  const encrypted = safeStorage.encryptString(trimmed).toString('base64')
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ version: 1, apiKey: { encrypted } }, null, 2)}\n`, { mode: 0o600 })
}
