import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

function evaluateRunsOn(selector: unknown, context: Record<string, unknown>): unknown {
  if (typeof selector !== 'string') throw new TypeError('Runner selector must be a string')
  return runInNewContext(selector.trim().slice(3, -2), context, { timeout: 1000 })
}

const root = resolve(import.meta.dirname, '..')
const runnerPrivatePnpmDestination = /^\$\{\{ runner\.temp \}\}\/setup-pnpm-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/
const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}'

describe('CI workflow', () => {
  it('keeps the reusable builders outside ordinary CI jobs', () => {
    const builder = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    if (!isRecord(builder.jobs)) throw new TypeError('Python runtime builder must define jobs')
    expect(Object.keys(builder.jobs).sort()).toEqual(['build', 'plan', 'sdk-wheel'])
    const plan = workflowJob(builder, 'plan')
    const wheel = workflowJob(builder, 'sdk-wheel')
    const build = workflowJob(builder, 'build')
    expect(plan.needs).toBeUndefined()
    expect(plan.strategy).toBeUndefined()
    expect(plan.uses).toBeUndefined()
    expect(wheel.needs).toBe('plan')
    expect(wheel.strategy).toBeUndefined()
    expect(wheel.uses).toBeUndefined()
    expect(build.needs).toEqual(['plan', 'sdk-wheel'])
    expect(build.uses).toBeUndefined()
    if (!isRecord(build.strategy)) throw new TypeError('Python runtime build must define its target matrix')
    expect(build.strategy.matrix).toEqual({ include: '${{ fromJSON(needs.plan.outputs.matrix) }}' })
  })

  it('retains aggregate diagnostics in protected publication', () => {
    for (const [file, command] of [
      ['release-publish.yml', 'pnpm run build:official --serial'],
      ['release-vendor-publish.yml', 'pnpm run build:lib:host'],
    ] as const) {
      expect(workflowJob(loadWorkflow('.github/workflows/' + file), 'pack').steps)
        .toContainEqual(expect.objectContaining({ name: 'Build', run: command }))
    }
    const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const hostSteps = scripts.scripts['build:lib:host']!.split(' && ')
    expect(hostSteps[0]).toBe('tsx scripts/compile-referenced-projects.ts host-libraries')
    expect(hostSteps).toContain('node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc -p tsconfig.host.json')
    // This fork keeps no desktop bundle in the host library build.
    expect(hostSteps.at(-1)).toBe('node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc -p tsconfig.host.json')
    expect(scripts.scripts['build:lib:client']).toContain('tsc -b tsconfig.client.json')
    expect(scripts.scripts.typecheck).toBe('tsx scripts/build.ts --scope typecheck')
  })

  it('selects PR artifact compilation for the vendor release rehearsal', () => {
    const vendor = "${{ github.event_name == 'pull_request' && 'pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries' || 'pnpm run build:lib:host' }}"
    const job = workflowJob(loadWorkflow('.github/workflows/release-vendor.yml'), 'pack')
    if (!Array.isArray(job.steps)) throw new TypeError('pack must define steps')
    const step = job.steps.filter(isRecord).find(candidate => typeof candidate.run === 'string'
      && (candidate.run.includes('build:artifacts') || candidate.run.includes('host-libraries')))
    expect(step?.run).toBe(vendor)
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const expression = vendor.slice('${{ '.length, -' }}'.length)
      const selected: unknown = runInNewContext(expression, { github: { event_name: event } }, { timeout: 1000 })
      expect(selected).toBe(event === 'pull_request'
        ? 'pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries'
        : 'pnpm run build:lib:host')
    }
  })

  it('selects PR artifact compilation inside the Python executable builder', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), 'build')
    if (!Array.isArray(job.steps)) throw new TypeError('Python runtime builder must define steps')
    const steps = job.steps.filter(isRecord)
    const execute = steps.find(step => step.name === 'Build single-exe')
    expect(steps.some(step => step.run === 'pnpm run build:artifacts')).toBe(false)
    expect(execute).toMatchObject({
      env: { DSH_BUILD_CLIENT_PROFILE: 'official' },
    })
    if (typeof execute?.run !== 'string') throw new TypeError('Python executable builder must define a command')
    const expression = [...execute.run.matchAll(/\$\{\{ ([^{}]+) \}\}/g)]
      .map(match => match[1]).find(value => value?.startsWith('inputs.ci'))
    expect(expression).toBe("inputs.ci && github.event_name == 'pull_request' && '--build-artifacts' || ''")
    if (expression === undefined) throw new TypeError('Python executable builder must select its build mode')
    for (const ci of [false, true]) {
      for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
        const context = { inputs: { ci }, github: { event_name: event } }
        const selected: unknown = runInNewContext(expression, context, { timeout: 1000 })
        expect(selected).toBe(ci && event === 'pull_request' ? '--build-artifacts' : '')
      }
    }
  })

  it.each(['ci-master.yml', 'release-vendor.yml'])(
    '%s cancels superseded validation runs without crossing workflow or ref boundaries', (name) => {
      const workflow = loadWorkflow('.github/workflows/' + name)
      expect(workflow.concurrency).toEqual({
        group: '${{ github.workflow }}-${{ github.ref }}',
        'cancel-in-progress': true,
      })
    },
  )

  it('cancels reusable CI builds without cancelling release-owned builds', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflow.concurrency).toEqual({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': '${{ !inputs.release }}',
    })
  })

  it('does not cancel protected publication or deployment transactions', () => {
    for (const name of ['release-publish.yml', 'release-vendor-publish.yml']) {
      const publish = workflowJob(loadWorkflow('.github/workflows/' + name), 'publish')
      expect(publish.concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
    for (const name of ['python-release.yml', 'node-addon-system-release.yml', 'docs-pages.yml']) {
      expect(loadWorkflow('.github/workflows/' + name).concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
  })

  it('retains Wine cleanup on cancellation', () => {
    const wine = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), 'windows')
    expect(wine.steps).toContainEqual(expect.objectContaining({ name: 'Shut down wineserver', if: 'always()' }))
  })

  it('isolates every pnpm action setup destination per runner', () => {
    const files = ['.github/workflows/ci-master.yml']
    const setups: Array<{ jobName: string; step: unknown }> = []
    for (const file of files) {
      const workflow: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'))
      if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
          setups.push({ jobName, step })
        }
      }
    }

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      const stepDest = (step as { with?: { dest?: unknown } }).with?.dest
      if (jobName.startsWith('windows-')) {
        expect(stepDest, `${jobName} must use the native Windows pnpm destination`).toBe(nativeWindowsPnpmDestination)
        expect(step).not.toMatchObject({ with: { standalone: true } })
      } else {
        expect(typeof stepDest, `${jobName} must use a runner-and-run-private pnpm destination`).toBe('string')
        expect(stepDest as string).toMatch(runnerPrivatePnpmDestination)
      }
    }
  })

  it('isolates the python SDK exe pnpm setup destination per job', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/build-exe-for-python-sdk.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('build-exe-for-python-sdk.yml must define jobs')
    const setups: Array<{ step: unknown }> = []
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
        setups.push({ step })
      }
    }
    expect(setups.length).toBeGreaterThan(0)
    for (const { step } of setups) {
      expect(step).toMatchObject({
        with: { dest: nativeWindowsPnpmDestination },
      })
    }
  })

  it('gates standalone keyless blacksmith jobs and benchmark tiers on the failover variables', () => {
    const expectedFilenames = workflowJob(loadWorkflow('.github/workflows/expected-filenames.yml'), 'expected-filenames')
    const sandbox = workflowJob(loadWorkflow('.github/workflows/sandbox.yml'), 'sandbox-e2e')
    expect(expectedFilenames['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(expectedFilenames['runs-on']).toContain("== 'blacksmith'")
    expect(expectedFilenames['runs-on']).toContain('blacksmith-4vcpu-ubuntu-2404')
    expect(expectedFilenames['runs-on']).toContain("'ubuntu-latest'")
    expect(sandbox['runs-on']).toContain("matrix.runner == 'bwrap'")
    expect(sandbox['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(sandbox['runs-on']).toContain('blacksmith-4vcpu-ubuntu-2404')
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark'] as const) {
      const benchmark = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), name)
      if (!isRecord(benchmark.strategy) || !isRecord(benchmark.strategy.matrix) || !Array.isArray(benchmark.strategy.matrix.include)) {
        throw new TypeError(`${name} must define a matrix include list`)
      }
      expect(benchmark['runs-on']).toContain('matrix.blacksmith')
      expect(benchmark['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
      expect(benchmark['runs-on']).toContain('DSH_CI_FAILOVER_WINDOWS')
      for (const row of benchmark.strategy.matrix.include as Array<Record<string, string>>) {
        expect(typeof row.blacksmith, `${name} ${row.cores}-core row must declare a blacksmith label`).toBe('string')
        if (row.cores === '64' || row.cores === '96') {
          expect(row.blacksmith, `${name} ${row.cores}-core row has no Blacksmith tier`).toBe('')
        } else {
          expect(row.blacksmith).toContain(`blacksmith-${row.cores}vcpu`)
        }
      }
    }
  })

  it('splits the Wine Host TypeScript compile and retains its heap budget', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    const references = wineGates.indexOf(
      'wine_node "$scratch/logs/host-references.log" --import tsx/esm scripts/compile-referenced-projects.ts host',
    )
    const aggregate = wineGates.indexOf(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=8192 "$tsc_js" -p tsconfig.host.json --pretty false',
    )
    const metadata = wineGates.indexOf('wine_node "$scratch/logs/host-typert.log" --import tsx/esm scripts/generate-typert.ts')
    expect(metadata).toBeGreaterThan(-1)
    expect(references).toBeGreaterThan(metadata)
    expect(aggregate).toBeGreaterThan(references)
    expect(wineGates).not.toContain('-b tsconfig.host.json')
  })

  it('cancels superseded master runs without changing the post-merge job inventory', () => {
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    if (!isRecord(workflow.jobs) || !isRecord(workflow.concurrency)) {
      throw new TypeError('ci-master workflow must define jobs and a workflow-level concurrency block')
    }

    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    })

    // The exact event set is what keeps master-only jobs out of the PR check
    // panel: ci-master triggers only on push(master) + workflow_dispatch and
    // never on pull_request. Assert the full set so losing the wrong event, or
    // gaining an extra one, fails.
    if (!isRecord(workflow.on)) {
      throw new TypeError('ci-master workflow must define on')
    }
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])

    // Drills share the parent run’s supersession policy.
    for (const name of ['serial-linux-selfhosted', 'serial-windows']) {
      const job = workflow.jobs[name]
      if (!isRecord(job)) throw new TypeError(`${name} must be defined`)
      expect(job.concurrency).toBeUndefined()
      // Standby drills remain post-merge work, but share run cancellation.
      expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    }

    // Pin the post-merge runtime, Wine, and standby inventory.
    const NOT_PUSH_REACHABLE = new Set([
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'larger-runner-benchmark'",
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'consolidated-runner-benchmark'",
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'ssh-helper'",
    ])
    const pushReachable = Object.entries(workflow.jobs)
      .filter(([, job]) => {
        if (!isRecord(job)) return false
        if (job.if === undefined) return true // unconditional: runs on every event
        if (job.if === false) return false // `if: false` parses as a boolean
        if (typeof job.if !== 'string') return true // unrecognized shape: surface it
        return !NOT_PUSH_REACHABLE.has(job.if.trim())
      })
      .map(([name]) => name)
      .sort()
    expect(pushReachable).toEqual(['python-runtime', 'serial-linux-selfhosted', 'serial-windows', 'windows'])

    // Manual benchmarks retain their bounded fan-out.
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark']) {
      const job = workflow.jobs[name]
      if (!isRecord(job) || !isRecord(job.strategy)) {
        throw new TypeError(`${name} must define a matrix strategy`)
      }
      expect(job.strategy['max-parallel']).toBe(12)
      expect(job['timeout-minutes']).toBe(15)
    }
  })

  it('redirects the Node compile cache to the data-volume runner temp before the first pnpm call', () => {
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    const job = workflowJob(workflow, 'serial-linux-selfhosted')
    if (!Array.isArray(job.steps)) throw new TypeError('serial-linux-selfhosted must define steps')
    const redirectStepIndex = job.steps.findIndex((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
        && step.run.includes('NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache')
        && step.run.includes('"$GITHUB_ENV"')
    ))
    // Removing this injection would send every pnpm call in the lane (setup,
    // store-path probe, install, and the gate) back to the root partition's
    // /tmp.
    expect(redirectStepIndex, 'serial-linux-selfhosted must inject NODE_COMPILE_CACHE into GITHUB_ENV').toBeGreaterThan(-1)
    const pnpmSetupIndex = job.steps.findIndex((step): step is Record<string, unknown> & { uses: string } => (
      isRecord(step) && typeof step.uses === 'string' && step.uses.includes('pnpm/action-setup')
    ))
    expect(pnpmSetupIndex, 'serial-linux-selfhosted must run pnpm/action-setup').toBeGreaterThan(-1)
    expect(redirectStepIndex, 'serial-linux-selfhosted must redirect before pnpm/action-setup runs pnpm').toBeLessThan(pnpmSetupIndex)
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('builds SSH executables only for explicit manual or release requests', () => {
    const master = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), 'ssh-helper')
    if (typeof master.if !== 'string') throw new Error('SSH manual caller must define its trigger condition')
    for (const [event, suite, expected] of [
      ['push', 'ssh-helper', false], ['pull_request', 'ssh-helper', false],
      ['workflow_dispatch', 'larger-runner-benchmark', false], ['workflow_dispatch', 'ssh-helper', true],
    ] as const) {
      expect(runInNewContext(master.if, { github: { event_name: event, ref: 'refs/heads/master' }, inputs: { suite } }, { timeout: 1000 })).toBe(expected)
    }
    expect(master.with).toEqual({ targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64,node24-macos-x64' })
    const workflow = loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml')
    if (!isRecord(workflow.on)) throw new Error('SSH builder must define triggers')
    expect(Object.keys(workflow.on).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
  })

  it('requires SSH helper acceptance before uploading artifacts or publishing', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml')
    const build = workflowJob(workflow, 'build')
    if (!Array.isArray(build.steps)) throw new Error('SSH build must define its verification steps')
    const steps = build.steps.filter(isRecord)
    const artifact = steps.findIndex(step => String(step.run).includes('scripts/verify-ssh-helper-artifact.ts'))
    const transport = steps.findIndex(step => String(step.run).includes('scripts/verify-ssh-helper-ssh.ts'))
    const landlock = steps.findIndex(step => String(step.run).includes('--backend=landlock-run'))
    const upload = steps.findIndex(step => String(step.uses).startsWith('actions/upload-artifact@'))
    expect(artifact).toBeGreaterThan(-1)
    expect(landlock).toBeGreaterThan(artifact)
    expect(transport).toBeGreaterThan(artifact)
    expect(upload).toBeGreaterThan(transport)
    for (const index of [artifact, transport, landlock, upload]) expect(steps[index]).not.toHaveProperty('continue-on-error', true)
    const publish = loadWorkflow('.github/workflows/publish-ssh-helper.yml')
    expect(publish.permissions).toEqual({ contents: 'read' })
    expect(workflowJob(publish, 'build')).toMatchObject({ needs: 'validate', with: { release: true } })
    const verify = workflowJob(publish, 'verify')
    expect(verify.needs).toEqual(['validate', 'build'])
    expect(verify).not.toHaveProperty('if')
    expect(verify).not.toHaveProperty('permissions')
    if (!Array.isArray(verify.steps)) throw new Error('Release verification must define steps')
    const verification = verify.steps.findIndex(step => isRecord(step) && String(step.run).includes('scripts/ssh-helper/release.ts'))
    const checksums = verify.steps.findIndex(step => isRecord(step) && String(step.uses).startsWith('actions/upload-artifact@'))
    expect(verification).toBeGreaterThan(-1)
    expect(checksums).toBeGreaterThan(verification)
    expect(verify.steps[verification]).not.toHaveProperty('continue-on-error', true)
    const publication = workflowJob(publish, 'publish')
    expect(publication).toMatchObject({ if: 'inputs.publish', needs: ['validate', 'verify'], permissions: { contents: 'write' } })
    for (const requested of [false, true]) {
      expect(runInNewContext(String(publication.if), { inputs: { publish: requested } }, { timeout: 1000 })).toBe(requested)
    }
  })

  it('validates any ref by default but refuses publication without the matching SSH release tag', () => {
    const workflow = loadWorkflow('.github/workflows/publish-ssh-helper.yml')
    if (!isRecord(workflow.on)) throw new Error('SSH release must define triggers')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflowEvent(workflow, 'workflow_dispatch').inputs).toMatchObject({ publish: { type: 'boolean', default: false } })
    const validate = workflowJob(workflow, 'validate')
    expect(validate.steps).toContainEqual(expect.objectContaining({ id: 'source', env: { PUBLISH: '${{ inputs.publish }}' } }))
    const source = nodeStepSource(validate, 'source')
    const evaluate = (publish: boolean, type: string, name: string): string => {
      let output = ''
      runInNewContext(source, {
        process: { env: { PUBLISH: String(publish), GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name, GITHUB_OUTPUT: 'output' } },
        readFileSync: () => JSON.stringify({ version: '1.2.3' }),
        execFileSync: () => `${'a'.repeat(40)}\n`,
        appendFileSync: (_path: string, text: string) => { output += text },
      }, { timeout: 1000 })
      return output
    }
    const expected = `version=1.2.3\ncommit=${'a'.repeat(40)}\n`
    expect(evaluate(false, 'branch', 'worktree/helper')).toBe(expected)
    expect(evaluate(false, 'tag', 'arbitrary-tag')).toBe(expected)
    expect(evaluate(true, 'tag', 'dsh-v1.2.3')).toBe(expected)
    for (const [type, name] of [['branch', 'dsh-v1.2.3'], ['tag', 'dsh-v1.2.2'], ['tag', 'python-v1.2.3']] as const) {
      expect(() => evaluate(true, type, name)).toThrow('Publication requires the matching dsh-v<version> tag')
    }
  })

  it('validates the SSH native matrix before allocating runners', () => {
    const plan = workflowJob(loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml'), 'plan')
    const source = nodeStepSource(plan, 'targets')
    const evaluate = (requested: string): unknown => {
      let output = ''
      runInNewContext(source, {
        process: { env: { REQUESTED_TARGETS: requested, GITHUB_OUTPUT: 'output' } },
        appendFileSync: (_path: string, text: string) => { output += text },
      }, { timeout: 1000 })
      return JSON.parse(output.slice('matrix='.length))
    }
    expect(evaluate('')).toHaveLength(4)
    expect(evaluate('node24-linux-arm64')).toEqual([{ target: 'node24-linux-arm64', runner: 'ubuntu-24.04-arm' }])
    for (const invalid of ['node24-linux-arm64,node24-linux-arm64', 'node24-win-x64', 'node24-linux-x64,', ' ']) {
      expect(() => evaluate(invalid)).toThrow('Invalid or duplicate')
    }
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })

  it('applies the lane test budget inside every Vitest project', () => {
    // Each inline project spreads coverageTestTimeoutOptions, the only route
    // for DSH_COVERAGE_TEST_TIMEOUT_MS into projects; the behavior itself is
    // pinned by scripts/lane-test-budget.spec.ts.
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).toContain('const laneTestBudget = coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV])')
    expect(config.match(/^ {10}\.\.\.laneTestBudget,$/gm)).toHaveLength(2)
  })
})

