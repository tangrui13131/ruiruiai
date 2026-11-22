import { describe, expect, it } from 'vitest'
import { localeDictionaries } from '../src/locale/types.ts'
import { verificationCheckLabel, verificationCheckSummary } from '../src/verification/check-labels.ts'

const dictionary = localeDictionaries['zh-CN']
const english = localeDictionaries['en']

describe('verification check labels', () => {
  it('renders localized labels for known pipeline check names', () => {
    expect(verificationCheckLabel(dictionary, 'project-structure')).toBe('项目结构')
    expect(verificationCheckLabel(dictionary, 'dependency-install')).toBe('依赖安装')
    expect(verificationCheckLabel(dictionary, 'typescript')).toBe('TypeScript 检查')
    expect(verificationCheckLabel(dictionary, 'vite-build')).toBe('Vite 构建')
    expect(verificationCheckLabel(dictionary, 'bundle-coverage')).toBe('产物覆盖')
    expect(verificationCheckLabel(dictionary, 'browser-launch')).toBe('浏览器启动')
    expect(verificationCheckLabel(dictionary, 'browser-environment')).toBe('浏览器环境')
  })

  it('localizes viewport names inside dynamic browser check labels', () => {
    expect(verificationCheckLabel(dictionary, 'browser:desktop:/')).toBe('浏览器验证 · 桌面 · /')
    expect(verificationCheckLabel(dictionary, 'browser:mobile:/dashboard')).toBe('浏览器验证 · 移动端 · /dashboard')
    expect(verificationCheckLabel(english, 'browser:desktop:/dashboard')).toBe('Browser check · Desktop · /dashboard')
  })

  it('falls back to the raw name for unknown checks and viewports', () => {
    expect(verificationCheckLabel(dictionary, 'future-check')).toBe('future-check')
    expect(verificationCheckLabel(dictionary, 'browser:watch:/')).toBe('浏览器验证 · watch · /')
  })
})

describe('verification check summaries', () => {
  it('renders localized summaries per check status', () => {
    expect(verificationCheckSummary(dictionary, 'project-structure', 'PASS', 'Required React/Vite structure is present.'))
      .toBe('必需的 React/Vite 结构已就绪。')
    expect(verificationCheckSummary(dictionary, 'project-structure', 'FAIL', 'Required React/Vite structure is incomplete.'))
      .toBe('必需的 React/Vite 结构不完整。')
    expect(verificationCheckSummary(dictionary, 'dependency-install', 'FAIL', 'Dependency installation failed.'))
      .toBe('依赖安装失败。')
    expect(verificationCheckSummary(dictionary, 'typescript', 'PASS', 'TypeScript completed without errors.'))
      .toBe('TypeScript 检查通过，无错误。')
    expect(verificationCheckSummary(dictionary, 'vite-build', 'PASS', 'Vite production build completed.'))
      .toBe('Vite 生产构建完成。')
    expect(verificationCheckSummary(dictionary, 'bundle-coverage', 'FAIL', 'Some generated sources never reached the production bundle.'))
      .toBe('部分生成源码未进入生产构建产物。')
    expect(verificationCheckSummary(dictionary, 'browser', 'SKIPPED', 'Browser checks require a passing build.'))
      .toBe('浏览器检查已跳过。')
    expect(verificationCheckSummary(dictionary, 'browser-launch', 'SKIPPED', 'Chromium is unavailable.'))
      .toBe('Chromium 不可用，浏览器检查已跳过。')
    expect(verificationCheckSummary(dictionary, 'browser-environment', 'SKIPPED', 'Browser verification could not complete in this environment.'))
      .toBe('当前环境无法完成浏览器验证。')
  })

  it('interpolates the route into dynamic browser summaries', () => {
    expect(verificationCheckSummary(dictionary, 'browser:desktop:/', 'PASS', 'ignored'))
      .toBe('路由 / 渲染正常，所需交互全部完成。')
    expect(verificationCheckSummary(dictionary, 'browser:mobile:/dashboard', 'FAIL', 'ignored'))
      .toBe('路由 /dashboard 未通过浏览器断言。')
  })

  it('falls back to the original summary for unknown statuses and checks', () => {
    const original = 'Unhandled verifier output.'
    expect(verificationCheckSummary(dictionary, 'browser:desktop:/', 'WARNING', original)).toBe(original)
    expect(verificationCheckSummary(dictionary, 'future-check', 'PASS', original)).toBe(original)
  })
})
