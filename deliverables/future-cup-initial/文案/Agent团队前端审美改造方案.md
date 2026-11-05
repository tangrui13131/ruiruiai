# Agent 团队前端审美改造实施计划

> 执行者说明：按任务顺序执行；每个任务先写失败测试，再写最小实现，最后运行聚焦测试。提交时只添加本任务列出的文件，不使用 `git add .`。

**Goal:** 让默认 Agent 团队稳定产出有明确设计方向、适合产品语境、通过确定性视觉与可访问性检查的前端工程。

**Architecture:** 在现有 `UI Designer` 输出上增加结构化设计契约，新增根级 `DESIGN.md` 和更完整的共享样式生成器；Browser Verifier 增加确定性的视觉质量检查。只修改编排、生成工程和验证链路，不修改平台自身前端。

**Tech Stack:** React、TypeScript、Ant Design、Zod、Playwright、Vitest、现有 Future Cup 编排与验证包。

**基线日期:** 2026-11-04

---

## 1. 改造边界

### 目标

- 默认 `UI Designer` 从“生成一组颜色 token”升级为“生成完整设计契约”。
- 每个生成项目拥有根级 `DESIGN.md`，Frontend、Integration 和 Repair 共享同一设计依据。
- 生成项目通过可确定验证的视觉底线：对比度、横向溢出、标题层级、移动端互动尺寸。
- 主观审美检查只产生警告，不直接触发自动 Repair 或阻断交付。
- 保持 1–7 人团队边界，不新增第 8 个设计评审 Agent。
- 平台自身前端由队友负责，本方案不修改 `packages/experimental/future-cup-platform/ui/`。

### 非目标

- 不把 `impeccable-main` 整个仓库复制进项目。
- 不在产品运行时执行 Impeccable CLI、hook、浏览器 overlay 或 live mode。
- 不让主观 AI 评分成为构建、验证或修复的硬门禁。
- 不在本次改造中重做 HQ 3D 大屏。
- 不修改平台管理界面、团队页面、智能配队页面或共享主题。
- 不重写全部 Ant Design 组件，也不引入第二套组件库。

### 不可破坏的仓库规则

- 卡片圆角不超过 `8px`，不采用 Impeccable 的 `12–16px` 默认建议。
- 功能 UI 字体粗细最高 `500`，不使用 600+ 制造层级。
- 生成页面文案必须来自用户需求与 Tester spec，不由 Agent 自创无关营销内容。
- 保留现有未提交改动；每个提交只包含本计划明确列出的文件。
- 新模型输入必须能从 Session 日志重建。
- UI Designer 输出格式变化通过新 Agent 版本发布，不修改已冻结的 `1.0.0` 版本。

---

## 2. 现状与问题

当前 `UI_DESIGNER_INSTRUCTIONS` 只要求简短视觉系统、描述和紧凑 token，见 `packages/experimental/future-cup-orchestration/src/prompts.ts`。

当前 `uiDesignerOutputSchema` 只有 7 个颜色、一个字体族、圆角和间距单位，见 `packages/experimental/future-cup-orchestration/src/schemas.ts`。它无法表达：

- 页面属于 `Operate`、`Persuade`、`Read` 还是 `Experience`。
- 产品的视觉概念和差异化元素。
- 信息密度、导航方式、主要布局模式。
- 组件状态、移动端结构变化和禁止模式。
- 字体比例和数值数据的层级。

当前脚手架硬编码 `Inter` 和 `.metric-grid`，见 `packages/experimental/future-cup-orchestration/src/project-scaffold.ts`。默认团队容易生成白底、紫色、指标卡加图表的通用 AI 仪表盘。

当前 Browser Verifier 验证页面可见、导航、控制台、请求和截图，但不检查低对比度、页面横向溢出、标题层级或触控尺寸，见 `packages/experimental/future-cup-orchestration/src/browser-verifier.ts`。

平台自身的 `/teams`、`/team-builder` 和共享主题由队友维护；本方案只处理默认 Agent 团队生成出来的前端项目。

---

## 3. 目标架构

### 数据流

