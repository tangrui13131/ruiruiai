/** Localized display text for verification pipeline check names and summaries. */

import type { Dictionary } from '../locale/types.ts'

type CheckLabels = Dictionary['verification']['checkLabels']
type CheckSummaries = Dictionary['verification']['checkSummaries']

/** Pipeline check name → dictionary key in `verification.checkLabels`. */
const checkLabelKeys: Record<string, keyof CheckLabels> = {
  'project-structure': 'projectStructure',
  'dependency-install': 'dependencyInstall',
  'typescript': 'typescript',
  'vite-build': 'viteBuild',
  'bundle-coverage': 'bundleCoverage',
  'browser': 'browser',
  'browser-launch': 'browserLaunch',
  'browser-environment': 'browserEnvironment',
}

/** Pipeline check name → per-status dictionary key in `verification.checkSummaries`. */
const checkSummaryKeys: Record<string, Record<string, keyof CheckSummaries>> = {
  'project-structure': { PASS: 'projectStructurePass', FAIL: 'projectStructureFail' },
  'dependency-install': { PASS: 'dependencyInstallPass', FAIL: 'dependencyInstallFail' },
  'typescript': { PASS: 'typescriptPass', FAIL: 'typescriptFail' },
  'vite-build': { PASS: 'viteBuildPass', FAIL: 'viteBuildFail' },
  'bundle-coverage': { PASS: 'bundleCoveragePass', FAIL: 'bundleCoverageFail' },
  'browser': { SKIPPED: 'browserSkipped' },
  'browser-launch': { SKIPPED: 'browserLaunchSkipped' },
  'browser-environment': { SKIPPED: 'browserEnvironmentSkipped' },
}

/** Parsed parts of a `browser:${viewport}:${route}` check name. */
interface BrowserCheckName {
  readonly viewport: string
  readonly route: string
}

/**
 * Parse one dynamic browser check name.
 * @param name - raw check name from the verification pipeline.
 * @returns viewport and route parts, or undefined for non-browser check names.
 */
function parseBrowserCheckName(name: string): BrowserCheckName | undefined {
  if (!name.startsWith('browser:')) return undefined
  const rest = name.slice('browser:'.length)
  const separator = rest.indexOf(':')
  if (separator === -1) return undefined
  return { viewport: rest.slice(0, separator), route: rest.slice(separator + 1) }
}

/**
 * Render the 检查项 label for one verification check.
 * @param dictionary - active locale dictionary.
 * @param name - raw check name from the verification pipeline.
 * @returns localized label; unknown names fall back to the raw name.
 */
export function verificationCheckLabel(dictionary: Dictionary, name: string): string {
  const browser = parseBrowserCheckName(name)
  if (browser !== undefined) {
    const viewports = dictionary.verification.viewportNames
    const viewport = browser.viewport in viewports
      ? viewports[browser.viewport as keyof typeof viewports]
      : browser.viewport
    return dictionary.verification.browserCheckLabel
      .replace('{viewport}', viewport)
      .replace('{route}', browser.route)
  }
  const key: keyof CheckLabels | undefined = checkLabelKeys[name]
  return key === undefined ? name : dictionary.verification.checkLabels[key]
}

/**
 * Render the 问题 text for one verification check.
 * @param dictionary - active locale dictionary.
 * @param name - raw check name from the verification pipeline.
 * @param status - raw check status (PASS / FAIL / SKIPPED / WARNING).
 * @param summary - original pipeline summary used when no localized text exists.
 * @returns localized summary; unknown name/status combinations fall back to the original summary.
 */
export function verificationCheckSummary(
  dictionary: Dictionary,
  name: string,
  status: string,
  summary: string,
): string {
  const browser = parseBrowserCheckName(name)
  if (browser !== undefined) {
    if (status === 'PASS') return dictionary.verification.checkSummaries.browserRoutePass.replace('{route}', browser.route)
    if (status === 'FAIL') return dictionary.verification.checkSummaries.browserRouteFail.replace('{route}', browser.route)
    return summary
  }
  const statusKeys = checkSummaryKeys[name]
  const key: keyof CheckSummaries | undefined = statusKeys === undefined ? undefined : statusKeys[status]
  return key === undefined ? summary : dictionary.verification.checkSummaries[key]
}
