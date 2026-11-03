/** Fault injection and golden workspace management for self-healing drills. */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  frontendOutputSchema,
  integrationOutputSchema,
  uiDesignerOutputSchema,
} from './schemas.ts'
import {
  renderDesignStylesheet,
  writeProjectScaffold,
  writeScopedFiles,
} from './project-scaffold.ts'
import type { TaskSnapshot, TesterOutput } from './types.ts'

/** Supported fault injection and drill modes. */
export const FAULT_DRILL_MODES = [
  'preset:typescript-contract',
  'preset:browser-behavior',
  'manual:workspace',
  'restore:golden',
] as const

/** Validated drill mode schema. */
export const faultDrillModeSchema = z.enum(FAULT_DRILL_MODES)

/** Drill mode type. */
export type FaultDrillMode = z.infer<typeof faultDrillModeSchema>

/** Summary of one fault injection action. */
export interface FaultInjectionResult {
  readonly mode: FaultDrillMode
  readonly targetFile?: string | undefined
  readonly description: string
}

const TS_CONTRACT_FAULT_BLOCK = [
  '',
  '// [fault-drill:typescript-contract]',
  'interface DrillExpectedContract { readonly metricValue: number }',
  'export const __drillContractFault: DrillExpectedContract = { metricValue: "CONTRACT_TYPE_MISMATCH" }',
  '// end [fault-drill:typescript-contract]',
  '',
].join('\n')

/**
 * Persist the current workspace src/ directory as the golden baseline.
 * @param workspace - generated project root.
 * @returns a promise that resolves when the golden snapshot is persisted.
 */
export async function saveGoldenWorkspaceSnapshot(workspace: string): Promise<void> {
  const srcDir = resolve(workspace, 'src')
  const goldenDir = resolve(workspace, '.golden-src')
  if (!existsSync(srcDir)) {
    throw new Error(`Cannot save golden snapshot; src directory missing at "${srcDir}"`)
  }
  await rm(goldenDir, { recursive: true, force: true })
  await mkdir(goldenDir, { recursive: true })
  await cp(srcDir, goldenDir, { recursive: true })
}

/**
 * Restore the workspace src/ directory from the golden baseline if present.
 * @param workspace - generated project root.
 * @returns whether the golden snapshot existed and was restored.
 */
export async function restoreGoldenWorkspaceSnapshot(workspace: string): Promise<boolean> {
  const srcDir = resolve(workspace, 'src')
  const goldenDir = resolve(workspace, '.golden-src')
  if (!existsSync(goldenDir)) return false
  await rm(srcDir, { recursive: true, force: true })
  await mkdir(srcDir, { recursive: true })
  await cp(goldenDir, srcDir, { recursive: true })
  return true
}

/**
 * Reconstruct the pristine golden workspace from task outputs when no snapshot exists.
 * @param workspace - generated project root.
 * @param tasks - completed generation task snapshots.
 * @returns whether reconstruction succeeded.
 */
export async function reconstructGoldenWorkspace(
  workspace: string,
  tasks: readonly TaskSnapshot[],
): Promise<boolean> {
  writeProjectScaffold(workspace)
  for (const task of tasks) {
    if (task.status !== 'COMPLETED' || task.result === undefined) continue
    if (task.role === 'ui-designer') {
      const design = uiDesignerOutputSchema.parse(task.result)
      writeScopedFiles(workspace, [
        { path: 'src/design.css', content: renderDesignStylesheet(design.tokens) },
      ], ['src/'])
    } else if (task.role === 'frontend') {
      const page = frontendOutputSchema.parse(task.result)
      writeScopedFiles(workspace, page.files, ['src/'])
    } else if (task.role === 'integration') {
      const integration = integrationOutputSchema.parse(task.result)
      writeScopedFiles(workspace, integration.files, ['src/'])
    }
  }
  await saveGoldenWorkspaceSnapshot(workspace)
  return true
}

/**
 * Ensure a golden snapshot exists in the workspace, creating or reconstructing it if needed.
 * @param workspace - generated project root.
 * @param tasks - optional completed generation task snapshots.
 * @returns whether a golden snapshot is ready.
 */