```text
用户需求
  -> Planner 页面与任务 DAG
  -> UI Designer 输出 UiDesignerOutput
      -> designSystem：布局、密度、字体、状态、响应式和禁止模式
      -> tokens：可验证的颜色、字体、圆角和间距
  -> 编排器生成 DESIGN.md 与 src/design.css
  -> Frontend 按设计契约实现页面
  -> Integration 保留设计契约和共享导航
  -> Browser Verifier 执行功能检查 + 确定性视觉检查
  -> 发现问题进入有界 Repair
  -> Delivery 保存 DESIGN.md、截图和验证报告
```

### 新增设计契约

```ts
type DesignSurfaceMode = 'OPERATE' | 'PERSUADE' | 'READ' | 'EXPERIENCE'
type DesignDensity = 'compact' | 'balanced' | 'spacious'
type DesignLayoutPattern = 'table-first' | 'dashboard-grid' | 'split-pane' | 'workspace'

interface UiDesignSystem {
  readonly surfaceMode: DesignSurfaceMode
  readonly conceptName: string
  readonly conceptRationale: string
  readonly signatureElement: string
  readonly layoutPattern: DesignLayoutPattern
  readonly navigation: 'sidebar' | 'topbar' | 'mixed'
  readonly density: DesignDensity
  readonly typeScale: {
    readonly pageTitle: number
    readonly sectionTitle: number
    readonly body: number
    readonly data: number
  }
  readonly componentRules: readonly string[]
  readonly responsiveRules: readonly string[]
  readonly avoidPatterns: readonly string[]
}
```

### 扩展后的设计 token

```ts
interface UiDesignTokens {
  readonly background: string
  readonly surface: string
  readonly raisedSurface: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly accentText: string
  readonly border: string
  readonly danger: string
  readonly success: string
  readonly warning: string
  readonly fontFamily: string
  readonly fontFamilyMono: string
  readonly cardRadius: number
  readonly spacingUnit: number
}
```

### 版本策略

| 对象 | 旧版本 | 新版本 | 说明 |
|---|---|---|---|
| UI Designer | `ui-designer-1.0.0` | `ui-designer-1.1.0` | 新增设计契约和扩展 token |
| 其他 Agent | `*-1.0.0` | 保持 `*-1.0.0` | 不在同一改造中无条件升级 |
| 默认团队 | `future-cup-default-team-2.0.0` | `future-cup-default-team-2.1.0` | 冻结引用新 UI Designer |

已启动项目继续使用冻结的 `2.0.0` 团队。新项目默认使用 `2.1.0`。

---

## 4. 文件结构

### 修改

- `packages/experimental/future-cup-orchestration/src/types.ts`
- `packages/experimental/future-cup-orchestration/src/schemas.ts`
- `packages/experimental/future-cup-orchestration/src/prompts.ts`
- `packages/experimental/future-cup-orchestration/src/default-agent-team.ts`
- `packages/experimental/future-cup-orchestration/src/project-scaffold.ts`
- `packages/experimental/future-cup-orchestration/src/team-orchestrator.ts`
- `packages/experimental/future-cup-orchestration/src/browser-verifier.ts`

### 创建

- `packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts`
- `packages/experimental/future-cup-orchestration/src/design-verifier.ts`
- `packages/experimental/future-cup-orchestration/tests/design-eval.fixtures.ts`

### 文档与证据

- `packages/experimental/future-cup-orchestration/README.md`
- `packages/experimental/future-cup-orchestration/README.zh.md`
- `deliverables/future-cup-initial/文案/Agent团队前端审美验收记录.md`

---

## 5. 实施任务

### Task 0: 固定审美基线和评测样本

**Files:**
- Create: `packages/experimental/future-cup-orchestration/tests/design-eval.fixtures.ts`
- Create: `.artifacts/design-eval/baseline/` 下的运行截图，不提交 Git

**Step 1: 定义五类固定需求**

