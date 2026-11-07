import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname
const repoRoot = resolve(here, '../../..')
const outRoot = resolve(here, '..')
const sourceRoot = resolve(repoRoot, '.artifacts')
const playwrightPath = resolve(
  repoRoot,
  'packages/experimental/future-cup-orchestration/node_modules/playwright/index.mjs',
)
const { chromium } = await import(pathToFileURL(playwrightPath).href)

const C = {
  bg: '#07131f',
  panel: '#0d2231',
  panel2: '#112c3d',
  panel3: '#163548',
  ink: '#f2f7f5',
  muted: '#96acb8',
  border: '#27475a',
  teal: '#31d2bd',
  tealSoft: '#123d40',
  amber: '#ffc45c',
  amberSoft: '#3d311a',
  coral: '#ff7b62',
  coralSoft: '#40221f',
  blue: '#72b7f2',
  blueSoft: '#172f48',
  green: '#7ddc8b',
}

const esc = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

function text(x, y, value, options = {}) {
  const {
    size = 22,
    weight = 500,
    fill = C.ink,
    anchor = 'start',
    mono = false,
    opacity = 1,
  } = options
  const family = mono
    ? "'Cascadia Code', Consolas, monospace"
    : "'Bahnschrift', 'Microsoft YaHei', sans-serif"
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(value)}</text>`
}

function lines(x, y, values, options = {}) {
  const { size = 18, fill = C.muted, gap = 27, mono = false, weight = 400 } = options
  return values.map((value, index) =>
    text(x, y + index * gap, value, { size, fill, mono, weight })).join('')
}

function node({
  x,
  y,
  w,
  h,
  title,
  body = [],
  tag,
  accent = C.teal,
  fill = C.panel,
}) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${C.border}" stroke-width="1.5"/>
    <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${accent}"/>
    ${tag ? text(x + 22, y + 28, tag.toUpperCase(), { size: 13, weight: 700, fill: accent, mono: true }) : ''}
    ${text(x + 22, y + (tag ? 58 : 38), title, { size: 24, weight: 700 })}
    ${lines(x + 22, y + (tag ? 88 : 70), body)}
  `
}

function pill(x, y, label, color = C.teal, width = 108) {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="30" rx="15" fill="${color}" opacity="0.14" stroke="${color}" stroke-opacity="0.5"/>
    ${text(x + width / 2, y + 20, label, { size: 13, weight: 700, fill: color, anchor: 'middle', mono: true })}
  `
}

function arrow(x1, y1, x2, y2, color = C.teal, dash = '') {
  const marker = color === C.amber ? 'arrow-amber' : color === C.coral ? 'arrow-coral' : 'arrow-teal'
  return `<path d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}" marker-end="url(#${marker})"/>`
}

function straight(x1, y1, x2, y2, color = C.teal, dash = '') {
  const marker = color === C.amber ? 'arrow-amber' : color === C.coral ? 'arrow-coral' : 'arrow-teal'
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}" marker-end="url(#${marker})"/>`
}