describe('Runtime Blacksmith routing', () => {
  it('keeps native release and dispatch builders hosted while routing x64 CI by platform', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    const build = workflowJob(workflow, 'build')
    for (const [target, runner, variable, blacksmith, releaseRunner] of [
      ['node24-linux-x64', 'ubuntu-latest', 'DSH_CI_FAILOVER_LINUX', 'blacksmith-2vcpu-ubuntu-2404', 'ubuntu-latest'],
      ['node24-win-x64', 'windows-2025', 'DSH_CI_FAILOVER_WINDOWS', 'blacksmith-2vcpu-windows-2025', 'windows-2025'],
      ['node24-linux-arm64', 'ubuntu-24.04-arm', 'DSH_CI_FAILOVER_LINUX', 'ubuntu-24.04-arm', 'ubuntu-24.04-arm'],
      ['node24-macos-arm64', 'macos-latest', 'DSH_CI_FAILOVER_LINUX', 'macos-latest', 'macos-15-xlarge'],
      ['node24-macos-x64', 'macos-15-intel', 'DSH_CI_FAILOVER_LINUX', 'macos-15-intel', 'macos-15-large'],
    ] as const) {
      for (const ci of [false, true]) {
        for (const release of [false, true]) {
          for (const mode of ['', 'selfhosted', 'unexpected', 'blacksmith']) {
            const vars = { DSH_CI_FAILOVER_LINUX: 'blacksmith', DSH_CI_FAILOVER_WINDOWS: 'blacksmith', [variable]: mode }
            expect(evaluateRunsOn(build['runs-on'], { inputs: { ci, release }, vars, matrix: { target, runner } }), `${target} ci=${ci} release=${release} mode=${mode}`)
              .toBe(release ? releaseRunner : ci && mode === 'blacksmith' ? blacksmith : runner)
          }
        }
      }
    }
  })

  it.each(['plan', 'sdk-wheel'])('routes runtime %s only for non-release CI', (name) => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), name)
    for (const ci of [false, true]) {
      for (const release of [false, true]) {
        for (const mode of ['', 'selfhosted', 'unexpected', 'blacksmith']) {
          expect(evaluateRunsOn(job['runs-on'], { inputs: { ci, release }, vars: { DSH_CI_FAILOVER_LINUX: mode } }))
            .toBe(ci && !release && mode === 'blacksmith' ? 'blacksmith-4vcpu-ubuntu-2404' : 'ubuntu-latest')
        }
      }
    }
  })
})