```ts
export const DESIGN_EVAL_FIXTURES = [
  {
    id: 'operations-console',
    requirement: '构建运营数据后台，包含总览和用户管理两页，强调高密度表格和状态扫描。',
    expectedMode: 'OPERATE',
  },
  {
    id: 'finance-dashboard',
    requirement: '构建财务分析仪表盘，包含趋势、异常和明细两页，要求清晰区分正常与风险数据。',
    expectedMode: 'OPERATE',
  },
  {
    id: 'project-workspace',
    requirement: '构建项目协作工作台，包含任务板与项目详情两页，强调快速切换和进度识别。',
    expectedMode: 'OPERATE',
  },
  {
    id: 'customer-portal',
    requirement: '构建客户服务门户，包含服务概览与工单列表两页，首次使用者也能快速理解。',
    expectedMode: 'OPERATE',
  },
  {
    id: 'product-launch',
    requirement: '构建产品发布专题页和功能详情页，强调品牌表达和明确转化入口。',
    expectedMode: 'PERSUADE',
  },
] as const
```

**Step 2: 记录改造前证据**

用现有默认团队依次运行五个需求，保存桌面与 390px 移动端截图到 `.artifacts/design-eval/baseline/<fixture-id>/`。

**Step 3: 建立人工评分表**

每项按 0–4 分评分：

| 维度 | 评分重点 |
|---|---|
| 产品贴合度 | 视觉和结构是否只适合当前需求 |
| 信息层级 | 主任务、辅助信息和状态是否一眼可区分 |
| 排版 | 字号、字重、行高和数值对齐是否有明确比例 |
| 颜色 | 主色是否只用于动作和状态，对比是否可靠 |
| 布局 | 页面是否围绕真实任务组织，而非默认卡片堆叠 |
| 响应式 | 390px 下主操作和核心信息是否完整 |
| 可访问性 | 对比度、焦点、标题层级和触控尺寸 |

改造目标：五项平均分至少提高 `4/28`，且任何维度不得低于 `2/4`。

---

### Task 1: 新增设计契约类型与 Zod 校验

**Files:**
- Modify: `packages/experimental/future-cup-orchestration/src/types.ts`
- Modify: `packages/experimental/future-cup-orchestration/src/schemas.ts`
- Test: `packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts`

**Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { uiDesignerOutputSchema } from '../src/schemas.ts'

const validDesign = {
  summary: 'A dense operations console.',
  designSpec: 'Use a table-first workspace with one compact action area.',
  designSystem: {
    surfaceMode: 'OPERATE',
    conceptName: 'Operations ledger',
    conceptRationale: 'The product prioritizes scanning queues and exceptions.',
    signatureElement: 'A fixed status rail using semantic labels and counts.',
    layoutPattern: 'table-first',
    navigation: 'sidebar',
    density: 'compact',
    typeScale: {
      pageTitle: 30,
      sectionTitle: 16,
      body: 13,
      data: 13,
    },
    componentRules: [
      'Use rows and dividers for repeated records.',
      'Use cards only for isolated, actionable items.',
    ],
    responsiveRules: [
      'Collapse the sidebar below 960px.',
      'Keep the first status column visible on mobile.',
    ],
    avoidPatterns: [
      'No purple gradient hero',
      'No nested cards',
    ],
  },
  tokens: {
    background: '#f3f6f4',
    surface: '#ffffff',
    raisedSurface: '#f8faf9',
    text: '#17211d',
    muted: '#5c6b64',
    accent: '#0f766e',
    accentText: '#ffffff',
    border: '#d8e0dc',
    danger: '#b91c1c',
    success: '#15803d',
    warning: '#b45309',
    fontFamily: '"Segoe UI", "PingFang SC", sans-serif',
    fontFamilyMono: '"Cascadia Code", monospace',
    cardRadius: 8,
    spacingUnit: 4,
  },
} as const

describe('ui designer design contract', () => {
  it('accepts a complete Operate design contract', () => {
    expect(uiDesignerOutputSchema.safeParse(validDesign).success).toBe(true)
  })

  it('rejects an unknown surface mode and oversized card radius', () => {
    expect(uiDesignerOutputSchema.safeParse({
      ...validDesign,
      designSystem: { ...validDesign.designSystem, surfaceMode: 'DECORATIVE' },
    }).success).toBe(false)
    expect(uiDesignerOutputSchema.safeParse({
      ...validDesign,
      tokens: { ...validDesign.tokens, cardRadius: 12 },
    }).success).toBe(false)
  })
})
```

**Step 2: 运行测试并确认失败**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts
```

