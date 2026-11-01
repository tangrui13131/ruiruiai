import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentDefinitionId,
  AgentRegistry,
  AgentTeamVersionId,
  AgentVersionId,
  JSON_SCHEMA_DIALECT,
  type AgentRegistryRole,
  type AgentTeamVersion,
  type CreateAgentTeamVersionInput,
  type JsonSchemaDescriptor,
  type PublishedAgent,
  type RegisterAgentVersionInput,
} from '../src/agent-registry.ts'
import {
  FUTURE_CUP_DEFAULT_TECH_STACK,
  TeamRecommenderError,
  applyProjectClarificationAnswers,
  applyTeamAdjustment,
  clarifyProjectProfile,
  createAgentTeamVersionInputFromRecommendation,
  parseTeamAdjustmentIntent,
  projectClarificationAnswerSchema,
  projectClarificationQuestionSchema,
  projectProfileCandidateSchema,
  projectProfileSchema,
  recommendAgentTeam,
  structureProjectProfile,
  summarizeAgentTeamRecommendation,
  teamAdjustmentIntentSchema,
  type ProjectProfile,
} from '../src/team-recommender.ts'

const ROLES: readonly AgentRegistryRole[] = [
  'planner',
  'ui-designer',
  'tester',
  'frontend',
  'integration',
  'verifier',
  'repair',
]

interface AgentFixtureOptions {
  readonly omittedRoles?: readonly AgentRegistryRole[]
  readonly capabilities?: Partial<Record<AgentRegistryRole, Readonly<Record<string, number>>>>
  readonly maxConcurrency?: Partial<Record<AgentRegistryRole, number>>
}

interface AgentFixture {
  readonly registry: AgentRegistry
  readonly publishedAgents: readonly PublishedAgent[]
}

interface AgentVariantOptions {
  readonly versionId?: string
  readonly definitionId?: string
  readonly versionDefinitionId?: string
  readonly capabilities?: Readonly<Record<string, number>>
  readonly maxConcurrency?: number
  readonly toolAllowlist?: readonly string[]
  readonly memoryPolicy?: PublishedAgent['version']['memoryPolicy']
  readonly outputSchema?: PublishedAgent['version']['outputSchema']
}

function capabilityForRole(role: AgentRegistryRole): string {
  switch (role) {
    case 'planner':
      return 'planning'
    case 'ui-designer':
      return 'design'
    case 'tester':
      return 'testing'
    case 'verifier':
      return 'verification'
    default:
      return role
  }
}

function outputSchema(role: AgentRegistryRole | 'shared'): JsonSchemaDescriptor {
  return {
    id: `future-cup.${role}-output`,
    version: '1.0.0',
    dialect: JSON_SCHEMA_DIALECT,
    schema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
      },
    },
  }
}

function versionInput(
  role: AgentRegistryRole,
  options: AgentFixtureOptions,
): RegisterAgentVersionInput {
  return {
    id: `${role}-1.0.0`,
    version: '1.0.0',
    role,
    model: 'deepseek-flash',
    prompt: `Own ${role} work.`,
    promptVersion: 'prompt-v1',
    capabilities: options.capabilities?.[role] ?? { [capabilityForRole(role)]: 1 },
    toolAllowlist: ['fs-read'],
    memoryPolicy: role === 'repair'
      ? { access: 'WRITE', kinds: ['failure-signature'] }
      : { access: 'READ', kinds: ['requirement'] },
    maxConcurrency: options.maxConcurrency?.[role] ?? 2,
    inputSchema: {
      id: 'future-cup.task-input',
      version: '1.0.0',
      dialect: JSON_SCHEMA_DIALECT,
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    outputSchema: outputSchema(role),
  }
}

function createAgentFixture(options: AgentFixtureOptions = {}): AgentFixture {
  const registry = new AgentRegistry()
  const omitted = new Set(options.omittedRoles ?? [])
  for (const role of ROLES) {
    if (omitted.has(role)) continue
    const definition = registry.registerDefinition({
      id: role,
      name: role,
      purpose: `Own ${role} work.`,
      discoveryTags: [capabilityForRole(role)],
    })
    const version = registry.registerVersion(definition.id, versionInput(role, options))
    registry.validate(definition.id, version.id)
    registry.publish(definition.id, version.id)
  }
  return {
    registry,
    publishedAgents: registry.discoverPublished(),
  }
}

function completeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return projectProfileSchema.parse({
    goal: 'Build an admin console.',
    pageCount: 2,
    independentModuleCount: 2,
    designComplexity: 'medium',
    testingRequired: true,
    riskLevel: 'medium',
    qualityLevel: 'standard',
    budgetPreference: 'medium',
    timePreference: 'balanced',
    moduleParallelism: 'balanced',
    techStack: ['React', 'TypeScript', 'Vite', 'Ant Design'],
    ...overrides,
  })
}

function roleInstances(
  recommendation: ReturnType<typeof recommendAgentTeam>,
  role: AgentRegistryRole,
): number {
  return recommendation.members.find(member => member.role === role)?.instanceCount ?? 0
}

function publishedAgentVariant(
  agent: PublishedAgent,
  options: AgentVariantOptions = {},
): PublishedAgent {
  const definitionId = options.definitionId ?? String(agent.definition.id)
  return {
    definition: {
      ...agent.definition,
      id: AgentDefinitionId(definitionId),
    },
    version: {
      ...agent.version,
      id: AgentVersionId(options.versionId ?? String(agent.version.id)),
      definitionId: AgentDefinitionId(options.versionDefinitionId ?? definitionId),
      capabilities: options.capabilities ?? agent.version.capabilities,
      maxConcurrency: options.maxConcurrency ?? agent.version.maxConcurrency,
      toolAllowlist: options.toolAllowlist ?? agent.version.toolAllowlist,
      memoryPolicy: options.memoryPolicy ?? agent.version.memoryPolicy,
      outputSchema: options.outputSchema ?? agent.version.outputSchema,
    },
  }
}