function shell({ width, height, kicker, title, subtitle, body, footer }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
        <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#153244" stroke-width="1" opacity="0.55"/>
      </pattern>
      <marker id="arrow-teal" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.teal}"/>
      </marker>
      <marker id="arrow-amber" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.amber}"/>
      </marker>
      <marker id="arrow-coral" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.coral}"/>
      </marker>
    </defs>
    <rect width="${width}" height="${height}" fill="${C.bg}"/>
    <rect width="${width}" height="${height}" fill="url(#grid)"/>
    <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="10" fill="none" stroke="${C.border}" stroke-width="1.5"/>
    ${text(64, 74, kicker.toUpperCase(), { size: 15, weight: 700, fill: C.teal, mono: true })}
    ${text(64, 126, title, { size: 42, weight: 700 })}
    ${text(64, 164, subtitle, { size: 19, fill: C.muted })}
    ${body}
    <line x1="64" y1="${height - 58}" x2="${width - 64}" y2="${height - 58}" stroke="${C.border}"/>
    ${text(64, height - 28, footer, { size: 14, fill: C.muted, mono: true })}
    ${text(width - 64, height - 28, 'FUTURE CUP · INITIAL ROUND', { size: 14, weight: 700, fill: C.teal, anchor: 'end', mono: true })}
  </svg>`
}

function architectureDiagram() {
  const agents = [
    ['Planner', '需求与 DAG', C.amber],
    ['UI Designer', '设计 token', C.blue],
    ['Tester', '浏览器断言', C.blue],
    ['Frontend A', '页面文件', C.teal],
    ['Frontend B', '页面文件', C.teal],
    ['Integration', '路由与集成', C.teal],
    ['Repair', '有限源码修复', C.coral],
  ]
  const agentNodes = agents.map(([title, body, accent], index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    return node({
      x: 1040 + column * 260,
      y: 315 + row * 112,
      w: 230,
      h: 90,
      title,
      body: [body],
      accent,
      fill: C.panel,
    })
  }).join('')
  return shell({
    width: 1600,
    height: 900,
    kicker: '01 · SYSTEM ARCHITECTURE',
    title: '系统总体架构',
    subtitle: '控制面负责编排与证据，执行面运行独立 Harness Session，展示面消费已提交事件。',
    footer: 'BASELINE f50c1ce2 · CURRENT STATE',
    body: `
      ${node({ x: 64, y: 205, w: 250, h: 170, title: '自然语言需求', body: ['项目、团队与验收目标'], tag: 'USER', accent: C.amber })}
      ${node({ x: 365, y: 195, w: 590, h: 655, title: 'Future Cup 控制面', body: ['Cordis plugin · Fastify · Zod'], tag: 'CONTROL PLANE', accent: C.teal, fill: C.panel2 })}
      ${node({ x: 405, y: 285, w: 510, h: 88, title: 'REST API 与项目管理', body: ['项目、团队、运行、快照、交付'], accent: C.blue, fill: C.panel3 })}
      ${node({ x: 405, y: 395, w: 510, h: 88, title: 'DAG · Scheduler · Workflow', body: ['持久任务、可解释调度、控制图'], accent: C.teal, fill: C.panel3 })}
      ${node({ x: 405, y: 505, w: 510, h: 88, title: 'Registry · Team Freeze · Memory', body: ['不可变版本与项目冻结'], accent: C.amber, fill: C.panel3 })}
      ${node({ x: 405, y: 615, w: 510, h: 120, title: 'Verification · Adaptive Repair', body: ['独立证据、失败签名、有限复验'], accent: C.coral, fill: C.panel3 })}
      ${node({ x: 1010, y: 195, w: 530, h: 655, title: 'DeepSeek Harness 执行面', body: ['每角色独立 Home 与 Session'], tag: 'EXECUTION PLANE', accent: C.blue, fill: C.panel2 })}
      ${agentNodes}
      ${node({ x: 64, y: 750, w: 1475, h: 90, title: '持久化与证据层', body: ['SQLite / PostgreSQL · Journal · product_events · Outbox · screenshots · delivery'], accent: C.green, fill: C.panel2 })}
      ${straight(314, 285, 365, 285, C.amber)}
      ${straight(955, 325, 1040, 325, C.teal)}
    `,
  })
}

function agentWorkflowDiagram() {
  return shell({
    width: 1600,
    height: 900,
    kicker: '02 · AGENT WORKFLOW',
    title: 'Agent 协作与任务 DAG',
    subtitle: 'Planner 生成任务图，Tester 与 Designer 定义实现契约，两个 Frontend 并行，Integration 汇总。',
    footer: 'DAG JOURNAL + STRUCTURED OUTPUT + SCOPED WRITES',
    body: `
      ${node({ x: 55, y: 225, w: 240, h: 110, title: '用户需求', body: ['页面与交互目标'], tag: 'INPUT', accent: C.amber })}
      ${node({ x: 355, y: 205, w: 260, h: 140, title: 'Planner', body: ['页面计划', 'DAG 与依赖'], tag: 'A01', accent: C.amber })}
      ${node({ x: 675, y: 205, w: 260, h: 140, title: 'UI Designer', body: ['设计规范', '颜色 / 字体 / 间距'], tag: 'A02', accent: C.blue })}
      ${node({ x: 995, y: 205, w: 260, h: 140, title: 'Tester', body: ['路由与文本', '导航验收规格'], tag: 'A03', accent: C.blue })}
      ${node({ x: 1315, y: 205, w: 225, h: 140, title: 'Verifier', body: ['独立执行', '不参与生成'], tag: 'SYSTEM', accent: C.green })}
      ${node({ x: 410, y: 470, w: 330, h: 145, title: 'Frontend A', body: ['Overview 页面', '最多 3 个文件'], tag: 'A04', accent: C.teal })}
      ${node({ x: 850, y: 470, w: 330, h: 145, title: 'Frontend B', body: ['Users 页面', '最多 3 个文件'], tag: 'A05', accent: C.teal })}
      ${node({ x: 615, y: 675, w: 360, h: 130, title: 'Integration', body: ['HashRouter / 导航 / 共享组件', '最多 8 个 src 文件'], tag: 'A06', accent: C.teal })}
      ${node({ x: 1310, y: 470, w: 230, h: 145, title: 'Repair', body: ['结构化失败', '有界源码修复'], tag: 'A07', accent: C.coral })}
      ${straight(295, 280, 355, 280, C.amber)}
      ${straight(615, 275, 675, 275, C.teal)}
      ${straight(935, 275, 995, 275, C.teal)}
      ${straight(1255, 275, 1315, 275, C.green)}
      ${arrow(805, 345, 805, 435, C.blue)}
      ${arrow(1125, 345, 1125, 435, C.blue)}
      ${straight(575, 615, 700, 675, C.teal)}
      ${straight(1015, 615, 890, 675, C.teal)}
      ${straight(1050, 310, 1050, 470, C.coral, '7 6')}
      ${pill(670, 390, '依赖约束', C.blue, 150)}
      ${pill(95, 690, '每任务独立 Session', C.teal, 250)}
      ${pill(95, 735, '平台按 writeScope 落盘', C.amber, 280)}
    `,
  })
}

function schedulingDiagram() {
  return shell({
    width: 1600,
    height: 900,
    kicker: '03 · SCHEDULING',
    title: '可解释动态调度',
    subtitle: '候选能力、历史成功率、可用性、优先级与负载共同决定分配，全部依据持久化。',
    footer: 'DETERMINISTIC TIE-BREAK · CAPACITY DEFER · FAILED-AGENT EXCLUSION',
    body: `
      ${node({ x: 60, y: 220, w: 300, h: 520, title: 'READY 队列', body: ['按优先级排序', '依赖完成才进入'], tag: 'INPUT', accent: C.amber, fill: C.panel2 })}
      ${['design-ui', 'test-plan', 'build-overview', 'build-users'].map((task, index) => `
        <rect x="85" y="${345 + index * 82}" width="250" height="56" rx="7" fill="${C.panel3}" stroke="${C.border}"/>
        ${text(105, 369 + index * 82, 'TASK', { size: 11, weight: 700, fill: C.amber, mono: true })}
        ${text(105, 390 + index * 82, task, { size: 17, weight: 600 })}
      `).join('')}
      ${node({ x: 390, y: 220, w: 420, h: 250, title: '评分公式', body: ['能力 0.50', '成功率 0.20 · 可用性 0.15', '优先级 0.15 · 负载 -0.35'], tag: 'SCORE', accent: C.teal, fill: C.panel2 })}
      ${node({ x: 390, y: 500, w: 420, h: 240, title: '资格校验', body: ['角色匹配 · 能力覆盖', '并发容量 · 排除上一失败 Agent'], tag: 'ELIGIBILITY', accent: C.coral, fill: C.panel2 })}
      ${node({ x: 850, y: 225, w: 300, h: 160, title: 'Agent A', body: ['score 0.928', '能力 / 成功 / 负荷'], tag: 'CANDIDATE', accent: C.teal })}
      ${node({ x: 850, y: 410, w: 300, h: 160, title: 'Agent B', body: ['score 0.741', '可选 · 当前低负载'], tag: 'CANDIDATE', accent: C.blue })}
      ${node({ x: 850, y: 595, w: 300, h: 145, title: '无合格实例', body: ['延后任务', '等待下一调度轮次'], tag: 'DEFER', accent: C.amber })}
      ${node({ x: 1200, y: 225, w: 335, h: 250, title: '选中并持久化', body: ['decision + candidates', 'score terms + rejection reason'], tag: 'ASSIGN', accent: C.teal, fill: C.panel2 })}
      ${node({ x: 1200, y: 520, w: 335, h: 220, title: '启动 Harness Session', body: ['独立 Home', '独立执行记录'], tag: 'RUN', accent: C.blue, fill: C.panel2 })}
      ${arrow(360, 470, 390, 470, C.amber)}
      ${arrow(810, 335, 850, 305, C.teal)}
      ${arrow(810, 620, 850, 665, C.amber)}
      ${arrow(1150, 305, 1200, 305, C.teal)}
      ${arrow(1365, 475, 1365, 520, C.blue)}
      ${pill(100, 790, '同分：低负载优先，再按稳定 Agent ID', C.teal, 430)}
      ${pill(570, 790, '失败：可重试时重新排队', C.coral, 310)}
    `,
  })
}

function selfLoopDiagram() {
  return shell({
    width: 1600,
    height: 900,
    kicker: '04 · SELF-LOOP',
    title: '验证、修复与复验闭环',
    subtitle: '失败不会直接触发无限重试；每轮修复都受策略、时间和轮次约束。',
    footer: 'MAX 3 REPAIRS · FULL REVERIFICATION · VISIBLE ESCALATION',
    body: `
      ${node({ x: 65, y: 235, w: 280, h: 130, title: '启动验证', body: ['Tester 规格', '工程工作区'], tag: 'START', accent: C.blue })}
      ${node({ x: 405, y: 235, w: 330, h: 130, title: '独立 Verifier', body: ['结构 · TS · Vite', 'Playwright 桌面 / 移动'], tag: 'EVIDENCE', accent: C.green })}
      <polygon points="915,220 1075,300 915,380 755,300" fill="${C.panel2}" stroke="${C.amber}" stroke-width="2"/>
      ${text(915, 290, '验证状态', { size: 24, weight: 700, anchor: 'middle' })}
      ${text(915, 322, 'PASS / FAIL / INCOMPLETE', { size: 14, fill: C.muted, anchor: 'middle', mono: true })}
      ${node({ x: 1215, y: 200, w: 300, h: 120, title: '进入交付', body: ['PASSED terminal'], tag: 'PASS', accent: C.green })}
      ${node({ x: 405, y: 505, w: 330, h: 150, title: '选择修复策略', body: ['类别 / 目标 / 历史', '候选评分与理由'], tag: 'STRATEGY', accent: C.amber })}
      ${node({ x: 805, y: 505, w: 320, h: 150, title: 'Repair Session', body: ['独立 Session', '最多 8 个 src 文件'], tag: 'REPAIR', accent: C.coral })}
      ${node({ x: 1190, y: 505, w: 330, h: 150, title: '完整复验', body: ['沿用原 Verifier', '不降低阈值'], tag: 'REVERIFY', accent: C.green })}
      ${node({ x: 805, y: 720, w: 320, h: 95, title: '升级人工处理', body: ['重复 / 超时 / 耗尽'], tag: 'ESCALATED', accent: C.coral })}
      ${straight(345, 300, 405, 300, C.blue)}
      ${straight(735, 300, 755, 300, C.green)}
      ${straight(1075, 300, 1215, 260, C.green)}
      ${straight(850, 365, 570, 505, C.coral)}
      ${straight(735, 580, 805, 580, C.amber)}
      ${straight(1125, 580, 1190, 580, C.coral)}
      ${arrow(1355, 505, 1355, 365, C.green)}
      ${arrow(1355, 365, 1075, 300, C.green)}
      ${straight(965, 655, 965, 720, C.coral)}
      ${pill(150, 500, 'FAIL / INCOMPLETE', C.coral, 270)}
      ${pill(100, 765, '相同签名：先换策略，再决定是否升级', C.amber, 470)}
    `,
  })
}

function verificationDiagram() {
  const stages = [
    ['01', '结构契约', '必需文件 / HashRouter / favicon'],
    ['02', '依赖安装', 'npm install --no-audit'],
    ['03', 'TypeScript', 'npm run build:types'],
    ['04', '生产构建', 'npm run build:bundle'],
    ['05', '预览服务', 'loopback · 随机端口'],
    ['06', '桌面浏览器', '1440×900 · 文本与导航'],
    ['07', '移动浏览器', '390×844 · 布局与交互'],
    ['08', '证据归档', 'finding / screenshots / signature'],
  ]
  const stageNodes = stages.map(([index, title, body], i) => {
    const row = i < 4 ? 0 : 1
    const column = i % 4
    return node({
      x: 70 + column * 380,
      y: 230 + row * 285,
      w: 330,
      h: 185,
      title,
      body: [body],
      tag: `STAGE ${index}`,
      accent: row === 0 ? C.teal : C.blue,
      fill: C.panel2,
    })
  }).join('')
  return shell({
    width: 1600,
    height: 900,
    kicker: '05 · VERIFICATION',
    title: '独立验证流水线',
    subtitle: 'PASS 只能来自确定性检查与真实浏览器证据，环境不完整只能得到 INCOMPLETE。',
    footer: 'PAGE ERROR · CONSOLE ERROR · HTTP 4XX/5XX · FAILED REQUEST',
    body: `
      ${stageNodes}
      ${straight(400, 320, 450, 320, C.teal)}
      ${straight(780, 320, 830, 320, C.teal)}
      ${straight(1160, 320, 1210, 320, C.teal)}
      <path d="M 1450 415 L 1450 462 L 235 462 L 235 515" fill="none" stroke="${C.blue}" stroke-width="2.5" marker-end="url(#arrow-teal)"/>
      ${straight(400, 607, 450, 607, C.teal)}
      ${straight(780, 607, 830, 607, C.teal)}
      ${straight(1160, 607, 1210, 607, C.teal)}
      ${pill(500, 745, '任一 error finding：FAIL', C.coral, 300)}
      ${pill(850, 745, '浏览器不可用：INCOMPLETE', C.amber, 360)}
    `,
  })
}

function realtimeDiagram() {
  return shell({
    width: 1600,
    height: 900,
    kicker: '06 · DATA & REALTIME',
    title: '数据、事件与重连',
    subtitle: 'REST 提供权威快照，Socket.IO 只发送已提交 Outbox 事件，客户端按项目序号去重。',
    footer: 'SERIALIZABLE TRANSACTION · AT-LEAST-ONCE DELIVERY · SNAPSHOT RESYNC',
    body: `
      ${node({ x: 70, y: 220, w: 320, h: 145, title: 'Management SPA', body: ['REST + Socket.IO', '项目级状态投影'], tag: 'CLIENT', accent: C.blue })}
      ${node({ x: 70, y: 420, w: 320, h: 145, title: 'HQ 3D', body: ['只读事件映射', '序号缺口重同步'], tag: 'CLIENT', accent: C.blue })}
      ${node({ x: 500, y: 235, w: 390, h: 160, title: 'Fastify REST', body: ['project snapshot', 'tasks / verification / repairs'], tag: 'API', accent: C.teal, fill: C.panel2 })}
      ${node({ x: 500, y: 465, w: 390, h: 160, title: 'Socket.IO Gateway', body: ['join project room', 'replay afterSeq'], tag: 'REALTIME', accent: C.amber, fill: C.panel2 })}
      ${node({ x: 1000, y: 185, w: 500, h: 130, title: 'Project Transaction', body: ['领域状态 + product_event + Outbox'], tag: 'COMMIT', accent: C.green, fill: C.panel2 })}
      ${node({ x: 1000, y: 365, w: 500, h: 125, title: 'Outbox Dispatcher', body: ['claim owner + expiry', 'publish then mark'], tag: 'DELIVERY', accent: C.amber })}
      ${node({ x: 1000, y: 545, w: 500, h: 125, title: 'Workflow Lease', body: ['owner / heartbeat / fencing token'], tag: 'OWNERSHIP', accent: C.coral })}
      ${node({ x: 450, y: 725, w: 720, h: 95, title: 'SQLite / PostgreSQL', body: ['Journal · project_events · outbox_events · leases'], accent: C.green, fill: C.panel2 })}
      ${straight(390, 292, 500, 315, C.blue)}
      ${straight(390, 492, 500, 545, C.blue)}
      ${straight(890, 315, 1000, 250, C.teal)}
      ${straight(890, 545, 1000, 428, C.amber)}
      ${straight(1250, 315, 1250, 365, C.green)}
      ${straight(1250, 490, 1250, 545, C.amber)}
      ${straight(1250, 670, 1250, 725, C.coral)}
      ${straight(800, 725, 650, 625, C.green)}
      ${pill(1010, 715, '断开 → 读取 snapshot → afterSeq 续传', C.blue, 460)}
    `,
  })
}

function databaseDiagram() {
  const entity = (x, y, w, title, fields, accent = C.teal) => `
    <rect x="${x}" y="${y}" width="${w}" height="${72 + fields.length * 22}" rx="8" fill="${C.panel}" stroke="${C.border}"/>
    <rect x="${x}" y="${y}" width="${w}" height="34" rx="8" fill="${accent}" opacity="0.18"/>
    ${text(x + 16, y + 24, title, { size: 17, weight: 700, fill: accent })}
    ${fields.map((field, index) => text(x + 16, y + 57 + index * 22, field, { size: 13, fill: C.muted, mono: true })).join('')}
  `
  return shell({
    width: 1800,
    height: 1100,
    kicker: '07 · DATABASE',
    title: '核心数据模型与关系',
    subtitle: '物理表由 SQLite schema v8 和 PostgreSQL migration 实现；本图聚合展示核心实体与生命周期关系。',
    footer: 'AGENT VERSIONS · FROZEN TEAMS · DURABLE DAG · VERIFICATION · REPAIR · EVENTS',
    body: `
      ${text(70, 215, 'AGENT REGISTRY & TEAM', { size: 15, weight: 700, fill: C.amber, mono: true })}
      ${entity(55, 238, 340, 'agent_definitions', ['id · name · status', 'role · purpose'])}
      ${entity(455, 238, 370, 'agent_definition_versions', ['id · definition_id', 'model · prompt · capabilities', 'tool/memory policy · schemas'])}
      ${entity(885, 238, 330, 'agent_teams', ['id · owner_id · status', 'name · purpose'])}
      ${entity(1265, 238, 430, 'agent_team_versions', ['id · team_id · version', 'status · members · policies'])}
      ${entity(455, 460, 370, 'agent_team_members', ['version_id · instance_id', 'department · position'])}
      ${entity(885, 460, 330, 'project_team_bindings', ['project_id · team_version_id', 'frozen snapshot'])}

      ${text(70, 675, 'ORCHESTRATION & EVIDENCE', { size: 15, weight: 700, fill: C.teal, mono: true })}
      ${entity(55, 700, 300, 'projects', ['id · name · requirement', 'workflow status'])}
      ${entity(405, 700, 300, 'tasks', ['project_id · status', 'revision · assigned_agent'])}
      ${entity(755, 700, 300, 'task_journal', ['project_id · task_id', 'revision · snapshot'])}
      ${entity(1105, 700, 300, 'scheduler_decisions', ['task_id · decision_json'])}
      ${entity(1455, 710, 300, 'project_memory_entries', ['kind · key · value'])}
      ${entity(55, 875, 300, 'executions', ['task_id · agent_id · session_id'])}
      ${entity(405, 875, 300, 'verification_reports', ['status · failure_signature', 'checks · findings'])}
      ${entity(755, 875, 300, 'repair_records', ['round · before/after', 'diff · strategy link'])}
      ${entity(1105, 875, 300, 'repair_strategy_decisions', ['candidates · reasons', 'outcome'])}
      ${entity(1455, 875, 300, 'project_runs', ['status · owner_id', 'workspace · preview'])}

      ${entity(1265, 460, 430, 'workflow_control_runs', ['definition · revision', 'snapshot · status'])}
      ${entity(1265, 585, 430, 'workflow_control_events', ['entry_seq · graph/node', 'edge · loop · terminal'])}
      ${entity(885, 585, 330, 'product_events', ['project_id · seq', 'type · payload'])}
      ${entity(455, 585, 370, 'outbox_events', ['event_id · claim', 'published_at'])}
      ${entity(55, 585, 340, 'workflow_leases', ['resource_id · owner', 'expiry · fencing_token'])}

      ${straight(395, 300, 455, 300, C.amber)}
      ${straight(825, 300, 885, 300, C.amber)}
      ${straight(1215, 300, 1265, 300, C.amber)}
      ${straight(640, 365, 640, 460, C.amber)}
      ${straight(1050, 365, 1050, 460, C.teal)}
      ${straight(1050, 532, 1050, 585, C.teal)}
      ${straight(555, 700, 640, 532, C.teal)}
      ${straight(705, 700, 755, 700, C.teal)}
      ${straight(855, 700, 1105, 700, C.teal)}
      ${straight(355, 760, 405, 760, C.teal)}
      ${straight(705, 760, 755, 760, C.teal)}
      ${straight(905, 760, 1105, 760, C.teal)}
      ${straight(355, 911, 405, 911, C.coral)}
      ${straight(705, 911, 755, 911, C.coral)}
      ${straight(1055, 911, 1105, 911, C.coral)}
      ${straight(1405, 911, 1455, 911, C.coral)}
      ${straight(1450, 532, 1450, 585, C.blue)}
    `,
  })
}

const diagrams = [
  {
    id: '01-system-architecture',
    title: '系统总体架构',
    width: 1600,
    height: 900,
    svg: architectureDiagram(),
  },
  {
    id: '02-agent-workflow-dag',
    title: 'Agent 协作与任务 DAG',
    width: 1600,
    height: 900,
    svg: agentWorkflowDiagram(),
  },
  {
    id: '03-scheduling',
    title: '可解释动态调度',
    width: 1600,
    height: 900,
    svg: schedulingDiagram(),
  },
  {
    id: '04-self-loop',
    title: '验证、修复与复验闭环',
    width: 1600,
    height: 900,
    svg: selfLoopDiagram(),
  },
  {
    id: '05-verification-pipeline',
    title: '独立验证流水线',
    width: 1600,
    height: 900,
    svg: verificationDiagram(),
  },
  {
    id: '06-data-realtime',
    title: '数据、事件与重连',
    width: 1600,
    height: 900,
    svg: realtimeDiagram(),
  },
  {
    id: '07-database-er',
    title: '核心数据模型与关系',
    width: 1800,
    height: 1100,
    svg: databaseDiagram(),
  },
]

const matrixRows = [
  ['多 Agent 协作', '7 类角色；独立 Session；Planner、Frontend A/B、Integration', 'PASS', '`run-result.json`；`02-agent-workflow-dag.png`'],
  ['Agent 注册与版本', '不可变定义版本、发布、发现、弃用', 'PASS', '`agent-registry.ts`；202 项编排测试'],
  ['用户团队库', '1-7 实例、克隆、归档、项目冻结', 'PASS', '`MyTeamsPage.tsx`；`03-我的团队.png`'],
  ['项目派生升级', '后继项目、冻结团队继承、来源源码快照、旧项目保留', 'PASS', '`project-derivation.ts`；`delivery-snapshot.ts`；派生 API 测试'],
  ['动态任务 DAG', '依赖、并行、阻断、Journal、恢复', 'PASS', '`dag-engine.ts`；`06-任务DAG.png`'],
  ['可解释调度', '加权评分、候选证据、容量延后、重试排除', 'PASS', '`scheduler.ts`；`07-调度决策.png`'],
  ['条件分支与 Self-loop', '条件边、有界循环、Repair 子工作流、升级', 'PASS', '`workflow-control.ts`；36 条控制事件'],
  ['自适应修复策略', '8 类 finding、候选评分、策略切换、完整复验', 'PASS', '`adaptive-repair.ts`；`09-SelfLoop自愈.png`'],
  ['真实模型执行', 'DeepSeek 七人团队、7 个 Home、6 生成 + 1 Repair Session', 'PASS', '真实 E2E `PASSED`'],
  ['工具权限控制', 'read / read_image / working_directory；Shell 和写入禁用', 'PASS', '`harness-agents.ts`；Session request header'],
  ['独立构建验证', '依赖、TypeScript、Vite', 'PASS', '`build-verifier.ts`；`08-验证报告.png`'],
  ['真实浏览器验证', '桌面和移动、文本、导航、控制台、网络、截图', 'PASS', '4/4 Browser Checks；Playwright 截图'],
  ['实时事件与重连', '项目序号、Outbox、Socket.IO、缺口重同步', 'PASS', '`10-事件流.png`；browser smoke'],
  ['SQLite / PostgreSQL', '共享 Store 抽象、迁移、lease、fencing', 'PASS', 'SQLite v9；既有 PostgreSQL E2E'],
  ['管理平台', '11 个桌面路由、3 个移动页面、无错误', 'PASS', '`browser-smoke.json`；功能截图'],
  ['交付预览', '生成工程 dist、截图与在线预览入口', 'PASS', '`11-交付预览.png`；生成工程截图'],
  ['LLM 实际作用', '规划、设计、测试规格、页面、集成、修复', 'PASS', '提交的 8 个 Prompt/Schema；121,434 Token'],
  ['RAG', '初赛未实现，计划决赛接入受控知识检索', 'PLANNED', '方案书 AI 使用章节'],
  ['MCP', '仅挂载 resource 基础插件，无实际 Server/Client', 'PLANNED', '`sdk-minimal` profile；能力边界声明'],
  ['压力测试', '并发、吞吐、延迟分位、长稳放入决赛', 'PLANNED', '初赛单次 E2E 仅作观察'],
  ['容器隔离', 'Docker/SWE-ReX 已验证，未接入主运行链路', 'PARTIAL', '`测试截图/03-安全与能力边界.png`；系统报告 12.1'],
]

const evidenceHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Future Cup 最终测试证据</title>
<style>
  :root { --bg:${C.bg}; --panel:${C.panel}; --ink:${C.ink}; --muted:${C.muted}; --teal:${C.teal}; --amber:${C.amber}; --coral:${C.coral}; --border:${C.border}; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:'Microsoft YaHei',sans-serif; }
  .panel { width:1600px; padding:64px; background:
    linear-gradient(rgba(49,210,189,.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(49,210,189,.04) 1px,transparent 1px),var(--bg);
    background-size:44px 44px; }
  .kicker { color:var(--teal); font:700 14px Consolas,monospace; letter-spacing:.12em; }
  h1 { margin:16px 0 8px; font-size:46px; }
  .sub { margin:0 0 38px; color:var(--muted); font-size:19px; }
  .grid { display:grid; gap:20px; }
  .kpis { grid-template-columns:repeat(4,1fr); }
  .card { border:1px solid var(--border); background:#0d2231; padding:26px; border-radius:8px; }
  .label { color:var(--muted); font-size:14px; text-transform:uppercase; letter-spacing:.08em; }
  .value { margin-top:14px; font:700 44px 'Bahnschrift',sans-serif; }
  .unit { margin-left:4px; color:var(--teal); font-size:18px; }
  .foot { color:var(--muted); margin-top:22px; font:14px Consolas,monospace; }
  .timeline { display:grid; grid-template-columns:repeat(3,1fr); gap:22px; margin-top:32px; }
  .step { position:relative; }
  .step:not(:last-child):after { content:''; position:absolute; left:40px; right:-22px; top:14px; height:2px; background:var(--teal); }
  .dot { width:28px; height:28px; border-radius:50%; background:var(--teal); color:#06131b; font:700 15px/28px 'Bahnschrift'; text-align:center; }
  .step h3 { margin:16px 0 8px; font-size:21px; }
  .step p { margin:0; color:var(--muted); line-height:1.6; }
  .bar { margin-top:22px; height:10px; border-radius:5px; background:#193242; overflow:hidden; }
  .bar > span { display:block; height:100%; background:linear-gradient(90deg,var(--teal),var(--amber)); }
  .checks { grid-template-columns:repeat(3,1fr); margin-top:30px; }
  .check { display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding:13px 0; gap:20px; }
  .pass { color:var(--teal); font-weight:700; }
  .planned { color:var(--amber); font-weight:700; }
  .partial { color:var(--coral); font-weight:700; }
  .note { margin-top:26px; padding:18px 22px; border-left:4px solid var(--amber); background:#1b2934; color:#c9d7dc; line-height:1.7; }
</style>
</head>
<body>
<section class="panel" data-shot="summary">
  <div class="kicker">FINAL ACCEPTANCE · ${new Date().toISOString().slice(0,10)}</div>
  <h1>初赛系统完成度测试证据</h1>
  <p class="sub">当前 HEAD f50c1ce2c6e6e08324a4addde64178ba89ba6c62 · 真实运行与构建门禁</p>
  <div class="grid kpis">
    <div class="card"><div class="label">Orchestration Tests</div><div class="value">202<span class="unit">PASS</span></div><div class="foot">20 files · 0 failed</div></div>
    <div class="card"><div class="label">Platform Tests</div><div class="value">34<span class="unit">PASS</span></div><div class="foot">6 files · 0 failed</div></div>
    <div class="card"><div class="label">Management UI</div><div class="value">91<span class="unit">PASS</span></div><div class="foot">24 files · 0 failed</div></div>
    <div class="card"><div class="label">Build Gates</div><div class="value">10/10</div><div class="foot">TypeScript + client + host</div></div>
  </div>
  <div class="checks grid">
    <div><div class="check"><span>编排类型检查</span><span class="pass">PASS</span></div><div class="check"><span>平台类型检查</span><span class="pass">PASS</span></div><div class="check"><span>UI 类型检查</span><span class="pass">PASS</span></div></div>
    <div><div class="check"><span>真实 DeepSeek E2E</span><span class="pass">PASS</span></div><div class="check"><span>浏览器冒烟</span><span class="pass">PASS</span></div><div class="check"><span>功能截图</span><span class="pass">24 张</span></div></div>
    <div><div class="check"><span>PostgreSQL 本轮</span><span class="planned">未重跑</span></div><div class="check"><span>压力测试</span><span class="planned">决赛</span></div><div class="check"><span>容器主链路</span><span class="partial">未接入</span></div></div>
  </div>
  <div class="note">本页数据来自最终候选版本的聚焦测试、完整构建和真实 DeepSeek E2E。压力、并发和长稳测试不纳入初赛结论。</div>
</section>

<section class="panel" data-shot="e2e">
  <div class="kicker">REAL DEEPSEEK E2E · SEVEN AGENT TEAM</div>
  <h1>从生成到自愈的完整闭环</h1>
  <p class="sub">初始运行 17 分 43 秒 · 故障演练约 43 秒 · 全流程 1109.53 秒</p>
  <div class="timeline">
    <div class="step"><div class="dot">1</div><h3>团队与项目冻结</h3><p>复制、发布并冻结 7 人团队版本；建立 7 个独立 Agent Home。</p></div>
    <div class="step"><div class="dot">2</div><h3>6 个生成 Session</h3><p>Planner、Designer、Tester、Frontend A/B、Integration 完成 5/5 任务。</p></div>
    <div class="step"><div class="dot">3</div><h3>故障注入与复验</h3><p>注入 TypeScript 契约错误；策略 typescript-contract 修复，FAIL → PASS。</p></div>
  </div>
  <div class="grid kpis" style="margin-top:42px">
    <div class="card"><div class="label">Browser Checks</div><div class="value">4/4</div><div class="foot">Desktop + Mobile</div></div>
    <div class="card"><div class="label">Control Events</div><div class="value">36</div><div class="foot">condition · loop · subworkflow</div></div>
    <div class="card"><div class="label">Product Events</div><div class="value">50</div><div class="foot">committed and replayable</div></div>
    <div class="card"><div class="label">Total Tokens</div><div class="value">121k</div><div class="foot">29.8k in · 20.8k out</div></div>
  </div>
  <div class="card" style="margin-top:26px"><div class="label">Observed Reliability</div><div class="bar"><span style="width:100%"></span></div><div class="foot">15 tool calls · 22 recoverable retries · final terminal PASSED</div></div>
</section>

<section class="panel" data-shot="boundary">
  <div class="kicker">CAPABILITY & SECURITY BOUNDARY</div>
  <h1>初赛范围与决赛计划</h1>
  <p class="sub">系统完成度优先；未实现能力不进入当前通过结论。</p>
  <div class="grid kpis">
    <div class="card"><div class="label">LLM</div><div class="value" style="font-size:30px">已使用</div><div class="foot">规划、设计、测试、生成、修复</div></div>
    <div class="card"><div class="label">RAG</div><div class="value planned" style="font-size:30px">决赛</div><div class="foot">无检索器 / Embedding / 向量库</div></div>
    <div class="card"><div class="label">MCP</div><div class="value planned" style="font-size:30px">决赛</div><div class="foot">无实际 Server/Client 工具</div></div>
    <div class="card"><div class="label">容器隔离</div><div class="value partial" style="font-size:30px">未接入</div><div class="foot">宿主构建 · SWE-ReX 仅验证</div></div>
  </div>
  <div class="grid checks">
    <div class="card"><h3>当前安全边界</h3><div class="check"><span>Agent Shell</span><span class="pass">禁用</span></div><div class="check"><span>文件写入 / 编辑</span><span class="pass">禁用</span></div><div class="check"><span>任务写范围</span><span class="pass">src 限定</span></div><div class="check"><span>传输</span><span class="pass">loopback</span></div></div>
    <div class="card"><h3>仍需披露</h3><div class="check"><span>npm install</span><span class="partial">宿主执行</span></div><div class="check"><span>Vite build</span><span class="partial">宿主执行</span></div><div class="check"><span>Playwright</span><span class="partial">宿主执行</span></div><div class="check"><span>公网认证 / TLS</span><span class="planned">未实现</span></div></div>
    <div class="card"><h3>决赛计划</h3><div class="check"><span>RAG 知识检索</span><span class="planned">计划</span></div><div class="check"><span>MCP 外部工具</span><span class="planned">计划</span></div><div class="check"><span>压力 / 长稳</span><span class="planned">计划</span></div><div class="check"><span>容器主链路</span><span class="planned">计划</span></div></div>
  </div>
  <div class="note">当前版本适用于受控单人演示环境。公开部署前需要增加认证、TLS、子进程环境隔离、网络与资源限制，并将容器或远程隔离运行时接入主链路。</div>
</section>
</body>
</html>`