export async function ensureGoldenWorkspaceSnapshot(
  workspace: string,
  tasks?: readonly TaskSnapshot[],
): Promise<boolean> {
  const goldenDir = resolve(workspace, '.golden-src')
  if (existsSync(goldenDir)) return true
  if (tasks !== undefined && tasks.length > 0) {
    return await reconstructGoldenWorkspace(workspace, tasks)
  }
  const srcDir = resolve(workspace, 'src')
  if (existsSync(srcDir)) {
    await saveGoldenWorkspaceSnapshot(workspace)
    return true
  }
  return false
}

/**
 * Inject deterministic faults or manage golden source state for self-healing drills.
 * @param workspace - generated project root.
 * @param mode - selected drill mode.
 * @param spec - Tester-owned verification specification.
 * @returns evidence of the injection action taken.
 */
export async function injectFault(
  workspace: string,
  mode: FaultDrillMode,
  spec: TesterOutput,
): Promise<FaultInjectionResult> {
  switch (mode) {
    case 'manual:workspace':
      return {
        mode,
        description: 'Using current workspace disk state without modifications.',
      }

    case 'restore:golden': {
      const restored = await restoreGoldenWorkspaceSnapshot(workspace)
      if (!restored) {
        throw new Error('Golden workspace snapshot does not exist; cannot restore.')
      }
      return {
        mode,
        description: 'Restored workspace to pristine golden source.',
      }
    }

    case 'preset:typescript-contract': {
      await restoreGoldenWorkspaceSnapshot(workspace)
      const targetRel = 'src/App.tsx'
      const targetAbs = resolve(workspace, targetRel)
      if (!existsSync(targetAbs)) {
        throw new Error(`Target file "${targetRel}" does not exist in workspace.`)
      }
      const existing = await readFile(targetAbs, 'utf8')
      const mutated = `${existing.trimEnd()}\n${TS_CONTRACT_FAULT_BLOCK}`
      await writeFile(targetAbs, mutated, 'utf8')
      return {
        mode,
        targetFile: targetRel,
        description: 'Injected TypeScript contract type mismatch into App.tsx.',
      }
    }

    case 'preset:browser-behavior': {
      await restoreGoldenWorkspaceSnapshot(workspace)
      const targetText = spec.pages[0]?.requiredText[0]
      if (targetText === undefined || targetText === '') {
        throw new Error('Verification specification has no required page text to mutate.')
      }
      const candidateFiles = ['src/App.tsx']
      const srcPages = resolve(workspace, 'src', 'pages')
      if (existsSync(srcPages)) {
        const entries = await import('node:fs/promises').then(fs => fs.readdir(srcPages))
        for (const entry of entries) {
          if (entry.endsWith('.tsx')) {
            candidateFiles.unshift(`src/pages/${entry}`)
          }
        }
      }

      let mutatedFile: string | undefined
      for (const rel of candidateFiles) {
        const abs = resolve(workspace, rel)
        if (!existsSync(abs)) continue
        const content = await readFile(abs, 'utf8')
        if (content.includes(targetText)) {
          const mutated = content.replace(targetText, `__MUTATED_${targetText}__`)
          await writeFile(abs, mutated, 'utf8')
          mutatedFile = rel
          break
        }
      }

      if (mutatedFile === undefined) {
        const appPath = resolve(workspace, 'src/App.tsx')
        if (!existsSync(appPath)) {
          throw new Error('Could not find candidate file to mutate for browser assertion fault.')
        }
        const content = await readFile(appPath, 'utf8')
        const mutated = `${content.trimEnd()}\n// [browser-fault]\nexport const __drillHidden = false\n`
        await writeFile(appPath, mutated, 'utf8')
        mutatedFile = 'src/App.tsx'
      }

      return {
        mode,
        targetFile: mutatedFile,
        description: `Mutated expected text "${targetText}" in ${mutatedFile} to trigger Playwright browser assertion failure.`,
      }
    }
  }
}
