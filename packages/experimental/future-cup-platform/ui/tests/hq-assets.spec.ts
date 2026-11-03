import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const hqRoot = resolve(import.meta.dirname, '../public/hq')

describe('HQ static asset contract', () => {
  it('keeps the PolyForm notice and loads the realtime bridge without remote fonts', () => {
    const index = readFileSync(resolve(hqRoot, 'index.html'), 'utf8')
    const license = readFileSync(resolve(hqRoot, 'LICENSE'), 'utf8')
    expect(index).toContain('Required Notice: Copyright (c) 2026 赛博老爸')
    expect(index).toContain('PolyForm-Noncommercial-1.0.0')
    expect(index).toContain('src="./hq-bridge.js"')
    expect(index).toContain('projectId')
    expect(index).toContain('animate: animateRealAction')
    expect(index).toContain('REAL_PROJECTION.departments')
    expect(index).toContain('visualOnly: true')
    expect(index).toContain('if (!VP) return null')
    expect(index).not.toContain('fonts.googleapis.com')
    expect(index).not.toContain('warmStart')
    expect(index).not.toContain('var REAL_MODE')
    expect(index).not.toContain('var PRESET')
    expect(index).not.toContain('data-act="task"')
    expect(index).not.toContain('data-act="hr"')
    expect(license).toContain('PolyForm Noncommercial License 1.0.0')
  })
})