function evidenceMatrixHtml() {
  const rows = matrixRows.map(([item, implementation, status, evidence]) => {
    const cls = status === 'PASS' ? 'pass' : status === 'PLANNED' ? 'planned' : 'partial'
    return `<tr><td>${esc(item)}</td><td>${esc(implementation)}</td><td><span class="${cls}">${status}</span></td><td>${esc(evidence)}</td></tr>`
  }).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{margin:0;background:${C.bg};color:${C.ink};font-family:'Microsoft YaHei',sans-serif}
  main{padding:64px}
  .kicker{color:${C.teal};font:700 14px Consolas,monospace;letter-spacing:.1em}
  h1{margin:14px 0 8px;font-size:44px} p{color:${C.muted};font-size:18px;margin:0 0 28px}
  table{border-collapse:collapse;width:100%;table-layout:fixed;background:${C.panel}}
  th{background:${C.panel2};color:${C.teal};text-align:left;font-size:15px;padding:15px;border:1px solid ${C.border}}
  td{padding:13px 15px;border:1px solid ${C.border};vertical-align:top;font-size:14px;line-height:1.55;color:#d7e3e7}
  th:nth-child(1){width:16%} th:nth-child(2){width:38%} th:nth-child(3){width:10%} th:nth-child(4){width:36%}
  .pass{color:${C.green};font:700 13px Consolas,monospace}.planned{color:${C.amber};font:700 13px Consolas,monospace}.partial{color:${C.coral};font:700 13px Consolas,monospace}
  .foot{margin-top:22px;color:${C.muted};font:13px Consolas,monospace}
</style></head><body><main>
  <div class="kicker">REQUIREMENT → IMPLEMENTATION → EVIDENCE</div>
  <h1>Future Cup 初赛赛题证据矩阵</h1>
  <p>基线 f50c1ce2 · 状态使用 PASS / PARTIAL / PLANNED，计划能力不计为已实现。</p>
  <table><thead><tr><th>赛题要求</th><th>项目实现</th><th>状态</th><th>可核验证据</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="foot">证据位置：测试数据/ · 功能截图/ · 测试截图/ · 文案/系统报告.md</div>
</main></body></html>`
}

function evidenceMatrixMarkdown() {
  const rows = matrixRows.map(([item, implementation, status, evidence]) =>
    `| ${item} | ${implementation} | ${status} | ${evidence} |`).join('\n')
  return `# Future Cup 初赛赛题证据矩阵

| 赛题要求 | 项目实现 | 状态 | 可核验证据 |
|---|---|---|---|
${rows}

说明：

- PASS 表示当前版本已有实现和可核验证据。
- PARTIAL 表示方案已验证或部分能力存在，但尚未接入完整主链路。
- PLANNED 表示决赛或后续阶段计划，不计入初赛已实现能力。
`
}

function deliverablesReadme() {
  return `# Future Cup 初赛交付包

## 基线

- 分支：main
- 提交：f50c1ce2c6e6e08324a4addde64178ba89ba6c62
- 日期：2026-11-03

## 目录

| 目录 | 内容 |
|---|---|
| 文案/ | 方案书、系统报告、赛题证据矩阵 |
| 图表源文件/ | HTML、SVG、生成脚本 |
| 架构图/ | HTML+SVG 绘制并截图后的 PNG |
| 功能截图/ | 管理平台、生成工程和 HQ 截图 |
| 测试截图/ | 自动化测试、真实 E2E、能力边界、证据矩阵 |
| 测试数据/ | 最终验收、真实 E2E、浏览器冒烟原始 JSON |

## 建议使用

1. 先阅读“文案/初赛方案书.md”。
2. PPT 制作优先使用“架构图/”和“测试截图/”。
3. 赛题评审使用“文案/赛题证据矩阵.md”或“测试截图/04-赛题证据矩阵.png”。
4. 方案书转 PDF 时保持图片相对路径和字体设置。

## 内容统计

- 方案书：约 6000 个中文字符，19 张图片引用。
- 图表：7 张 PNG，配套 7 份 SVG 和 1 个 HTML 总览。
- 功能截图：24 张（01–12、19–24 为 2026-11-06 最新界面；13–18 保留旧版证据）。
- 测试证据截图：4 张。
- 原始测试数据：3 份 JSON。
- 文件完整性：见“文件清单.json”。

## 能力边界

- RAG、MCP、压力测试：决赛。
- 容器隔离：Docker/SWE-ReX 已验证，尚未接入主链路。
- PostgreSQL：当前最终 E2E 使用 SQLite；PostgreSQL 证据来自 M4.1。
- 当前版本面向受控演示环境，不作为安全多租户平台宣传。
`
}

async function ensureDirs() {
  for (const dir of [
    '文案',
    '图表源文件',
    '图表源文件/svg',
    '架构图',
    '功能截图',
    '测试截图',
    '测试数据',
  ]) {
    await mkdir(join(outRoot, dir), { recursive: true })
  }
}

async function copyEvidence() {
  const copies = [
    ['.artifacts/future-cup-final-test/acceptance.json', '测试数据/acceptance.json'],
    ['.artifacts/future-cup-m55-live/real-team-GJm5ZY/run-result.json', '测试数据/real-team-e2e-run-result.json'],
    ['.artifacts/future-cup-final-browser/browser-smoke.json', '测试数据/browser-smoke.json'],
    ['.artifacts/future-cup-final-test/system-report.md', '文案/系统报告.md'],
  ]
  for (const [source, target] of copies) {
    await copyFile(join(repoRoot, source), join(outRoot, target))
  }
  const acceptancePath = join(outRoot, '测试数据', 'acceptance.json')
  const acceptance = JSON.parse(await readFile(acceptancePath, 'utf8'))
  acceptance.systemReport = '../文案/系统报告.md'
  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`)

  const images = [
    ['future-cup-final-browser/projects-desktop.png', '01-项目管理.png'],
    ['future-cup-final-browser/agents-desktop.png', '02-Agent管理.png'],
    ['future-cup-final-browser/teams-desktop.png', '03-我的团队.png'],
    ['future-cup-final-browser/team-builder-desktop.png', '04-智能配队.png'],
    ['future-cup-final-browser/project-overview-desktop.png', '05-项目概览.png'],
    ['future-cup-final-browser/dag-desktop.png', '06-任务DAG.png'],
    ['future-cup-final-browser/scheduler-desktop.png', '07-调度决策.png'],
    ['future-cup-final-browser/verification-desktop.png', '08-验证报告.png'],
    ['future-cup-final-browser/repairs-desktop.png', '09-SelfLoop自愈.png'],
    ['future-cup-final-browser/events-desktop.png', '10-事件流.png'],
    ['future-cup-final-browser/delivery-desktop.png', '11-交付预览.png'],
    ['future-cup-final-browser/teams-mobile.png', '12-移动端团队.png'],
    ['future-cup-final-browser/project-overview-mobile.png', '13-移动端项目概览.png'],
    ['future-cup-final-browser/dag-mobile.png', '14-移动端DAG.png'],
    [
      'future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/desktop-overview-dashboard.png',
      '15-生成工程桌面总览.png',
    ],
    [
      'future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/desktop-users.png',
      '16-生成工程桌面用户页.png',
    ],
    [
      'future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/mobile-overview-dashboard.png',
      '17-生成工程移动总览.png',
    ],
    [
      'future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/mobile-users.png',
      '18-生成工程移动用户页.png',
    ],
    ['future-cup-final-browser/hq-desktop.png', '19-HQ实时大屏.png'],
  ]
  // 注意：01–12、19 已替换为 2026-11-06 最新界面，并手工追加 20–24
  //（其中 12、23、24 是移动端 JPG 转 PNG）；这些新图不在 .artifacts 中，
  // 重跑本脚本会用上面的旧图覆盖，需重新导入。
  for (const [source, target] of images) {
    await copyFile(join(sourceRoot, source), join(outRoot, '功能截图', target))
  }
}