describe('bubblewrap preparation script', () => {
  it('pins bubblewrap to a recorded Launchpad build and excludes Ubuntu pool downloads', () => {
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')
    const url = /^readonly BUBBLEWRAP_URL="([^"]+)"$/mu.exec(script)?.[1]

    expect(url).toMatch(
      /^https:\/\/launchpad\.net\/ubuntu\/\+source\/bubblewrap\/[^/]+\/\+build\/\d+\/\+files\/bubblewrap_[^/]+_amd64\.deb$/u,
    )
    // Ubuntu removes superseded versions from its live package pool.
    expect(script).not.toMatch(/https?:\/\/[^/'"\s]+\/ubuntu(?:-ports)?\/pool\//u)
  })
})

describe('Python release workflows', () => {
  it('keeps complete wheel validation separate from protected public publication', () => {
    const workflow = loadWorkflow('.github/workflows/python-release.yml')
    const dispatch = workflowEvent(workflow, 'workflow_dispatch')
    const build = workflowJob(workflow, 'build')
    const pythonCompat = workflowJob(workflow, 'python-compat')
    const validate = workflowJob(workflow, 'validate')
    const publishRuntime = workflowJob(workflow, 'publish-runtime')
    const publishSdk = workflowJob(workflow, 'publish-sdk')
    if (!isRecord(dispatch.inputs)
      || !isRecord(dispatch.inputs.publish)
      || !Array.isArray(pythonCompat.steps)
      || !Array.isArray(validate.steps)
      || !Array.isArray(publishRuntime.steps)
      || !Array.isArray(publishSdk.steps)) {
      throw new TypeError('Python release workflow must define publish input and release steps')
    }

    expect(dispatch.inputs.publish).toMatchObject({ type: 'boolean', default: false })
    if (!isRecord(workflow.on)) throw new TypeError('python-release workflow must define on')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(build).toMatchObject({
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64,node24-macos-x64,node24-win-x64',
        release: true,
      },
    })
    expect(pythonCompat.strategy).toMatchObject({ matrix: { python: ['3.10', '3.14'] } })
    const pythonCompatSteps = JSON.stringify(pythonCompat.steps)
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_sdk-$VERSION-py3-none-any.whl')
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_runtime_bin-$VERSION-py3-none-manylinux_2_28_x86_64.whl')
    expect(pythonCompatSteps).not.toContain('--find-links')
    const validateSteps = JSON.stringify(validate.steps)
    const authorize = validate.steps.filter(isRecord).find(step => step.name === 'Authorize publication request')
    if (!isRecord(authorize) || typeof authorize.run !== 'string') {
      throw new TypeError('Python release validation must authorize publication requests')
    }
    expect(validateSteps).toContain('PUBLIC_PYPI_RELEASE_ENABLED')
    expect(authorize).toMatchObject({
      env: {
        PYPI_PUBLISHER_REPOSITORY: '${{ vars.PYPI_PUBLISHER_REPOSITORY }}',
        REPOSITORY: '${{ github.repository }}',
      },
    })
    expect(authorize.run).toContain('[ "$REPOSITORY" = "$PYPI_PUBLISHER_REPOSITORY" ]')
    expect(validateSteps).toContain('100000000')
    expect(publishRuntime).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: 'validate',
      environment: 'pypi-runtime',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    expect(publishSdk).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: ['validate', 'publish-runtime'],
      environment: 'pypi',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    const runtimeSteps = publishRuntime.steps.filter(isRecord)
    const sdkSteps = publishSdk.steps.filter(isRecord)
    const runtimePublish = runtimeSteps.find(step => step.name === 'Publish runtime wheels')
    const sdkPublish = sdkSteps.find(step => step.name === 'Publish SDK wheel')
    const runtimeHashes = runtimeSteps.find(step => step.name === 'Verify release artifact hashes')
    const sdkHashes = sdkSteps.find(step => step.name === 'Verify release artifact hashes')
    expect([...runtimeSteps, ...sdkSteps].some(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )).toBe(false)
    expect([...runtimeSteps, ...sdkSteps].filter(
      step => step.uses === 'pypa/gh-action-pypi-publish@release/v1',
    )).toHaveLength(2)
    expect(runtimePublish).toMatchObject({
      with: { 'packages-dir': 'dist/runtime/', attestations: false },
    })
    expect(sdkPublish).toMatchObject({
      with: { 'packages-dir': 'dist/sdk/', attestations: false },
    })
    expect(runtimeHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
    expect(sdkHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
  })

  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(Object.keys(workflow.on as Record<string, unknown>).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
    const call = workflowEvent(workflow, 'workflow_call')
    const plan = workflowJob(workflow, 'plan')
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !isRecord(call.secrets) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    const buildSteps: unknown[] = build.steps
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS payload architecture and deployment target')
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    const cleanVenvPosix = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (POSIX)')
    const cleanVenvWindows = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (Windows)')
    const installedKeylessPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (POSIX)')
    const installedKeylessWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (Windows)')
    const realApiPreflightPosix = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (POSIX)')
    const realApiPreflightWindows = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (Windows)')
    const installedRealApiPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (POSIX)')
    const installedRealApiWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (Windows)')
    if (!isRecord(macosCheck) || typeof macosCheck.run !== 'string'
      || !isRecord(cleanVenvPosix) || !isRecord(cleanVenvWindows)
      || !isRecord(installedKeylessPosix) || !isRecord(installedKeylessWindows)
      || !isRecord(realApiPreflightPosix) || !isRecord(realApiPreflightWindows)
      || !isRecord(installedRealApiPosix) || !isRecord(installedRealApiWindows)) {
      throw new TypeError('Python wheel builder must define native POSIX and Windows installed-wheel steps')
    }
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(call.secrets).toMatchObject({
      DEEPSEEK_API_KEY_EXTERNAL: { required: false },
    })
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(build.defaults).toBeUndefined()
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    const workflowJson = JSON.stringify(workflow)
    expect(workflowJson).toContain('macosx_14_0_arm64')
    expect(workflowJson).toContain('macosx_14_0_x86_64')
    expect(workflowJson).toContain('node24-macos-x64')
    expect(workflowJson).toContain('macos-15-intel')
    expect(workflowJson).toContain('win_amd64')
    expect(workflowJson).toContain('node24-win-x64')
    expect(workflowJson).toContain('windows-2025')
    expect(workflowJson).toContain('dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).not.toContain('--find-links dist-python')
    expect(workflowJson).not.toContain('--find-links /work/dist-python')
    expect(workflowJson).not.toContain('cygpath')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm --config.verifyDepsBeforeRun=false run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('pnpm_setup_root')
    expect(JSON.stringify(manylinuxAddon)).toContain('$pnpm_setup_root:$pnpm_setup_root:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(macosCheck.run).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck.run).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck.run).toContain('$EXE-rg')
    expect(macosCheck.run).toContain('$EXE-spawn-helper')
    expect(JSON.stringify(installedKeylessPosix)).toContain('--scenario all')
    expect(JSON.stringify(installedKeylessPosix)).toContain('env -u PYTHONPATH')
    expect(JSON.stringify(installedKeylessWindows)).toContain('--scenario all --installed-wheel')
    expect(installedKeylessWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(cleanVenvWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(JSON.stringify(cleanVenvWindows)).toContain('Scripts\\\\python.exe')
    expect(realApiPreflightPosix).toMatchObject({
      env: { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}' },
    })
    expect(String(realApiPreflightPosix.if)).toContain('inputs.ci')
    expect(String(realApiPreflightPosix.if)).toContain('head.repo.fork')
    expect(String(realApiPreflightPosix.if)).toContain('dependabot[bot]')
    expect(realApiPreflightWindows).toMatchObject({ shell: 'pwsh' })
    for (const step of [installedRealApiPosix, installedRealApiWindows]) {
      expect(step).toMatchObject({
        env: {
          DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
          DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
        },
      })
    }
    expect(JSON.stringify(installedRealApiPosix)).toContain('--scenario sdk-live')
    expect(JSON.stringify(installedRealApiPosix)).toContain('-u DSH_RUNTIME_MODE')
    expect(installedRealApiWindows).toMatchObject({ shell: 'pwsh' })
    expect(JSON.stringify(installedRealApiWindows)).toContain('--scenario sdk-live --installed-wheel')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxSmoke)).toContain('-e DSH_TELEMETRY_DISABLED')
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('${PLATFORM#macos-}'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck).toContain('"$EXE" "$EXE-rg" "$EXE-spawn-helper"')
  })

  it('builds the macOS x64 wheel on the matching GitLab runner', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const macosX64 = workflow['runtime-macos-x64']
    const publish = workflow['publish-python']
    if (!isRecord(macosX64) || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the macOS x64 runtime and publication jobs')
    }

    expect(macosX64.tags).toEqual(['macos-x64'])
    expect(macosX64.variables).toMatchObject({ PKG_TARGET: 'node24-macos-x64', PLATFORM: 'macos-x64' })
    expect(publish.needs).toContainEqual({ job: 'runtime-macos-x64', artifacts: true })
    expect(JSON.stringify(publish.script)).toContain('macosx_14_0_x86_64.whl')
  })

  it('builds and black-box tests the Windows x64 wheel in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const windows = workflow['runtime-windows-x64']
    const publish = workflow['publish-python']
    if (!isRecord(windows) || !Array.isArray(windows.before_script) || !Array.isArray(windows.script)
      || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the Windows runtime and aggregate publication jobs')
    }

    expect(windows.tags).toEqual(['windows-x64'])
    expect(windows.variables).toMatchObject({ PKG_TARGET: 'node24-win-x64', PLATFORM: 'win-x64' })
    expect(JSON.stringify(windows.before_script)).toContain('.ci-python\\\\Scripts')
    expect(JSON.stringify(windows.before_script)).toContain('[IO.Path]::PathSeparator')
    expect(JSON.stringify(windows.script)).toContain('win_amd64.whl')
    expect(JSON.stringify(windows.script)).toContain('--scenario all --installed-wheel')
    expect(publish.needs).toContainEqual({ job: 'runtime-windows-x64', artifacts: true })
  })
})