预期：`designSystem` 不被当前 schema 接受，或新测试文件无法导入目标字段。

**Step 3: 增加类型**

在 `types.ts` 增加 `DesignSurfaceMode`、`DesignDensity`、`DesignLayoutPattern` 和 `UiDesignSystem`，并扩展 `UiDesignTokens` 与 `UiDesignerOutput`。

**Step 4: 增加 Zod schema**

在 `schemas.ts` 使用 `z.enum`、`z.number().int()` 和数组上下限约束设计契约。`cardRadius` 上限设为 `8`，`designSystem` 使用 `.strict()`。

**Step 5: 运行测试**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts
```

预期：2 个测试通过。

**Step 6: 提交**

```powershell
git add packages/experimental/future-cup-orchestration/src/types.ts packages/experimental/future-cup-orchestration/src/schemas.ts packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts
git commit -m "feat(future-cup): add structured design contract"
```

---

### Task 2: 让默认 UI Designer 使用设计契约

**Files:**
- Modify: `packages/experimental/future-cup-orchestration/src/prompts.ts`
- Modify: `packages/experimental/future-cup-orchestration/src/default-agent-team.ts`
- Test: `packages/experimental/future-cup-orchestration/tests/agent-registry-service.spec.ts`
- Test: `packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts`

**Step 1: 写团队版本测试**

在 `agent-registry-service.spec.ts` 增加断言：

```ts
expect(DEFAULT_AGENT_TEAM_ID).toBe('future-cup-default-team-2.1.0')
```

在 `team-orchestrator.spec.ts` 更新 UI Designer fixture，使其包含完整 `designSystem` 和新增 token。

**Step 2: 更新 UI Designer 指令**

`UI_DESIGNER_INSTRUCTIONS` 明确要求：

```text
Infer the surface mode from the requirement. Use OPERATE for dashboards, admin tools, forms, and workspaces.
For OPERATE, optimize scanability, density, consistency, and task completion.
State one product-specific concept and one signature element that is justified by the requirement.
Define the navigation, layout pattern, information density, type scale, component rules, responsive rules, and avoid patterns.
Use a deliberate hierarchy instead of applying the same structure to every page.
Use local or system fonts. Do not use remote assets.
Use cardRadius at most 8.
Avoid purple-blue gradients, hero metrics, nested cards, decorative motion, and card grids used as the only page structure.
Make designSpec name the page hierarchy, primary actions, critical states, desktop layout, and mobile layout.
```

Frontend 指令增加：

```text
Treat designSystem and designSpec as binding product context.
Implement the declared signature element and responsive rules.
Do not replace the shared design direction with Ant Design defaults or a generic metric-card grid.
```

Integration 指令增加：

```text
Preserve the CSS variable contract in src/design.css and the product decisions in DESIGN.md.
Do not remove the shared navigation or replace declared page structure with a generic card shell.
```

**Step 3: 创建角色级版本表**

在 `default-agent-team.ts` 以角色映射版本，只有 UI Designer 使用 `1.1.0`，其他角色保持 `1.0.0`。将默认团队 ID 和版本改为 `2.1.0`。

**Step 4: 运行测试**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/agent-registry-service.spec.ts packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts
```

预期：旧项目和冻结版本测试通过；新默认团队引用 `ui-designer-1.1.0`。

**Step 5: 提交**

```powershell
git add packages/experimental/future-cup-orchestration/src/prompts.ts packages/experimental/future-cup-orchestration/src/default-agent-team.ts packages/experimental/future-cup-orchestration/tests/agent-registry-service.spec.ts packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts
git commit -m "feat(future-cup): version the aesthetic design contract"
```

---

### Task 3: 生成 DESIGN.md 和新的共享样式

**Files:**
- Modify: `packages/experimental/future-cup-orchestration/src/project-scaffold.ts`
- Modify: `packages/experimental/future-cup-orchestration/src/team-orchestrator.ts`
- Test: `packages/experimental/future-cup-orchestration/tests/project-scaffold.spec.ts`