async function writeDiagrams() {
  const viewerCards = diagrams.map(diagram => `
    <article>
      <div class="meta"><span>${esc(diagram.id)}</span><span>${diagram.width} × ${diagram.height}</span></div>
      <img src="svg/${diagram.id}.svg" alt="${esc(diagram.title)}">
    </article>`).join('')
  const viewer = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{margin:0;background:${C.bg};color:${C.ink};font-family:'Microsoft YaHei',sans-serif}
  header{padding:56px 64px 24px}.kicker{color:${C.teal};font:700 14px Consolas,monospace;letter-spacing:.12em}
  h1{font-size:46px;margin:14px 0 8px}p{color:${C.muted};font-size:18px;margin:0}
  main{display:grid;gap:28px;padding:32px 64px 64px}article{background:${C.panel};border:1px solid ${C.border};border-radius:8px;padding:20px}
  img{display:block;width:100%;height:auto;border-radius:6px}.meta{display:flex;justify-content:space-between;color:${C.muted};font:13px Consolas,monospace;margin-bottom:12px}
</style></head><body><header><div class="kicker">HTML + INLINE SVG DIAGRAM SOURCE</div><h1>Future Cup 系统图表源文件</h1><p>每个 SVG 都有对应的 PNG 截图，位于交付包的“架构图”目录。</p></header><main>${viewerCards}</main></body></html>`
  await writeFile(join(outRoot, '图表源文件', '架构图总览.html'), viewer)
  for (const diagram of diagrams) {
    await writeFile(join(outRoot, '图表源文件', 'svg', `${diagram.id}.svg`), `${diagram.svg}\n`)
  }
}

async function writeDocuments() {
  const proposalSource = join(sourceRoot, 'future-cup-final-test', '初赛方案书.md')
  let proposal = await readFile(proposalSource, 'utf8')
  proposal = proposal.replace(
    /```mermaid\nflowchart LR[\s\S]*?```/,
    '![系统总体架构](../架构图/01-system-architecture.png)',
  )
  proposal = proposal.replace(
    /```mermaid\nflowchart TD[\s\S]*?```/,
    '![Agent 协作与任务 DAG](../架构图/02-agent-workflow-dag.png)',
  )
  proposal = proposal.replace(
    /```mermaid\nflowchart TD[\s\S]*?```/,
    '![验证、修复与复验闭环](../架构图/04-self-loop.png)',
  )
  proposal = proposal.replaceAll('../future-cup-final-browser/projects-desktop.png', '../功能截图/01-项目管理.png')
    .replaceAll('../future-cup-final-browser/agents-desktop.png', '../功能截图/02-Agent管理.png')
    .replaceAll('../future-cup-final-browser/teams-desktop.png', '../功能截图/03-我的团队.png')
    .replaceAll('../future-cup-final-browser/team-builder-desktop.png', '../功能截图/04-智能配队.png')
    .replaceAll('../future-cup-final-browser/project-overview-desktop.png', '../功能截图/05-项目概览.png')
    .replaceAll('../future-cup-final-browser/dag-desktop.png', '../功能截图/06-任务DAG.png')
    .replaceAll('../future-cup-final-browser/scheduler-desktop.png', '../功能截图/07-调度决策.png')
    .replaceAll('../future-cup-final-browser/verification-desktop.png', '../功能截图/08-验证报告.png')
    .replaceAll('../future-cup-final-browser/repairs-desktop.png', '../功能截图/09-SelfLoop自愈.png')
    .replaceAll('../future-cup-final-browser/delivery-desktop.png', '../功能截图/11-交付预览.png')
    .replaceAll(
      '../future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/desktop-overview-dashboard.png',
      '../功能截图/15-生成工程桌面总览.png',
    )
    .replaceAll(
      '../future-cup-m55-live/real-team-GJm5ZY/workspaces/future-cup-run-13191135-61f9-407c-b67f-a764ca6e4fcd/screenshots/desktop-users.png',
      '../功能截图/16-生成工程桌面用户页.png',
    )
  proposal = proposal.replace(
    '## 附录 A：主要证据',
    `## 附录 A：补充图表

![可解释动态调度](../架构图/03-scheduling.png)

![独立验证流水线](../架构图/05-verification-pipeline.png)

![数据、事件与重连](../架构图/06-data-realtime.png)

![核心数据模型与关系](../架构图/07-database-er.png)

## 附录 B：主要证据`,
  )
  proposal = proposal.replace('## 附录 B：初赛能力边界声明', '## 附录 C：初赛能力边界声明')
  await writeFile(join(outRoot, '文案', '初赛方案书.md'), proposal)
  await writeFile(join(outRoot, '文案', '赛题证据矩阵.md'), evidenceMatrixMarkdown())
  await writeFile(join(outRoot, '赛题证据矩阵.html'), evidenceMatrixHtml())
  await writeFile(join(outRoot, '测试截图', '测试证据.html'), evidenceHtml)
  await writeFile(join(outRoot, 'README.md'), deliverablesReadme())
}

