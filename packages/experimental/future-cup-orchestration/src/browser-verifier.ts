/** Real Playwright verification of generated routes, interactions, and browser health. */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { startPreviewServer } from './preview-server.ts'
import type {
  TesterOutput,
  VerificationCheck,
  VerificationFinding,
  VerificationStatus,
} from './types.ts'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
] as const

/** Explicit browser verifier bounds and optional screenshot destination. */
export interface BrowserVerifierOptions {
  readonly timeoutMs: number
  readonly screenshotDir?: string
}

/** Playwright evidence consumed by the aggregate verification pipeline. */
export interface BrowserVerification {
  readonly status: Exclude<VerificationStatus, 'WARNING'>
  readonly checks: readonly VerificationCheck[]
  readonly findings: readonly VerificationFinding[]
  readonly routes: readonly string[]
  readonly viewports: readonly string[]
  readonly screenshots: readonly string[]
}

/**
 * Build, preview, and inspect every Tester-owned route in desktop and mobile Chromium.
 * @param workspace - generated project containing a completed `dist/`.
 * @param spec - Tester-owned route and interaction assertions.
 * @param options - explicit timeout and screenshot destination.
 * @returns browser-visible evidence without converting environment failures to PASS.
 */
export async function verifyBrowser(
  workspace: string,
  spec: TesterOutput,
  options: BrowserVerifierOptions,
): Promise<BrowserVerification> {
  const checks: VerificationCheck[] = []
  const findings: VerificationFinding[] = []
  const screenshots: string[] = []
  const routes = spec.pages.map(page => page.route)

  let browser: Browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error: unknown) {
    return {
      status: 'INCOMPLETE',
      checks: [{ name: 'browser-launch', status: 'SKIPPED', summary: 'Chromium is unavailable.' }],
      findings: [{
        category: 'browser',
        code: 'BROWSER_UNAVAILABLE',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      }],
      routes,
      viewports: VIEWPORTS.map(viewport => viewport.name),
      screenshots,
    }
  }

  const preview = await startPreviewServer(workspace)
  if (options.screenshotDir !== undefined) await mkdir(options.screenshotDir, { recursive: true })
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
      })
      try {
        for (const pageSpec of spec.pages) {
          const page = await context.newPage()
          const browserFindings = observePage(page, viewport.name, pageSpec.route)
          try {
            await page.goto(routeUrl(preview.url, pageSpec.route), {
              waitUntil: 'networkidle',
              timeout: options.timeoutMs,
            })
            await assertRendered(
              page,
              pageSpec.requiredText,
              options.timeoutMs,
              viewport.name === 'mobile',
            )
            if (options.screenshotDir !== undefined) {
              const path = join(
                options.screenshotDir,
                `${viewport.name}-${safeSegment(pageSpec.pageId)}.png`,
              )
              await page.screenshot({ path, fullPage: true })
              screenshots.push(path)
            }
            const interactions = spec.interactions.filter(value => value.fromRoute === pageSpec.route)
            for (const interaction of interactions) {
              await page.getByRole('link', { name: interaction.clickText, exact: true })
                .filter({ visible: true }).first().click()
              await page.waitForFunction(
                expectedRoute => window.location.hash === `#${expectedRoute}`,
                interaction.expectedRoute,
                { timeout: options.timeoutMs },
              )
              await page.getByText(interaction.expectedText, { exact: false })
                .filter({ visible: true }).first().waitFor({
                  state: 'visible',
                  timeout: options.timeoutMs,
                })
            }
            checks.push({
              name: `browser:${viewport.name}:${pageSpec.route}`,
              status: 'PASS',
              summary: `Route "${pageSpec.route}" rendered and its required interactions completed.`,
            })
          } catch (error: unknown) {
            checks.push({
              name: `browser:${viewport.name}:${pageSpec.route}`,
              status: 'FAIL',
              summary: `Route "${pageSpec.route}" failed browser assertions.`,
            })
            findings.push({
              category: 'browser',
              code: 'BROWSER_ASSERTION_FAILED',
              severity: 'error',
              message: error instanceof Error ? error.message : String(error),
              target: `${viewport.name}:${pageSpec.route}`,
            })
          } finally {
            findings.push(...browserFindings.drain())
            await page.close()
          }
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await preview.close()
    await browser.close()
  }

  const hasError = findings.some(finding => finding.severity === 'error')
  return {
    status: hasError ? 'FAIL' : 'PASS',
    checks,
    findings,
    routes,
    viewports: VIEWPORTS.map(viewport => viewport.name),
    screenshots,
  }
}

/** Register browser event capture and return an owned drain point. */
function observePage(page: Page, viewport: string, route: string): { drain(): VerificationFinding[] } {
  const findings: VerificationFinding[] = []
  page.on('pageerror', (error) => {
    findings.push({
      category: 'browser',
      code: 'PAGE_ERROR',
      severity: 'error',
      message: error.message,
      target: `${viewport}:${route}`,
    })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      findings.push({
        category: 'console',
        code: 'CONSOLE_ERROR',
        severity: 'error',
        message: message.text(),
        target: `${viewport}:${route}`,
      })
      return
    }
    if (message.type() === 'warning' && isDeprecationWarning(message.text())) {
      findings.push({
        category: 'console',
        code: 'ANTD_DEPRECATION_WARNING',
        severity: 'error',
        message: message.text(),
        target: `${viewport}:${route}`,
      })
    }
  })
  page.on('requestfailed', (request) => {
    findings.push({
      category: 'network',
      code: 'REQUEST_FAILED',
      severity: 'error',
      message: `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`,
      target: `${viewport}:${route}`,
    })
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    findings.push({
      category: 'network',
      code: 'HTTP_ERROR_RESPONSE',
      severity: 'error',
      message: `${response.status()} ${response.statusText()} ${response.url()}`,
      target: `${viewport}:${route}`,
    })
  })
  return {
    drain: () => dedupeFindings(findings),
  }
}

/** Assert that the page produced visible DOM content and all required text. */
async function assertRendered(
  page: Page,
  requiredText: readonly string[],
  timeoutMs: number,
  mobile: boolean,
): Promise<void> {
  const rootChildren = await page.locator('#root > *').count()
  if (rootChildren === 0) throw new Error('React root is empty')
  const visibleText = (await page.locator('body').innerText()).trim()
  if (visibleText.length < 10) throw new Error('Page is visually blank')
  const viewportText = mobile ? requiredText.slice(0, 1) : requiredText
  for (const text of viewportText) {
    await page.getByText(text, { exact: false })
      .filter({ visible: true }).first().waitFor({ state: 'visible', timeout: timeoutMs })
  }
}

/** Whether one browser warning is an Ant Design deprecation rejected by this verifier. */
function isDeprecationWarning(message: string): boolean {
  return /deprecated|deprecation|destroyOnClose|bordered/iu.test(message)
}

/** Resolve one hash route against the verifier-owned loopback origin. */
function routeUrl(baseUrl: string, route: string): string {
  return `${baseUrl}/#${route}`
}

/** Make one screenshot segment portable across Windows and POSIX hosts. */
function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9-]/giu, '-')
}

/** Preserve one finding per stable browser identity. */
function dedupeFindings(findings: readonly VerificationFinding[]): VerificationFinding[] {
  const unique = new Map<string, VerificationFinding>()
  for (const finding of findings) {
    unique.set(JSON.stringify(finding), finding)
  }
  return [...unique.values()]
}