function teamTemplateVariant(
  template: AgentTeamVersion,
  options: {
    readonly id: string
    readonly members?: AgentTeamVersion['members']
  },
): AgentTeamVersion {
  return {
    ...template,
    id: AgentTeamVersionId(options.id),
    members: options.members ?? template.members,
  }
}

function mapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  for (const [candidate, value] of map) {
    if (candidate === key) return value
  }
  return undefined
}

function setHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  for (const candidate of set) {
    if (candidate === value) return true
  }
  return false
}

describe('Future Cup team recommender', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('structures a natural-language two-page admin requirement deterministically', () => {
    const result = structureProjectProfile({
      requirement: '请开发一个后台双页管理系统，包含用户管理和订单管理两个并行模块，使用 React、TypeScript、Vite 和 Ant Design，需要测试，质量要求高。',
      candidate: {
        budgetPreference: 'medium',
        domainEvidence: {
          audience: 'internal operators',
        },
      },
    })

    expect(result.profile.pageCount).toBe(2)
    expect(result.profile.independentModuleCount).toBe(2)
    expect(result.profile.testingRequired).toBe(true)
    expect(result.profile.qualityLevel).toBe('high')
    expect(result.profile.techStack).toEqual(['React', 'TypeScript', 'Vite', 'Ant Design'])
    expect(result.profile.domainEvidence).toEqual({ audience: 'internal operators' })
    expect(result.questions).toEqual([])
    expect(result.readyForRecommendation).toBe(true)
  })

  it('asks no more than three necessary structured questions and accepts the answers back', () => {
    const initial = structureProjectProfile({ requirement: '帮我做一个网站' })
    expect(initial.questions.map(question => question.type)).toEqual([
      'page-count',
      'module-parallelism',
      'quality-verification',
    ])
    expect(initial.readyForRecommendation).toBe(false)

    const answered = structureProjectProfile({
      requirement: '帮我做一个网站',
      candidate: initial.profile,
      answers: [
        { type: 'page-count', count: 3 },
        { type: 'module-parallelism', moduleCount: 2, parallelism: 'parallel' },
        { type: 'quality-verification', level: 'high' },
      ],
    })

    expect(answered.questions).toEqual([])
    expect(answered.readyForRecommendation).toBe(true)
    expect(answered.profile).toMatchObject({
      pageCount: 3,
      independentModuleCount: 2,
      moduleParallelism: 'parallel',
      testingRequired: true,
      qualityLevel: 'high',
      riskLevel: 'high',
    })
  })

  it('recommends two frontend instances for a two-page project', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(recommendation, 'frontend')).toBe(2)
    expect(recommendation.concurrency.estimatedParallelism).toBe(2)
    expect(recommendation.capabilityCoverage.every(coverage => coverage.satisfied)).toBe(true)
    expect(recommendation.missingCapabilities).toEqual([])
    expect(summarizeAgentTeamRecommendation(recommendation)).toContain('frontend x2')
  })

  it('keeps frontend work serial when the profile requests serial delivery', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'serial',
      }),
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(recommendation, 'frontend')).toBe(1)
    expect(recommendation.concurrency.estimatedParallelism).toBe(1)
  })

  it('uses one workload unit when optional profile counts disappear after clarification', () => {
    const fixture = createAgentFixture()
    const base = completeProfile()
    let pageReads = 0
    let moduleReads = 0
    const dynamicProfile = completeProfile(base)
    Object.defineProperty(dynamicProfile, 'pageCount', {
      configurable: true,
      get() {
        pageReads += 1
        return pageReads === 1 ? 2 : undefined
      },
    })
    Object.defineProperty(dynamicProfile, 'independentModuleCount', {
      configurable: true,
      get() {
        moduleReads += 1
        return moduleReads === 1 ? 2 : undefined
      },
    })
    vi.spyOn(projectProfileSchema, 'safeParse').mockReturnValue({
      success: true,
      data: dynamicProfile,
    } as never)
    vi.spyOn(projectProfileSchema, 'parse').mockReturnValue(dynamicProfile)

    const recommendation = recommendAgentTeam({
      profile: dynamicProfile,
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(recommendation, 'frontend')).toBe(1)
    expect(recommendation.reasons[0]).toContain('1 project work unit(s)')
  })

  it('defaults a selected member to one instance when its count snapshot is absent', () => {
    const fixture = createAgentFixture()
    vi.spyOn(Map.prototype, 'get').mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ): unknown {
      const value = mapGet(this, key)
      if (key === 'frontend' && typeof value === 'number') return undefined
      return value
    })

    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(recommendation, 'frontend')).toBe(1)
  })

  it('reports missing roles and capabilities without inventing an Agent', () => {
    const fixture = createAgentFixture({ omittedRoles: ['verifier'] })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(recommendation.members.some(member => member.role === 'verifier')).toBe(false)
    expect(recommendation.missingCapabilities).toContainEqual(expect.objectContaining({
      capability: 'verification',
      covered: 0,
      required: 1,
    }))
    expect(recommendation.risks).toContainEqual(expect.objectContaining({
      kind: 'missing-role',
      role: 'verifier',
    }))
  })

  it('reduces the number of instances for a low budget', () => {
    const fixture = createAgentFixture()
    const standard = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
      }),
      publishedAgents: fixture.publishedAgents,
    })
    const lowBudget = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
        budgetPreference: 'low',
      }),
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(standard, 'frontend')).toBeGreaterThan(roleInstances(lowBudget, 'frontend'))
    expect(lowBudget.concurrency.instanceCount).toBeLessThan(standard.concurrency.instanceCount)
    expect(lowBudget.risks).toContainEqual(expect.objectContaining({
      kind: 'budget-tradeoff',
    }))
  })

  it('adds testing and verification capacity in quality mode', () => {
    const fixture = createAgentFixture()
    const standard = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const quality = recommendAgentTeam({
      profile: completeProfile({
        qualityLevel: 'high',
        riskLevel: 'high',
      }),
      publishedAgents: fixture.publishedAgents,
    })

    expect(roleInstances(quality, 'tester')).toBeGreaterThan(roleInstances(standard, 'tester'))
    expect(roleInstances(quality, 'verifier')).toBeGreaterThan(roleInstances(standard, 'verifier'))
    expect(quality.risks).toContainEqual(expect.objectContaining({
      kind: 'quality-tradeoff',
    }))
  })

  it('applies controlled natural-language add, remove, quality, and concurrency adjustments', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
      }),
      publishedAgents: fixture.publishedAgents,
    })

    const removeIntent = parseTeamAdjustmentIntent('减少一个前端实例')
    expect(removeIntent).toEqual({ type: 'remove-role-instance', role: 'frontend' })
    const reduced = applyTeamAdjustment(recommendation, removeIntent)
    expect(roleInstances(reduced.recommendation, 'frontend')).toBe(
      roleInstances(recommendation, 'frontend') - 1,
    )

    const added = applyTeamAdjustment(reduced.recommendation, '再加一个前端 Agent')
    expect(roleInstances(added.recommendation, 'frontend')).toBe(
      roleInstances(reduced.recommendation, 'frontend') + 1,
    )

    const higherQuality = applyTeamAdjustment(recommendation, '提高质量并加强验证')
    expect(roleInstances(higherQuality.recommendation, 'tester')).toBeGreaterThan(
      roleInstances(recommendation, 'tester'),
    )
    expect(roleInstances(higherQuality.recommendation, 'verifier')).toBeGreaterThan(
      roleInstances(recommendation, 'verifier'),
    )

    const lowerConcurrency = applyTeamAdjustment(recommendation, '降低并发到 1')
    expect(lowerConcurrency.recommendation.concurrency.estimatedParallelism).toBe(1)
    expect(lowerConcurrency.changes).toContainEqual(expect.objectContaining({
      kind: 'parallelism',
      to: 1,
    }))
  })

  it('never selects draft or unpublished Agent versions', () => {
    const fixture = createAgentFixture()
    const draftDefinition = fixture.registry.registerDefinition({
      id: 'frontend-draft',
      name: 'Draft frontend',
      purpose: 'Unpublished frontend.',
      discoveryTags: ['frontend'],
    })
    const draftVersion = fixture.registry.registerVersion(
      draftDefinition.id,
      {
        ...versionInput('frontend', {
          capabilities: { frontend: { frontend: 1 } },
        }),
        id: 'frontend-draft-1.0.0',
      },
    )
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [
        { definition: draftDefinition, version: draftVersion },
        ...fixture.publishedAgents,
      ],
    })

    expect(recommendation.members.every(member => member.agentVersionId !== draftVersion.id)).toBe(true)
    expect(recommendation.members.find(member => member.role === 'frontend')?.agentVersionId)
      .toBe('frontend-1.0.0')
  })

  it('converts a structured recommendation into a Registry-valid team input', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const teamInput: CreateAgentTeamVersionInput =
      createAgentTeamVersionInputFromRecommendation(recommendation, {
        id: 'recommended-admin-team-1.0.0',
        name: 'recommended-admin-team',
        version: '1.0.0',
      })

    expect(teamInput.members).toContainEqual({
      agentVersionId: 'frontend-1.0.0',
      instanceCount: 2,
    })
    expect(() => fixture.registry.createTeamVersion(teamInput)).not.toThrow()
  })

  it('uses a compatible published team template when one is available', () => {
    const fixture = createAgentFixture()
    const base = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const template = fixture.registry.createTeamVersion(
      createAgentTeamVersionInputFromRecommendation(base, {
        id: 'admin-template-1.0.0',
        name: 'admin-template',
        version: '1.0.0',
      }),
    )
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
      teamTemplates: [template],
    })

    expect(recommendation.sourceTemplate).toEqual({
      id: template.id,
      name: template.name,
      version: template.version,
    })
  })

  it('requires clarification before recommending from an underspecified profile', () => {
    const fixture = createAgentFixture()
    const profile = projectProfileSchema.parse({ goal: 'Build a website.' })

    expect(clarifyProjectProfile(profile)).toHaveLength(3)
    expect(() => recommendAgentTeam({
      profile,
      publishedAgents: fixture.publishedAgents,
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'PROFILE_NEEDS_CLARIFICATION',
    }))
  })

  it('applies clarification answers directly and rejects unsupported adjustment language', () => {
    const profile = applyProjectClarificationAnswers(
      projectProfileSchema.parse({ goal: 'Build a website.' }),
      [
        { type: 'page-count', count: 1 },
        { type: 'module-parallelism', moduleCount: 1, parallelism: 'serial' },
        { type: 'quality-verification', level: 'basic' },
      ],
    )

    expect(profile).toMatchObject({
      pageCount: 1,
      independentModuleCount: 1,
      moduleParallelism: 'serial',
      testingRequired: false,
      qualityLevel: 'basic',
      riskLevel: 'low',
    })
    expect(() => parseTeamAdjustmentIntent('换一个更酷的主题')).toThrow(
      expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'UNSUPPORTED_ADJUSTMENT',
      }),
    )
  })

  it('validates public profile, clarification, and adjustment schemas', () => {
    expect(projectProfileSchema.safeParse({ goal: '' }).success).toBe(false)
    expect(projectProfileCandidateSchema.safeParse({ pageCount: 0 }).success).toBe(false)
    expect(projectClarificationQuestionSchema.safeParse({
      type: 'page-count',
      prompt: 'Pages?',
      minimum: 1,
      maximum: 64,
      extra: true,
    }).success).toBe(false)
    expect(projectClarificationAnswerSchema.safeParse({
      type: 'module-parallelism',
      moduleCount: 2,
      parallelism: 'immediate',
    }).success).toBe(false)
    expect(teamAdjustmentIntentSchema.safeParse({
      type: 'remove-role-instance',
      role: 'architect',
    }).success).toBe(false)
  })

  it('extracts page counts, design, verification, risk, budget, time, and technology signals', () => {
    const numeric = structureProjectProfile({
      requirement: '开发 12 个页面，3 个独立模块，简单设计，无需测试，低预算，尽快，串行开发，使用 Angular、Svelte、Next.js 和 Nuxt。',
    })
    expect(numeric.profile).toMatchObject({
      pageCount: 12,
      independentModuleCount: 3,
      designComplexity: 'low',
      testingRequired: false,
      budgetPreference: 'low',
      timePreference: 'fast',
      moduleParallelism: 'serial',
      techStack: ['Angular', 'Svelte', 'Next.js', 'Nuxt'],
    })

    expect(structureProjectProfile({ requirement: '单页工具' }).profile.pageCount).toBe(1)
    expect(structureProjectProfile({ requirement: '十页工具' }).profile.pageCount).toBe(10)
    expect(structureProjectProfile({ requirement: '二十页工具' }).profile.pageCount).toBe(20)
    expect(structureProjectProfile({ requirement: '二十三页工具' }).profile.pageCount).toBe(23)
    expect(structureProjectProfile({ requirement: '六十五页工具' }).profile.pageCount)
      .toBeUndefined()
    expect(structureProjectProfile({ requirement: '0页工具' }).profile.pageCount).toBeUndefined()
    expect(structureProjectProfile({ requirement: '64页工具' }).profile.pageCount).toBe(64)
    expect(structureProjectProfile({ requirement: '十十页工具' }).profile.pageCount).toBeUndefined()
    expect(structureProjectProfile({ requirement: '4页工具' }).profile.designComplexity).toBe('high')
  })

  it('extracts critical and low-risk profiles and defaults the controlled technology stack', () => {
    const critical = structureProjectProfile({
      requirement: '支付系统需要高可用并包含端到端验收，质量优先。',
    })
    expect(critical.profile).toMatchObject({
      testingRequired: true,
      qualityLevel: 'critical',
      riskLevel: 'critical',
      timePreference: 'quality-first',
    })
    expect(structureProjectProfile({
      requirement: '高可用系统需要测试。',
    }).profile.riskLevel).toBe('critical')

    const prototype = structureProjectProfile({
      requirement: '制作一个简单原型，不需要测试，采用 Vue 和 TypeScript，tsx 入口。',
    })
    expect(prototype.profile).toMatchObject({
      designComplexity: 'low',
      testingRequired: false,
      qualityLevel: 'basic',
      riskLevel: 'low',
      techStack: ['TypeScript', 'Vue'],
    })

    expect(structureProjectProfile({ requirement: '制作一个网站' }).profile.techStack)
      .toEqual(FUTURE_CUP_DEFAULT_TECH_STACK)
    expect(structureProjectProfile({ requirement: '写 no tests 的页面' }).profile.testingRequired)
      .toBe(false)
  })

  it('reports candidate validation errors with path and root diagnostics', () => {
    expect(() => structureProjectProfile({
      requirement: 'Build a website.',
      candidate: { pageCount: 0 },
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INVALID_PROJECT_PROFILE',
    }))

    try {
      structureProjectProfile({
        requirement: 'Build a website.',
        candidate: { pageCount: 0 },
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TeamRecommenderError)
      expect((error as TeamRecommenderError).message).toContain('pageCount:')
    }

    try {
      structureProjectProfile({
        requirement: 'Build a website.',
        candidate: null,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TeamRecommenderError)
      expect((error as TeamRecommenderError).message).toContain('<root>:')
    }
  })

  it('asks only for missing sizing details and rejects duplicate clarification answers', () => {
    const profile = projectProfileSchema.parse({
      goal: 'Build a one-module website.',
      pageCount: 1,
      independentModuleCount: 1,
      testingRequired: true,
      qualityLevel: 'standard',
      riskLevel: 'low',
      budgetPreference: 'medium',
      timePreference: 'balanced',
      techStack: ['React'],
    })
    expect(clarifyProjectProfile(profile)).toEqual([])

    const needsParallelism = projectProfileSchema.parse({
      ...profile,
      independentModuleCount: 2,
    })
    expect(clarifyProjectProfile(needsParallelism).map(question => question.type))
      .toEqual(['module-parallelism'])

    expect(() => applyProjectClarificationAnswers(profile, [
      { type: 'page-count', count: 1 },
      { type: 'page-count', count: 2 },
    ])).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'DUPLICATE_CLARIFICATION',
    }))
  })

  it('rejects internal quality and answer discriminants that bypass schema guards', () => {
    const profile = projectProfileSchema.parse({ goal: 'Build a website.' })
    vi.spyOn(projectClarificationAnswerSchema, 'parse').mockReturnValue({
      type: 'quality-verification',
      level: 'unsupported',
    } as never)
    expect(() => applyProjectClarificationAnswers(profile, [
      { type: 'page-count', count: 1 },
    ]))
      .toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'INVALID_ADJUSTMENT',
      }))

    vi.restoreAllMocks()
    vi.spyOn(projectClarificationAnswerSchema, 'parse').mockReturnValue({
      type: 'unsupported',
    } as never)
    expect(() => applyProjectClarificationAnswers(profile, [
      { type: 'page-count', count: 1 },
    ]))
      .toThrow('Unexpected team recommender value')
  })

  it('rejects invalid recommendation profiles and parallelism ceilings', () => {
    const fixture = createAgentFixture()
    expect(() => recommendAgentTeam({
      profile: { goal: '' },
      publishedAgents: fixture.publishedAgents,
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INVALID_PROJECT_PROFILE',
    }))

    for (const maximumParallelism of [0, 1.5, 65]) {
      expect(() => recommendAgentTeam({
        profile: completeProfile(),
        publishedAgents: fixture.publishedAgents,
        maximumParallelism,
      })).toThrow()
    }
  })

  it('returns explicit empty policies and fallbacks when no Agent is published', () => {
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [],
    })

    expect(recommendation.members).toEqual([])
    expect(recommendation.inputSchema.id).toBe('future-cup.team-input')
    expect(recommendation.toolPolicy).toEqual({
      allowedTools: [],
      requiredTools: [],
    })
    expect(recommendation.memoryPolicy).toEqual({
      allowedAccess: 'NONE',
      requiredAccess: 'NONE',
      allowedKinds: [],
      requiredKinds: [],
    })
    expect(recommendation.concurrency).toMatchObject({
      instanceCount: 0,
      aggregateCapacity: 0,
      estimatedParallelism: 1,
      requiredConcurrency: 1,
    })
    expect(recommendation.missingCapabilities).toHaveLength(ROLES.length)
    expect(summarizeAgentTeamRecommendation(recommendation)).toContain(
      'Recommended team: no published Agents.',
    )
  })

  it('reports an insufficient capability separately from a missing role', () => {
    const fixture = createAgentFixture()
    const frontend = fixture.publishedAgents.find(agent => agent.version.role === 'frontend')
    expect(frontend).toBeDefined()
    const weakFrontend = publishedAgentVariant(frontend as PublishedAgent, {
      versionId: 'frontend-weak-1.0.0',
      capabilities: { frontend: 0.5 },
    })
    const recommendation = recommendAgentTeam({
      profile: completeProfile({ budgetPreference: 'low' }),
      publishedAgents: [
        ...fixture.publishedAgents.filter(agent => agent.version.role !== 'frontend'),
        weakFrontend,
      ],
    })

    expect(recommendation.missingCapabilities).toContainEqual({
      capability: 'frontend',
      required: 1,
      covered: 0.5,
      reason: 'insufficient-capability',
    })
    expect(() => createAgentTeamVersionInputFromRecommendation(recommendation))
      .toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'INCOMPLETE_TEAM',
      }))
  })

  it('derives shared tools, memory requirements, and unique output contracts', () => {
    const fixture = createAgentFixture()
    const planner = fixture.publishedAgents.find(agent => agent.version.role === 'planner')
    expect(planner).toBeDefined()
    const sharedOutput = outputSchema('shared')
    const agents = fixture.publishedAgents.map(agent => publishedAgentVariant(agent, {
      toolAllowlist: agent.version.role === 'planner'
        ? ['z-tool', 'fs-read']
        : ['a-tool', 'fs-read'],
      outputSchema: sharedOutput,
    }))
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: agents,
    })

    expect(recommendation.toolPolicy).toEqual({
      allowedTools: ['a-tool', 'fs-read', 'z-tool'],
      requiredTools: ['fs-read'],
    })
    expect(recommendation.memoryPolicy).toMatchObject({
      allowedAccess: 'WRITE',
      requiredAccess: 'READ',
    })
    expect(recommendation.requiredOutputSchemas).toEqual([sharedOutput])
  })

  it('falls back to no shared memory when every selected Agent has memory disabled', () => {
    const fixture = createAgentFixture()
    const agents = fixture.publishedAgents.map(agent => publishedAgentVariant(agent, {
      memoryPolicy: { access: 'NONE', kinds: [] },
    }))
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: agents,
    })

    expect(recommendation.memoryPolicy).toEqual({
      allowedAccess: 'NONE',
      requiredAccess: 'NONE',
      allowedKinds: [],
      requiredKinds: [],
    })
  })

  it('uses the first selected input contract when no planner is published', () => {
    const fixture = createAgentFixture({ omittedRoles: ['planner'] })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(recommendation.members[0]?.role).toBe('ui-designer')
    expect(recommendation.inputSchema).toBe(recommendation.members[0]?.inputSchema)
    expect(recommendation.missingCapabilities).toContainEqual(expect.objectContaining({
      capability: 'planning',
      reason: 'missing-role',
    }))
  })

  it('reports unsupported technology and concurrency tradeoffs', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
        techStack: ['Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt'],
      }),
      publishedAgents: fixture.publishedAgents,
      maximumParallelism: 2,
    })

    expect(recommendation.risks).toContainEqual(expect.objectContaining({
      kind: 'concurrency-limit',
      requested: 3,
      applied: 2,
    }))
    expect(recommendation.risks.filter(risk => risk.kind === 'unsupported-tech-stack'))
      .toHaveLength(5)
  })

  it('allows an omitted technology list without inventing an unsupported-stack risk', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({ techStack: undefined }),
      publishedAgents: fixture.publishedAgents,
    })

    expect(recommendation.risks.some(risk => risk.kind === 'unsupported-tech-stack')).toBe(false)
  })

  it('rejects catalog entries whose version belongs to another definition', () => {
    const fixture = createAgentFixture()
    const agent = fixture.publishedAgents[0]
    expect(agent).toBeDefined()
    const mismatched = publishedAgentVariant(agent as PublishedAgent, {
      definitionId: 'definition-a',
      versionDefinitionId: 'definition-b',
    })

    expect(() => recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [mismatched],
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INVALID_PUBLISHED_AGENT',
    }))
  })

  it('rejects a published catalog that repeats one version identity', () => {
    const fixture = createAgentFixture()
    const duplicate = fixture.publishedAgents[0]
    expect(duplicate).toBeDefined()

    expect(() => recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [duplicate as PublishedAgent, duplicate as PublishedAgent],
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INVALID_PUBLISHED_AGENT',
    }))
  })

  it('selects the strongest Agent with stable capability, capacity, and identity ordering', () => {
    const fixture = createAgentFixture()
    const frontend = fixture.publishedAgents.find(agent => agent.version.role === 'frontend')
    expect(frontend).toBeDefined()
    const base = frontend as PublishedAgent
    const variants = [
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-0',
        capabilities: { frontend: 0.5 },
      }),
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-1',
        capabilities: { frontend: 1 },
      }),
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-2',
        capabilities: { frontend: 1, bonus: 1 },
      }),
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-3',
        capabilities: { frontend: 1, bonus: 1 },
        maxConcurrency: 3,
      }),
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-z',
        capabilities: { frontend: 1, bonus: 1 },
        maxConcurrency: 3,
      }),
      publishedAgentVariant(base, {
        versionId: 'compare-frontend-a',
        capabilities: { frontend: 1, bonus: 1 },
        maxConcurrency: 3,
      }),
    ]
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [
        ...fixture.publishedAgents.filter(agent => agent.version.role !== 'frontend'),
        ...variants,
      ],
    })

    expect(recommendation.members.find(member => member.role === 'frontend')?.agentVersionId)
      .toBe('compare-frontend-3')
  })

  it('uses definition identity as the final deterministic Agent tiebreaker', () => {
    const fixture = createAgentFixture()
    const frontend = fixture.publishedAgents.find(agent => agent.version.role === 'frontend')
    expect(frontend).toBeDefined()
    const base = frontend as PublishedAgent
    const tiedVersionId = 'frontend-tied-version'
    const tiedAgents = [
      publishedAgentVariant(base, {
        definitionId: 'frontend-z-definition',
        versionId: tiedVersionId,
      }),
      publishedAgentVariant(base, {
        definitionId: 'frontend-a-definition',
        versionId: tiedVersionId,
      }),
    ]
    vi.spyOn(Set.prototype, 'has').mockImplementation(function (
      this: Set<unknown>,
      value: unknown,
    ): boolean {
      if (value === tiedVersionId) return false
      return setHas(this, value)
    })

    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [
        ...fixture.publishedAgents.filter(agent => agent.version.role !== 'frontend'),
        ...tiedAgents,
      ],
    })

    expect(recommendation.members.find(member => member.role === 'frontend')?.definitionId)
      .toBe('frontend-a-definition')
  })

  it('keeps the empty-tool fallback explicit for malformed typed catalogs', () => {
    const fixture = createAgentFixture()
    const planner = fixture.publishedAgents.find(agent => agent.version.role === 'planner')
    expect(planner).toBeDefined()
    const malformedPlanner: PublishedAgent = {
      definition: (planner as PublishedAgent).definition,
      version: {
        ...(planner as PublishedAgent).version,
        toolAllowlist: undefined as never,
      },
    }
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [malformedPlanner],
    })

    expect(recommendation.toolPolicy.allowedTools).toEqual([undefined])
  })

  it('falls back safely when a capability value changes between discovery and weighting', () => {
    const fixture = createAgentFixture()
    const frontend = fixture.publishedAgents.find(agent => agent.version.role === 'frontend')
    expect(frontend).toBeDefined()
    let reads = 0
    const capabilities = Object.defineProperty({}, 'frontend', {
      enumerable: true,
      get() {
        reads += 1
        return reads === 1 ? 1 : undefined
      },
    }) as Readonly<Record<string, number>>
    const volatileFrontend = publishedAgentVariant(frontend as PublishedAgent, {
      versionId: 'frontend-volatile',
      capabilities,
    })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: [
        ...fixture.publishedAgents.filter(agent => agent.version.role !== 'frontend'),
        volatileFrontend,
      ],
    })

    expect(recommendation.missingCapabilities).toContainEqual({
      capability: 'frontend',
      required: 1,
      covered: 0,
      reason: 'insufficient-capability',
    })
  })

  it('skips stale, mismatched, duplicate-role, and incomplete templates in stable order', () => {
    const fixture = createAgentFixture()
    const base = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const template = fixture.registry.createTeamVersion(
      createAgentTeamVersionInputFromRecommendation(base, {
        id: 'template-source-1.0.0',
        name: 'template-source',
        version: '1.0.0',
      }),
    )
    const firstMember = template.members[0]
    expect(firstMember).toBeDefined()
    const stale = teamTemplateVariant(template, {
      id: '000-stale',
      members: [{
        ...(firstMember as AgentTeamVersion['members'][number]),
        version: {
          ...(firstMember as AgentTeamVersion['members'][number]).version,
          id: AgentVersionId('missing-live-version'),
        },
      }, ...template.members.slice(1)],
    })
    const mismatched = teamTemplateVariant(template, {
      id: '001-mismatched',
      members: [{
        ...(firstMember as AgentTeamVersion['members'][number]),
        definition: {
          ...(firstMember as AgentTeamVersion['members'][number]).definition,
          id: AgentDefinitionId('other-definition'),
        },
      }, ...template.members.slice(1)],
    })
    const duplicateRole = teamTemplateVariant(template, {
      id: '002-duplicate-role',
      members: [...template.members, firstMember as AgentTeamVersion['members'][number]],
    })
    const incomplete = teamTemplateVariant(template, {
      id: '003-incomplete',
      members: template.members.slice(0, -1),
    })
    const validA = teamTemplateVariant(template, { id: '999-valid-a' })
    const validB = teamTemplateVariant(template, { id: '999-valid-b' })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
      teamTemplates: [
        validB,
        incomplete,
        duplicateRole,
        mismatched,
        stale,
        validA,
      ],
    })

    expect(recommendation.sourceTemplate?.id).toBe(AgentTeamVersionId('999-valid-a'))
  })

  it('parses every controlled adjustment family and leaves ambiguous language unsupported', () => {
    expect(parseTeamAdjustmentIntent('Remove one planner')).toEqual({
      type: 'remove-role-instance',
      role: 'planner',
    })
    expect(parseTeamAdjustmentIntent('Add a repair Agent')).toEqual({
      type: 'add-role-instance',
      role: 'repair',
    })
    expect(parseTeamAdjustmentIntent('Reduce concurrency')).toEqual({
      type: 'reduce-concurrency',
    })
    expect(parseTeamAdjustmentIntent('Reduce scale')).toEqual({ type: 'reduce-scale' })
    expect(parseTeamAdjustmentIntent('Reduce budget')).toEqual({ type: 'reduce-scale' })
    expect(parseTeamAdjustmentIntent('Increase quality')).toEqual({ type: 'raise-quality' })
    expect(() => parseTeamAdjustmentIntent('Make it colorful')).toThrow(
      expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'UNSUPPORTED_ADJUSTMENT',
      }),
    )
  })

  it('rejects adjustments for roles missing from the recommendation', () => {
    const fixture = createAgentFixture({ omittedRoles: ['tester', 'verifier'] })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(() => applyTeamAdjustment(recommendation, {
      type: 'add-role-instance',
      role: 'tester',
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INCOMPLETE_TEAM',
    }))
    expect(() => applyTeamAdjustment(recommendation, {
      type: 'remove-role-instance',
      role: 'verifier',
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INCOMPLETE_TEAM',
    }))
  })

  it('preserves the valid role floor and enforces the instance ceiling', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const atFloor = applyTeamAdjustment(recommendation, {
      type: 'remove-role-instance',
      role: 'repair',
    })
    expect(atFloor.changes).toEqual([])
    expect(atFloor.explanation).toContain('valid floor')

    const atCeiling = {
      ...recommendation,
      members: recommendation.members.map(member => member.role === 'frontend'
        ? { ...member, instanceCount: 100 }
        : member),
    }
    expect(() => applyTeamAdjustment(atCeiling, {
      type: 'add-role-instance',
      role: 'frontend',
    })).toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
      code: 'INSTANCE_LIMIT',
    }))
  })

  it('raises quality through basic, high, critical, and unspecified profiles', () => {
    const fixture = createAgentFixture()
    const basicRecommendation = recommendAgentTeam({
      profile: completeProfile({
        testingRequired: false,
        qualityLevel: 'basic',
        riskLevel: 'low',
      }),
      publishedAgents: fixture.publishedAgents,
    })
    const high = applyTeamAdjustment(basicRecommendation, { type: 'raise-quality' })
    expect(high.recommendation.profile).toMatchObject({
      testingRequired: true,
      qualityLevel: 'high',
      riskLevel: 'high',
    })

    const critical = applyTeamAdjustment(high.recommendation, { type: 'raise-quality' })
    expect(critical.recommendation.profile).toMatchObject({
      qualityLevel: 'critical',
      riskLevel: 'critical',
    })
    const stillCritical = applyTeamAdjustment(critical.recommendation, {
      type: 'raise-quality',
    })
    expect(stillCritical.recommendation.profile.qualityLevel).toBe('critical')

    const unspecifiedProfile = projectProfileSchema.parse({
      ...completeProfile(),
      qualityLevel: undefined,
      riskLevel: undefined,
      testingRequired: undefined,
    })
    const unspecified = {
      ...basicRecommendation,
      profile: unspecifiedProfile,
    }
    expect(applyTeamAdjustment(unspecified, { type: 'raise-quality' })
      .recommendation.profile.qualityLevel).toBe('high')
  })

  it('uses the default concurrency decrement and reports a valid no-op', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
      }),
      publishedAgents: fixture.publishedAgents,
    })
    const defaultDecrement = applyTeamAdjustment(recommendation, {
      type: 'reduce-concurrency',
    })
    expect(defaultDecrement.recommendation.concurrency.estimatedParallelism).toBe(2)
    expect(defaultDecrement.changes).toContainEqual({
      kind: 'parallelism',
      from: 3,
      to: 2,
    })

    const higherThanEstimated = applyTeamAdjustment(recommendation, {
      type: 'reduce-concurrency',
      maximum: 5,
    })
    expect(higherThanEstimated.changes).toEqual([])
    expect(higherThanEstimated.recommendation.concurrency.estimatedParallelism).toBe(3)

    const atCeiling = applyTeamAdjustment(defaultDecrement.recommendation, {
      type: 'reduce-concurrency',
      maximum: 2,
    })
    expect(atCeiling.changes).toEqual([])
    expect(atCeiling.explanation).toContain('valid floor')
  })

  it('reduces one scalable role at a time and stops at the floor', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
      }),
      publishedAgents: fixture.publishedAgents,
    })

    const once = applyTeamAdjustment(recommendation, { type: 'reduce-scale' })
    expect(roleInstances(once.recommendation, 'frontend')).toBe(2)
    const twice = applyTeamAdjustment(once.recommendation, { type: 'reduce-scale' })
    expect(roleInstances(twice.recommendation, 'frontend')).toBe(1)
    const floored = applyTeamAdjustment(twice.recommendation, { type: 'reduce-scale' })
    expect(floored.changes).toEqual([])
    expect(floored.explanation).toContain('valid floor')
  })

  it('handles missing scalable roles as an unchanged valid floor', () => {
    const fixture = createAgentFixture({ omittedRoles: ['tester', 'verifier', 'repair'] })
    const recommendation = recommendAgentTeam({
      profile: completeProfile({ budgetPreference: 'low' }),
      publishedAgents: fixture.publishedAgents,
    })
    const adjusted = applyTeamAdjustment(recommendation, { type: 'reduce-scale' })

    expect(adjusted.changes).toEqual([])
    expect(adjusted.explanation).toContain('valid floor')
  })

  it('rejects an inconsistent scalable-role count snapshot', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile({
        pageCount: 4,
        independentModuleCount: 4,
        moduleParallelism: 'parallel',
      }),
      publishedAgents: fixture.publishedAgents,
    })
    let frontendReads = 0
    vi.spyOn(Map.prototype, 'get').mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ): unknown {
      if (key === 'frontend') {
        frontendReads += 1
        if (frontendReads === 1) return 2
        if (frontendReads === 2) return undefined
      }
      return mapGet(this, key)
    })

    expect(() => applyTeamAdjustment(recommendation, { type: 'reduce-scale' }))
      .toThrow(expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'INCOMPLETE_TEAM',
      }))
  })

  it('falls back to one work unit when optional workload counts are absent', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const profileWithoutCounts = projectProfileSchema.parse({
      ...recommendation.profile,
      pageCount: undefined,
      independentModuleCount: undefined,
    })
    const adjusted = applyTeamAdjustment({
      ...recommendation,
      profile: profileWithoutCounts,
      members: recommendation.members.map(member => member.role === 'frontend'
        ? { ...member, instanceCount: 1 }
        : member),
    }, {
      type: 'remove-role-instance',
      role: 'repair',
    })

    expect(adjusted.recommendation.concurrency.estimatedParallelism).toBe(1)
    expect(adjusted.recommendation.reasons[0]).toContain('1 project work unit(s)')
  })

  it('rejects unknown parsed adjustment discriminants defensively', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    vi.spyOn(teamAdjustmentIntentSchema, 'parse').mockReturnValue({
      type: 'unsupported',
    } as never)

    expect(() => applyTeamAdjustment(recommendation, {
      type: 'remove-scale',
    } as never)).toThrow('Unexpected team recommender value')
  })

  it('rejects an unknown quality discriminant before rebuilding the team', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const malformed = {
      ...recommendation,
      profile: {
        ...recommendation.profile,
        qualityLevel: 'unsupported',
      } as never,
    }

    expect(() => applyTeamAdjustment(malformed, { type: 'raise-quality' }))
      .toThrow('Unexpected team recommender value')
  })

  it('rejects incomplete teams before conversion and fills every default metadata field', () => {
    const fixture = createAgentFixture({ omittedRoles: ['repair'] })
    const incomplete = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    expect(() => createAgentTeamVersionInputFromRecommendation(incomplete)).toThrow(
      expect.objectContaining<Partial<TeamRecommenderError>>({
        code: 'INCOMPLETE_TEAM',
      }),
    )

    const completeFixture = createAgentFixture()
    const complete = recommendAgentTeam({
      profile: completeProfile({ goal: 'Build the default team.' }),
      publishedAgents: completeFixture.publishedAgents,
    })
    expect(createAgentTeamVersionInputFromRecommendation(complete)).toMatchObject({
      name: 'future-cup-recommended-team',
      version: '1.0.0',
      purpose: 'Build the default team.',
    })
    expect(createAgentTeamVersionInputFromRecommendation(complete, {
      purpose: 'Explicit purpose',
    })).toMatchObject({
      name: 'future-cup-recommended-team',
      version: '1.0.0',
      purpose: 'Explicit purpose',
    })
  })

  it('rejects invalid conversion metadata through the Registry schema', () => {
    const fixture = createAgentFixture()
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })

    expect(() => createAgentTeamVersionInputFromRecommendation(recommendation, {
      id: '',
    })).toThrow()
  })

  it('summarizes available members and every missing capability deterministically', () => {
    const fixture = createAgentFixture({ omittedRoles: ['verifier', 'repair'] })
    const recommendation = recommendAgentTeam({
      profile: completeProfile(),
      publishedAgents: fixture.publishedAgents,
    })
    const summary = summarizeAgentTeamRecommendation(recommendation)

    expect(summary).toContain('planner x1')
    expect(summary).toContain('frontend x2')
    expect(summary).toContain('Missing capabilities: verification, repair.')
  })

})
