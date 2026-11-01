import type { TeamRecommendationPlanView } from '../src/api/contracts.ts'

export const teamProfile: TeamRecommendationPlanView['profile'] = {
  goal: 'Build an operations dashboard with dashboard and users pages',
  pageCount: 2,
  independentModuleCount: 2,
  designComplexity: 'medium',
  testingRequired: true,
  riskLevel: 'medium',
  qualityLevel: 'high',
  budgetPreference: 'medium',
  timePreference: 'balanced',
  moduleParallelism: 'balanced',
  techStack: ['React', 'TypeScript', 'Vite', 'Ant Design'],
}

const schema = {
  id: 'future-cup.team-input',
  version: '1.0.0',
  dialect: 'https://json-schema.org/draft/2020-12/schema',
  schema: { type: 'object' },
}

export function teamRecommendationPlan(): TeamRecommendationPlanView {
  return {
    profile: teamProfile,
    questions: [],
    readyForRecommendation: true,
    adjustments: [],
    recommendation: {
      profile: teamProfile,
      members: [{
        role: 'frontend',
        name: 'Frontend Agent',
        definitionId: 'frontend',
        agentVersionId: 'frontend-1.0.0',
        definitionVersion: '1.0.0',
        instanceCount: 2,
        capabilities: { frontend: 1 },
        maxConcurrency: 1,
        toolAllowlist: ['fs-read'],
        memoryPolicy: {
          access: 'READ',
          kinds: ['design-decision', 'accepted-artifact-summary'],
        },
        inputSchema: schema,
        outputSchema: schema,
      }],
      capabilityCoverage: [{
        capability: 'frontend',
        required: 1,
        covered: 1,
        satisfied: true,
        contributors: [{
          role: 'frontend',
          agentVersionId: 'frontend-1.0.0',
          weight: 1,
          instances: 2,
        }],
      }],
      missingCapabilities: [],
      concurrency: {
        instanceCount: 2,
        aggregateCapacity: 2,
        estimatedParallelism: 2,
        requiredConcurrency: 2,
        maximumParallelism: 4,
      },
      toolPolicy: {
        allowedTools: ['fs-read'],
        requiredTools: ['fs-read'],
      },
      memoryPolicy: {
        allowedAccess: 'READ',
        requiredAccess: 'READ',
        allowedKinds: ['design-decision', 'accepted-artifact-summary'],
        requiredKinds: ['design-decision'],
      },
      inputSchema: schema,
      requiredOutputSchemas: [schema],
      reasons: ['Two independent pages can use parallel frontend instances.'],
      risks: [],
      sourceTemplate: {
        id: 'future-cup-default-team-1.0.0',
        name: 'future-cup-default-team',
        version: '1.0.0',
      },
    },
  }
}