**Step 1: 写失败测试**

在 `project-scaffold.spec.ts` 增加：

```ts
it('renders the design contract and semantic CSS variables', () => {
  const css = renderDesignStylesheet(validDesign.tokens)
  const markdown = renderDesignDocument(validDesign, 'Operations Console')

  expect(css).toContain('--app-surface-raised: #f8faf9;')
  expect(css).toContain('--app-success: #15803d;')
  expect(css).not.toContain('.metric-grid')
  expect(markdown).toContain('# Operations Console Design')
  expect(markdown).toContain('Operations ledger')
  expect(markdown).toContain('table-first')
})
```

将 `validDesign` 从 `design-contract.spec.ts` 的 fixture 移到共享测试 fixture，避免重复定义。

**Step 2: 实现根级设计文档**

在 `project-scaffold.ts` 增加：

```ts
export function renderDesignDocument(
  design: UiDesignerOutput,
  projectName: string,
): string {
  return [
    `# ${projectName} Design`,
    '',
    `## Direction`,
    '',
    design.designSystem.conceptName,
    '',
    design.designSystem.conceptRationale,
    '',
    `Signature element: ${design.designSystem.signatureElement}`,
    '',
    `Surface mode: ${design.designSystem.surfaceMode}`,
    `Layout: ${design.designSystem.layoutPattern}`,
    `Density: ${design.designSystem.density}`,
    '',
    '## Product Rules',
    '',
    design.designSpec,
    '',
    '## Responsive Rules',
    '',
    ...design.designSystem.responsiveRules.map(rule => `- ${rule}`),
    '',
    '## Avoid',
    '',
    ...design.designSystem.avoidPatterns.map(rule => `- ${rule}`),
    '',
  ].join('\n')
}
```

**Step 3: 更新共享 CSS**

`renderDesignStylesheet` 输出新增颜色变量，并把默认类改为任务导向的基础类：

- `.app-shell`
- `.app-nav`
- `.page-shell`
- `.page-header`
- `.data-region`
- `.state-panel`

删除 `.metric-grid` 和 `.metric-card` 默认样式，避免把指标卡布局写进所有项目。

**Step 4: 在编排器中写入文件**

UI Designer 输出应用阶段同时写入：

- `src/design.css`
- 根级 `DESIGN.md`

根级文件由编排器确定性生成，不接受 Agent 任意路径。`design-decision` 项目记忆继续保存结构化设计契约。

**Step 5: 运行测试**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/project-scaffold.spec.ts packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts
```

预期：CSS、DESIGN.md、项目记忆和文件写入测试通过。

**Step 6: 提交**

```powershell
git add packages/experimental/future-cup-orchestration/src/project-scaffold.ts packages/experimental/future-cup-orchestration/src/team-orchestrator.ts packages/experimental/future-cup-orchestration/tests/project-scaffold.spec.ts packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts
git commit -m "feat(future-cup): render project design contract"
```

---

### Task 4: 增加确定性视觉验证

**Files:**
- Create: `packages/experimental/future-cup-orchestration/src/design-verifier.ts`
- Modify: `packages/experimental/future-cup-orchestration/src/browser-verifier.ts`
- Test: `packages/experimental/future-cup-orchestration/tests/browser-verifier.spec.ts`

**Step 1: 写失败测试**

在 Browser Verifier fixture 中增加低对比度、页面横向溢出和非法标题层级案例：

```ts
it('reports deterministic visual quality findings', {
  timeout: 60_000,
}, async () => {
  const root = fixture({
    content: 'Visual Fixture',
    extraMarkup: [
      '<p style="color:#eee;background:#fff">Low contrast copy</p>',
      '<div style="width:1200px">Wide content</div>',
      '<h1>Visual Fixture</h1><h3>Skipped heading</h3>',
    ].join(''),
  })

  const result = await verifyBrowser(root, spec, { timeoutMs: 10_000 })

  expect(result.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
    'DESIGN_LOW_CONTRAST',
    'DESIGN_HORIZONTAL_OVERFLOW',
    'DESIGN_HEADING_ORDER',
  ]))
})
```