describe('Weighted approval workflow', () => {
  it('publishes from the trusted default branch after pull request and review updates', () => {
    const publisher = loadWorkflow('.github/workflows/weighted-approval.yml')
    const reviewEvent = loadWorkflow('.github/workflows/weighted-approval-review-event.yml')
    const pullRequest = workflowEvent(publisher, 'pull_request_target')
    const workflowRun = workflowEvent(publisher, 'workflow_run')
    const review = workflowEvent(reviewEvent, 'pull_request_review')
    const job = workflowJob(publisher, 'publish-status')
    const recordJob = workflowJob(reviewEvent, 'record-review-event')
    if (!isRecord(publisher.on)) throw new TypeError('weighted-approval workflow must define events')
    if (!isRecord(reviewEvent.on)) throw new TypeError('weighted-approval review event workflow must define events')
    if (!Array.isArray(job.steps)) throw new TypeError('weighted-approval job must define steps')
    if (!Array.isArray(recordJob.steps)) throw new TypeError('weighted-approval review event job must define steps')
    const steps = job.steps.filter(isRecord)
    const checkout = steps.find(step => step.name === 'Check out trusted approval policy')
    const publish = steps.find(step => step.name === 'Publish weighted approval status')
    const recordSteps = recordJob.steps.filter(isRecord)
    const record = recordSteps.find(step => step.name === 'Record review event')

    expect(publisher.name).toBe('weighted-approval')
    expect(Object.keys(publisher.on)).toEqual(['pull_request_target', 'issue_comment', 'workflow_run'])
    expect(workflowEvent(publisher, 'issue_comment').types).toEqual(['created', 'edited', 'deleted'])
    expect(pullRequest.types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited'])
    expect(workflowRun).toEqual({ workflows: ['weighted-approval-review-event'], types: ['completed'] })
    expect(reviewEvent.name).toBe('weighted-approval-review-event')
    expect(reviewEvent['run-name']).toBe('weighted-approval-review-event:${{ github.event.pull_request.number }}')
    expect(Object.keys(reviewEvent.on)).toEqual(['pull_request_review'])
    expect(review.types).toEqual(['submitted', 'edited', 'dismissed'])
    expect(reviewEvent.permissions).toEqual({})
    expect(publisher.permissions).toEqual({
      checks: 'write',
      contents: 'read',
      'pull-requests': 'write',
      statuses: 'write',
    })
    expect(publisher.concurrency).toEqual({
      group: "weighted-approval-${{ (github.event.pull_request.number || github.event.issue.number) && format('weighted-approval-review-event:{0}', github.event.pull_request.number || github.event.issue.number) || github.event.workflow_run.display_title }}",
      'cancel-in-progress': false,
    })
    expect(job).toMatchObject({
      if: "(github.event_name != 'pull_request_target' || github.event.pull_request.state == 'open') && "
        + "(github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success') && "
        + "(github.event_name != 'issue_comment' || (github.event.issue.pull_request && github.event.issue.state == 'open' &&\n"
        + "  (contains(github.event.comment.body, '/delegate') || contains(github.event.changes.body.from, '/delegate'))))",
      name: 'weighted approval publisher',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
    })
    expect(checkout).toMatchObject({
      uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      with: {
        ref: '${{ github.event.repository.default_branch }}',
        'persist-credentials': false,
      },
    })
    const token = steps.find(step => step.id === 'decision-token')
    expect(token).toMatchObject({
      'continue-on-error': true,
      uses: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
      with: {
        'client-id': '${{ vars.DSH_APPROVAL_APP_CLIENT_ID }}',
        'private-key': '${{ secrets.DSH_APPROVAL_APP_PRIVATE_KEY }}',
        owner: 'deepseek-harness',
        repositories: 'deepseek-harness',
        'permission-checks': 'write',
      },
    })
    const tokenIndex = steps.indexOf(token!)
    expect(tokenIndex).toBeGreaterThan(steps.indexOf(checkout!))
    expect(tokenIndex).toBeLessThan(steps.findIndex(step => step.id === 'revoke'))
    for (const step of steps.filter(step => typeof step.run === 'string' && step.run.startsWith('node .github/review-ownership/check-approval.mjs'))) {
      expect(step.env).toMatchObject({
        DECISION_TOKEN: '${{ steps.decision-token.outputs.token }}',
        DECISION_APP_SLUG: '${{ vars.DSH_APPROVAL_APP_SLUG }}',
      })
    }
    const setupIndex = steps.findIndex(step => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-python@'))
    expect(steps[setupIndex]?.if).toBe("steps.revoke.outputs.active == 'true'")
    expect(steps[setupIndex]?.uses).toBe('actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1')
    const revokeIndex = steps.findIndex(step => step.id === 'revoke')
    expect(revokeIndex).toBeGreaterThan(steps.indexOf(checkout!))
    expect(revokeIndex).toBeLessThan(setupIndex)
    expect(steps[revokeIndex]?.run).toBe('node .github/review-ownership/check-approval.mjs pending')
    expect(steps.at(-1)).toMatchObject({
      if: "failure() && steps.revoke.outputs.active == 'true'",
      run: 'node .github/review-ownership/check-approval.mjs error',
    })
    expect(steps.find(step => step.name === 'Install production lexer')).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      run: 'python3 -m pip install -r .github/review-ownership/requirements.txt',
    })
    expect(publish).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      env: {
        GITHUB_TOKEN: '${{ github.token }}',
        GITHUB_RUN_URL: '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      },
      run: 'node .github/review-ownership/check-approval.mjs',
    })
    expect(recordJob).toMatchObject({
      if: "github.event.pull_request.state == 'open'",
      name: 'record weighted approval review event',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 2,
    })
    expect(record).toBeDefined()
    expect(record?.run).toBe("echo 'Recorded a weighted approval review event.'")
    expect(recordSteps).toHaveLength(1)
    expect(JSON.stringify(publisher)).not.toContain('github.event.pull_request.head')
    expect(JSON.stringify(publisher).match(/secrets\.[A-Za-z0-9_]+/gu)).toEqual(['secrets.DSH_APPROVAL_APP_PRIVATE_KEY'])
    expect(JSON.stringify(reviewEvent)).not.toContain('github.token')
    expect(JSON.stringify(reviewEvent)).not.toContain('secrets.')
  })
})

