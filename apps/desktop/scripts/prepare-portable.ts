/** Bundle a portable Node.js and Playwright Chromium into the desktop runtime. */
import { spawnSync } from 'node:child_process'
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { resolve } from 'node:path'
import extract from 'extract-zip'

const appRoot = resolve(import.meta.dirname, '..')
const runtimeRoot = resolve(appRoot, 'runtime')
const cacheRoot = resolve(appRoot, '.cache')
const nodeDir = resolve(runtimeRoot, 'node')
const browsersDir = resolve(runtimeRoot, 'playwright-browsers')
const playwrightCli = resolve(runtimeRoot, 'app/node_modules/playwright/cli.js')
const NODE_VERSION = '24.15.0'
const NODE_URL = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: ${String(response.status)} ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path))
}

async function main(): Promise<void> {
  if (!existsSync(playwrightCli)) {
    throw new Error(`runtime closure is missing ${playwrightCli}; run prepare:runtime first`)
  }
  mkdirSync(cacheRoot, { recursive: true })
  mkdirSync(browsersDir, { recursive: true })

  if (!existsSync(resolve(nodeDir, 'node.exe'))) {
    const zip = resolve(cacheRoot, `node-v${NODE_VERSION}-win-x64.zip`)
    if (!existsSync(zip)) {
      console.log(`downloading ${NODE_URL}`)
      await download(NODE_URL, zip)
    }
    const extracted = resolve(cacheRoot, `node-v${NODE_VERSION}-win-x64`)
    rmSync(extracted, { recursive: true, force: true })
    await extract(zip, { dir: cacheRoot })
    rmSync(nodeDir, { recursive: true, force: true })
    mkdirSync(nodeDir, { recursive: true })
    cpSync(extracted, nodeDir, { recursive: true })
    console.log(`bundled Node ${NODE_VERSION} at ${nodeDir}`)
  } else {
    console.log(`Node already bundled at ${nodeDir}`)
  }

  if (process.env.SKIP_BROWSER === '1') {
    console.log('SKIP_BROWSER=1: leaving Playwright browsers unchanged')
  } else if (!existsSync(resolve(browsersDir, 'chromium-1255'))) {
    console.log('installing Playwright Chromium 1255')
    const result = spawnSync(resolve(nodeDir, 'node.exe'), [playwrightCli, 'install', 'chromium'], {
      cwd: appRoot,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Playwright install failed with exit code ${String(result.status)}`)
  } else {
    console.log(`Chromium already bundled at ${resolve(browsersDir, 'chromium-1255')}`)
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