async function renderOutputs() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const diagram of diagrams) {
      const page = await browser.newPage({
        viewport: { width: diagram.width, height: diagram.height },
        deviceScaleFactor: 2,
      })
      await page.goto(pathToFileURL(join(outRoot, '图表源文件', 'svg', `${diagram.id}.svg`)).href)
      await page.screenshot({
        path: join(outRoot, '架构图', `${diagram.id}.png`),
        fullPage: false,
      })
      await page.close()
    }

    const evidencePage = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    })
    await evidencePage.goto(pathToFileURL(join(outRoot, '测试截图', '测试证据.html')).href)
    const shotMap = [
      ['summary', '01-自动化测试总览.png'],
      ['e2e', '02-真实E2E闭环.png'],
      ['boundary', '03-安全与能力边界.png'],
    ]
    for (const [name, file] of shotMap) {
      await evidencePage.locator(`[data-shot="${name}"]`).screenshot({
        path: join(outRoot, '测试截图', file),
      })
    }
    await evidencePage.close()

    const matrixPage = await browser.newPage({
      viewport: { width: 1800, height: 1200 },
      deviceScaleFactor: 2,
    })
    await matrixPage.goto(pathToFileURL(join(outRoot, '赛题证据矩阵.html')).href)
    await matrixPage.screenshot({
      path: join(outRoot, '测试截图', '04-赛题证据矩阵.png'),
      fullPage: true,
    })
    await matrixPage.close()
  } finally {
    await browser.close()
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

async function writeManifest() {
  const manifestPath = join(outRoot, '文件清单.json')
  const files = await listFiles(outRoot)
  const entries = []
  for (const file of files.sort()) {
    if (file === manifestPath) continue
    const content = await readFile(file)
    const info = await stat(file)
    entries.push({
      path: relative(outRoot, file).replaceAll('\\', '/'),
      bytes: info.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  await writeFile(manifestPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    commit: 'f50c1ce2c6e6e08324a4addde64178ba89ba6c62',
    files: entries,
  }, null, 2)}\n`)
}

await ensureDirs()
await copyEvidence()
await writeDiagrams()
await writeDocuments()
await renderOutputs()
await writeManifest()

console.log(JSON.stringify({
  output: relative(process.cwd(), outRoot).replaceAll('\\', '/'),
  diagrams: diagrams.length,
  matrixRows: matrixRows.length,
}, null, 2))