describe('npm release workflows', () => {
  it('passes the optional vendor channel as a quoted argument while preserving default publication', () => {
    const workflow = loadWorkflow('.github/workflows/release-vendor-publish.yml')
    expect(workflow.on).toMatchObject({
      workflow_dispatch: {
        inputs: {
          'dist-tag': {
            required: false,
            type: 'string',
            default: '',
          },
        },
      },
    })
    const publish = workflowJob(workflow, 'publish')
    expect(publish.steps).toContainEqual({
      name: 'Publish tarballs',
      env: {
        NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}',
        RELEASE_DIST_TAG: '${{ inputs.dist-tag }}',
      },
      run: [
        'args=()',
        'if [[ -n "$RELEASE_DIST_TAG" ]]; then',
        '  args+=(--dist-tag "$RELEASE_DIST_TAG")',
        'fi',
        'pnpm run release:publish --family vendor --from dist/npm-vendor "${args[@]}"',
        '',
      ].join('\n'),
    })
  })

  it('keeps publication dispatch-only and pack in the PR workflow', () => {
    // pack stays in the PR/master release workflow so a PR proves the set packs.
    const vendor = loadWorkflow('.github/workflows/release-vendor.yml')
    if (!isRecord(vendor.jobs)) throw new TypeError('release-vendor.yml must define jobs')
    expect(Object.keys(vendor.jobs).sort()).toEqual(['pack'])

    // publication is workflow_dispatch-only (never a PR check) and keeps the
    // npm-publish environment plus the shared dist-tag group.
    for (const file of ['release-publish.yml', 'release-vendor-publish.yml']) {
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.on) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define on and jobs`)
      expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
      const publish = workflow.jobs.publish
      if (!isRecord(publish)) throw new TypeError(`${file} must define a publish job`)
      expect(publish.environment).toBe('npm-publish')
      expect(publish.concurrency).toMatchObject({ group: 'Release-publish' })
    }
  })

})

describe('Documentation site publication', () => {
  it('keeps Pages deployment dispatch-only from a dsh-v* tag', () => {
    const workflow = loadWorkflow('.github/workflows/docs-pages.yml')
    const build = workflowJob(workflow, 'build')
    const deploy = workflowJob(workflow, 'deploy')
    if (!isRecord(workflow.on) || !isRecord(workflow.env) || !Array.isArray(build.steps)) {
      throw new TypeError('Documentation deployment must define on, env, and build steps')
    }

    // The site presents a released snapshot: a merge must never publish it, and
    // publication must never appear as a PR check.
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])

    // RELEASE_PUBLISH makes release:verify reject every ref that is not a dsh-v*
    // tag naming this tree's version, so the site and the npm sequence share one
    // definition of a released version.
    const steps = build.steps.filter(isRecord)
    const verify = steps.find(step => step.name === 'Verify release version')
    const checkout = steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(verify).toMatchObject({
      env: { RELEASE_PUBLISH: 'true' },
      run: 'pnpm run release:verify --family dsh',
    })
    // Complete history: the release scripts read tags.
    expect(checkout).toMatchObject({ with: { 'fetch-depth': 0 } })

    // Projected source links stay on the public repository's master. That
    // repository advances only to each release commit, so its master never
    // carries unreleased work, while it retains only the most recent tags:
    // following the dispatched tag would leave every source link on a deploy
    // from an older tag unresolvable.
    expect(workflow.env.DOCS_REPOSITORY_REF).toBe('master')

    // The environment owns the deployment tag policy and the required reviewers.
    expect(deploy.environment).toMatchObject({ name: 'github-pages' })
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function nodeStepSource(job: Record<string, unknown>, id: string): string {
  if (!Array.isArray(job.steps)) throw new Error('Node workflow job must define steps')
  const step: unknown = job.steps.find(value => isRecord(value) && value.id === id)
  if (!isRecord(step) || typeof step.run !== 'string') throw new Error(`Missing Node workflow step: ${id}`)
  const source = step.run.split("<<'JS'\n")[1]?.split('\nJS')[0]?.replace(/^import .*;\n/gm, '')
  if (source === undefined) throw new Error(`Workflow step ${id} must contain an executable Node script`)
  return source
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Policy workflow shells', () => {
  it.each(['pr-check-on-head-branch.yml', 'pr-check-after-approve.yml', 'pr-check-on-base-branch.yml'])(
    '%s runs shell blocks that parse',
    (file) => {
      if (process.platform === 'win32') return
      const workflow = loadWorkflow('.github/workflows/' + file)
      if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const job of Object.values(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.run !== 'string') continue
          const parsed = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' })
          expect(`${String(step.name ?? step.id)}: ${parsed.status}: ${parsed.stderr}`).toBe(`${String(step.name ?? step.id)}: 0: `)
        }
      }
    },
  )
})

describe('Policy workflows', () => {
  const workflows = [
    ['pr-check-on-head-branch.yml', ['master']],
    ['pr-check-after-approve.yml', ['approve', 'review']],
  ] as const

  function stepsOf(job: Record<string, unknown>): Record<string, unknown>[] {
    const steps = job.steps as unknown[]
    if (!Array.isArray(steps)) throw new TypeError('job must define steps')
    return steps.filter(isRecord)
  }

  it.each(workflows)('%s runs each check from master and reads its mode from a repository variable', (file, jobs) => {
    const workflow = loadWorkflow('.github/workflows/' + file)
    expect(Object.keys(workflow).filter(key => key !== 'name')).toEqual(['on', 'permissions', 'concurrency', 'jobs'])
    const events = workflow.on
    if (!isRecord(events)) throw new TypeError(`${file} must declare events`)
    expect(events).not.toHaveProperty('pull_request')
    expect(events).toHaveProperty('pull_request_target')
    for (const job of jobs) {
      const check = stepsOf(workflowJob(workflow, job)).find(step => typeof step.uses === 'string' && step.uses.startsWith('deepseek-harness/deepseek-harness-check@'))
      if (check === undefined || !isRecord(check.env)) throw new TypeError(`${file} ${job} must run the check action with env`)
      expect(String(check.env.CHECK_MODE)).toContain('vars.MERGE_POLICY_')
    }
  })

  it('keeps the pre-merge build behind the merge step, which honours the mode on its failures', () => {
    const steps = stepsOf(workflowJob(loadWorkflow('.github/workflows/pr-check-on-head-branch.yml'), 'pre-merge'))
    const merge = steps.findIndex(step => step.id === 'merge')
    const build = steps.findIndex(step => step.name === "Run the tree's pre-merge check")
    expect(merge).toBeGreaterThanOrEqual(0)
    expect(build).toBeGreaterThan(merge)
    const merging = steps[merge]
    if (merging === undefined || !isRecord(merging.env)) throw new TypeError('the merge step must set env')
    expect(String(merging.env.CHECK_MODE)).toContain('MERGE_POLICY_PRE_MERGE')
    for (const step of steps.slice(merge)) {
      if (typeof step.run !== 'string') continue
      expect(step.run).toContain('"$CHECK_MODE" = block')
    }
    for (const step of steps.slice(merge + 1)) expect(step.if).toBe("steps.merge.outputs.merged == 'true'")
    const run = steps[build]?.run
    if (typeof run !== 'string') throw new TypeError('the pre-merge check step must run a command')
    expect(run).toContain('node scripts/pre-merge-check.ts')
    // The script annotates its own failures; the step keeps a mode-aware guard for a check that crashes.
    expect(run).toContain('exited without reporting')
    expect(run).toContain('"$CHECK_MODE" = block')
  })
})