同步扩展 `fixture` 参数，把 `extraMarkup` 插入 `<main>`，不改测试中的其他路由行为。

**Step 2: 实现检查函数**

`design-verifier.ts` 暴露：

```ts
export async function inspectDesign(
  page: Page,
  viewport: 'desktop' | 'mobile',
  route: string,
): Promise<VerificationFinding[]>
```

MVP 检查项：

| Code | 严重度 | 条件 |
|---|---|---|
| `DESIGN_LOW_CONTRAST` | `error` | 可见文本与背景对比度低于 4.5:1 |
| `DESIGN_HORIZONTAL_OVERFLOW` | `error` | 390px 视口出现页面级横向滚动 |
| `DESIGN_HEADING_ORDER` | `warning` | 页面缺少 `h1` 或标题层级跳级 |
| `DESIGN_TOUCH_TARGET_SMALL` | `warning` | 移动端可见主要按钮或链接小于 24px |
| `DESIGN_METRIC_CARD_ONLY` | `warning` | 页面主体仅由同构指标卡构成 |
| `DESIGN_NESTED_CARDS` | `warning` | 检测到明确嵌套卡片容器 |

对比度检查最多采样 `200` 个可见文本节点，避免大页面验证失速。

**Step 3: 接入 Browser Verifier**

在 `assertRendered` 之后、截图之前调用 `inspectDesign`。视觉警告不改变 `BrowserVerification.status`，错误会把状态置为 `FAIL`。

**Step 4: 运行测试**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/browser-verifier.spec.ts packages/experimental/future-cup-orchestration/tests/verification.spec.ts
```

预期：旧浏览器测试保持通过，新视觉案例返回稳定 code 和 target。

**Step 5: 提交**

```powershell
git add packages/experimental/future-cup-orchestration/src/design-verifier.ts packages/experimental/future-cup-orchestration/src/browser-verifier.ts packages/experimental/future-cup-orchestration/tests/browser-verifier.spec.ts
git commit -m "feat(future-cup): verify visual quality in browser"
```

---

### Task 5: 回归、快照与真实 E2E

**Files:**
- Modify: `packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts`
- Create: `deliverables/future-cup-initial/文案/Agent团队前端审美验收记录.md`

**Step 1: 增加真实 E2E 断言**

真实团队 E2E 在生成完成后读取 `DESIGN.md`，并断言：

- `DESIGN.md` 存在且包含 `Surface mode`。
- `src/design.css` 包含新增语义变量。
- 浏览器验证包含桌面和移动端截图。
- 没有 `DESIGN_LOW_CONTRAST` 或 `DESIGN_HORIZONTAL_OVERFLOW` 错误。

**Step 2: 运行编排聚焦测试**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration/tests/design-contract.spec.ts packages/experimental/future-cup-orchestration/tests/project-scaffold.spec.ts packages/experimental/future-cup-orchestration/tests/browser-verifier.spec.ts packages/experimental/future-cup-orchestration/tests/team-orchestrator.spec.ts
```

**Step 3: 运行真实 E2E**

```powershell
pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts
```

预期：有 `DEEPSEEK_API_KEY` 时完成真实多 Agent 运行；无密钥时测试明确跳过，不报告通过。

**Step 4: 更新 model-visible snapshot**

本次修改改变 UI Designer 的模型输入和输出契约，必须新增 keyless recorded-session 快照，覆盖新默认团队的 UI Designer 输出、`DESIGN.md`、`design.css` 和视觉验证结果。若现有 Future Cup snapshot harness 不支持该路径，在同一变更中补齐支持。

**Step 5: 运行仓库级验证**

```powershell
pnpm exec vitest run packages/experimental/future-cup-orchestration packages/experimental/future-cup-platform
pnpm run typecheck
pnpm run lint
pnpm run build:artifacts
pnpm run build:check
pnpm run test:snapshot -t "future cup design contract"
```

预期：所有命令通过；任何平台相关失败必须报告实际命令和错误，不以“未运行”代替。

**Step 6: 写验收记录**

验收记录包含：

- 五个固定需求改造前后截图。
- 每项七个维度的评分。
- 确定性视觉检查结果。
- 明确标注未覆盖的浏览器、设备或模型路径。

