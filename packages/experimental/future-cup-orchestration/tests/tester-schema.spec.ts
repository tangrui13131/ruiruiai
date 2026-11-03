import { describe, expect, it } from 'vitest'
import { testerOutputSchema } from '../src/schemas.ts'
import type { TesterOutput } from '../src/types.ts'

const valid: TesterOutput = {
  summary: 'Two-page navigation',
  pages: [
    {
      pageId: 'home',
      route: '/',
      navigationLabel: '首页',
      requiredText: ['欢迎', '查看功能特性'],
    },
    {
      pageId: 'features',
      route: '/features',
      navigationLabel: '功能特性',
      requiredText: ['功能特性'],
    },
  ],
  interactions: [
    { fromRoute: '/', clickText: '功能特性', expectedRoute: '/features', expectedText: '功能特性' },
    { fromRoute: '/', clickText: '查看功能特性', expectedRoute: '/features', expectedText: '功能特性' },
  ],
}

describe('tester output schema', () => {
  it('accepts destination navigation labels and source-page body labels', () => {
    expect(testerOutputSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an invented click label that exists on neither page contract', () => {
    const invalid = {
      ...valid,
      interactions: [
        valid.interactions[0]!,
        {
          fromRoute: '/',
          clickText: '了解功能特性',
          expectedRoute: '/features',
          expectedText: '功能特性',
        },
      ],
    }

    const parsed = testerOutputSchema.safeParse(invalid)

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      message: 'Tester clickText must be a source-page requiredText value or the destination navigationLabel',
      path: ['interactions', 1, 'clickText'],
    }))
  })
})
