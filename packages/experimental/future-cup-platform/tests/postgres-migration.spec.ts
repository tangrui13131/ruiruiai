import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  import.meta.dirname,
  '..',
  'prisma',
  'migrations',
  '20261102130000_add_team_library',
  'migration.sql',
)

describe('team library PostgreSQL migration', () => {
  it('expands legacy members from spec_json instead of hardcoded aggregate columns', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('jsonb_array_elements(tv."spec_json" -> \'members\')')
    expect(sql).toContain('ROW_NUMBER() OVER (')
    expect(sql).toContain('CASE "role"')
    expect(sql).toContain('"agent_definition_version_id" || \':instance-\'')
    expect(sql).toContain('GROUP BY "name"')
    expect(sql).toContain('MIN("id")')
    expect(sql).not.toContain('member."member_id" || \':instance-\'')
    expect(sql).not.toMatch(/SELECT\s+member\."member_id",\s*'planning',\s*expanded\."instance_number"/)
    expect(sql).not.toMatch(/'legacy-team:'\s*\|\|\s*"id"/)
  })
})
