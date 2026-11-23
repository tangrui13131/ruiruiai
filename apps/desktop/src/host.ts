/** Lifecycle for the local dsh host that serves the Future Cup platform. */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { appendLog } from './log.js'
import { dataRoot, dshHome, resolveRuntimeRoot } from './paths.js'

const READY_PATTERN = /Future Cup Platform:\s*(http:\/\/\S+)/
const READY_TIMEOUT_MS = 120_000
const TAIL_LIMIT = 8_000

/** Startup stage reported to the splash window. */
export interface HostProgress {
  readonly percent: number
  readonly phase: 'starting' | 'port' | 'scheduler' | 'ready'
  readonly text: string
}

/** Options for starting the bundled host. */
export interface StartHostOptions {
  /** DeepSeek API key exported to the host process. */
  readonly apiKey: string
  /** Called synchronously after the host process is spawned. */
  readonly onSpawn?: (pid: number | undefined) => void
  /** Called when the host exits after it had already reported a ready URL. */
  readonly onUnexpectedExit?: (message: string) => void
  /** Called as the host moves through its startup stages. */
  readonly onProgress?: (progress: HostProgress) => void
}

/** A ready host and the lifecycle handle that stops it. */
export interface RunningHost {
  /** Platform URL reported by the host banner. */
  readonly url: string
  /** Terminate the host and its child processes. */
  stop(): Promise<void>
}

function tail(output: string): string {
  return output.slice(-TAIL_LIMIT).trim()
}

/**
 * Terminate a process and its descendants.
 * @param pid - process id reported by the spawned host.
 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (_error) {
    // The process may have exited between the check and the signal.
  }
}

/**
 * Start the bundled dsh CLI in Electron Node mode and wait for the platform banner.
 * @param options - API key and unexpected-exit callback.
 * @returns the ready URL and a stop handle.
 */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const closure = resolveRuntimeRoot()
  const entry = join(closure, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const data = dataRoot()
  const home = dshHome()
  mkdirSync(data, { recursive: true })
  mkdirSync(home, { recursive: true })

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    DSH_NO_OPEN: '1',
    FUTURE_CUP_PORT: '0',
    FUTURE_CUP_SQLITE_PATH: join(data, 'platform.sqlite'),
    FUTURE_CUP_RUN_ROOT: join(data, 'runs'),
    FUTURE_CUP_AGENT_HOME_ROOT: join(data, 'agent-homes'),
    DEEPSEEK_API_KEY: options.apiKey,
  }
  // A desktop launch must not inherit CI-specific host behavior from the shell.
  delete environment.CI

  const runtimeDir = dirname(closure)
  const bundledNode = join(runtimeDir, 'node')
  if (existsSync(join(bundledNode, 'node.exe'))) {
    const pathKey = Object.keys(environment).find(key => key.toUpperCase() === 'PATH') ?? 'Path'
    environment[pathKey] = `${bundledNode}${delimiter}${environment[pathKey] ?? ''}`
    appendLog(`host: bundled Node at ${bundledNode}`)
  }
  const bundledBrowsers = join(runtimeDir, 'playwright-browsers')
  if (existsSync(join(bundledBrowsers, 'chromium-1255'))) {
    environment.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers
    if (environment.FUTURE_CUP_BROWSER_CHANNEL === undefined || environment.FUTURE_CUP_BROWSER_CHANNEL === '') {
      environment.FUTURE_CUP_BROWSER_CHANNEL = 'chromium'
    }
    appendLog(`host: bundled Playwright browsers at ${bundledBrowsers}`)
  } else if (environment.FUTURE_CUP_BROWSER_CHANNEL === undefined || environment.FUTURE_CUP_BROWSER_CHANNEL === '') {
    environment.FUTURE_CUP_BROWSER_CHANNEL = 'msedge'
    appendLog('host: bundled Chromium missing; using system Edge for browser verification')
  }
  if (environment.npm_config_registry === undefined || environment.npm_config_registry === '') {
    environment.npm_config_registry = 'https://registry.npmmirror.com'
  }

  const report = (progress: HostProgress): void => {
    try {
      options.onProgress?.(progress)
    } catch (_error) {
      // A renderer that is already gone must not abort host startup.
    }
  }

  report({ percent: 12, phase: 'starting', text: '正在启动本地服务...' })
  appendLog(`host: starting ${entry} (cwd ${closure})`)
  const child: ChildProcess = spawn(process.execPath, ['--expose-internals', entry, 'web'], {
    cwd: closure,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  options.onSpawn?.(child.pid)
  report({ percent: 34, phase: 'port', text: '正在校验本地通信端口...' })
  const schedulerTimer = setTimeout(() => {
    report({ percent: 62, phase: 'scheduler', text: '正在初始化多 Agent 调度引擎...' })
  }, 700)

  let output = ''
  let ready = false
  let stopping = false
  const collect = (chunk: string): void => {
    output = (output + chunk).slice(-TAIL_LIMIT * 2)
    appendLog(`host: ${chunk.trimEnd()}`)
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(schedulerTimer)
      reject(new Error(`本地服务启动超时（${READY_TIMEOUT_MS / 1000} 秒）。\n${tail(output)}`))
    }, READY_TIMEOUT_MS)
    const inspect = (): void => {
      if (ready) return
      const match = READY_PATTERN.exec(output)
      if (match === null) return
      ready = true
      clearTimeout(timer)
      clearTimeout(schedulerTimer)
      report({ percent: 100, phase: 'ready', text: '本地服务已就绪' })
      resolve(match[1])
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      clearTimeout(schedulerTimer)
      if (ready || stopping) return
      reject(new Error(
        `本地服务在启动阶段退出（code ${String(code)}, signal ${String(signal)}）。\n${tail(output)}`,
      ))
    })
  })

  child.once('exit', (code, signal) => {
    if (!ready || stopping) return
    const message = `本地服务意外退出（code ${String(code)}, signal ${String(signal)}）。\n${tail(output)}`
    appendLog(`host: ${message}`)
    options.onUnexpectedExit?.(message)
  })

  return {
    url,
    async stop(): Promise<void> {
      if (child.exitCode !== null) return
      clearTimeout(schedulerTimer)
      stopping = true
      appendLog('host: stopping')
      if (child.pid !== undefined) killProcessTree(child.pid)
      else child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          resolve()
        }, 5_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}