**Step 7: 提交**

```powershell
git add packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts deliverables/future-cup-initial/文案/Agent团队前端审美验收记录.md
git commit -m "test(future-cup): verify aesthetic delivery pipeline"
```

---

### Task 6: 文档与可选的 Impeccable 开发评审

**Files:**
- Modify: `packages/experimental/future-cup-orchestration/README.md`
- Modify: `packages/experimental/future-cup-orchestration/README.zh.md`

**Step 1: 更新包 README**

记录新的 `UiDesignerOutput`、`DESIGN.md` 契约、视觉发现 code、基于版本的默认团队切换方式和主观检查边界。

**Step 2: 保持 Impeccable 为生成项目的开发工具**

如需使用 Impeccable 对默认 Agent 团队生成的项目做人工设计评审，只安装到开发者环境或作为 Agent skill 使用：

```text
$impeccable critique .artifacts/design-eval/after/operations-console/workspace/src/pages
$impeccable critique .artifacts/design-eval/after/product-launch/workspace/src/pages
$impeccable audit .artifacts/design-eval/after/operations-console/workspace/src/pages
```

不把它的 CLI、hook、browser overlay、live mode 或二进制缓存加入平台运行依赖和 CI，也不使用它修改平台自身前端。

**Step 3: 运行文档检查**

```powershell
pnpm run test:docs
```

**Step 4: 提交**

```powershell
git add packages/experimental/future-cup-orchestration/README.md packages/experimental/future-cup-orchestration/README.zh.md
git commit -m "docs(future-cup): document design contract delivery"
```

---

## 6. 验收标准

### 默认团队产物

- 新项目绑定 `future-cup-default-team-2.1.0` 和 `ui-designer-1.1.0`。
- 已启动项目继续使用冻结的旧团队，恢复后行为不变。
- 每个生成项目包含 `DESIGN.md`、`src/design.css`、桌面截图和移动截图。
- 五个固定需求的平均设计评分至少提高 `4/28`，任何维度不低于 `2/4`。
- `DESIGN_LOW_CONTRAST`、`DESIGN_HORIZONTAL_OVERFLOW` 为零。
- 不出现远程字体、嵌套卡片、全页同构指标卡或紫色渐变主视觉。
- `pnpm run typecheck`、聚焦测试、构建检查和模型输出快照通过。

### 自主修复边界

- 只有确定性视觉错误进入 Repair。
- 主观审美警告进入报告和验收记录，不自动降低验证标准。
- Repair 不得删除设计契约或绕过视觉检查。

---

## 7. 交付顺序与估算

| 阶段 | 内容 | 预计时间 |
|---|---|---|
| P0 | 基线、设计契约、版本化团队 | 1.5 天 |
| P1 | DESIGN.md、共享样式、确定性视觉验证 | 1.5 天 |
| P2 | 真实 E2E、快照、截图和文档 | 1 天 |

建议拆成 3 个可独立审查的 PR：设计契约与版本、样式生成与视觉验证、真实 E2E 与证据文档。

---

## 8. 风险与缓解

- **审美仍可能同质化。** 用固定五类需求、产品贴合度和差异化元素评分验证，不以单张漂亮截图作为成功证据。
- **主观规则造成误停。** 确定性对比度、溢出和标题问题可阻断；卡片密度、字体和视觉方向只产生警告。
- **Prompt 过长导致指令失效。** 设计规则放进结构化字段，提示词只保留决策顺序和禁止项。
- **设计契约膨胀。** 保持数组上限和字段短文本，不为每个组件建立独立 schema。
- **旧项目受到版本污染。** 通过新 Agent 版本和默认团队版本发布，旧项目继续引用冻结快照。
- **浏览器检查增加耗时。** 对比度采样限制为可见文本节点，所有检查合并进已有页面访问，不重复启动浏览器。
- **引入外部供应链风险。** Impeccable 只用于人工开发评审，不进入生产运行、自动修复和 CI 路径。
- **设计与仓库规范冲突。** 项目规范优先：圆角 `8px`、字重最高 `500`，生成页面的文案与 Ant Design 组件契约保持可验证。
