import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/locale/LocaleProvider.tsx'
import { AgentsPage } from '../src/pages/AgentsPage.tsx'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SAMPLE_TEMPLATES = [
  {
    role: 'frontend',
    defaultName: 'Frontend Agent',
    defaultPurpose: 'Implement bounded React pages within declared write scopes.',
    defaultTags: ['frontend'],
    defaultModel: 'deepseek-flash',
    defaultPrompt: 'Default frontend prompt instructions.',
    defaultPromptVersion: 'm5.1-v1',
    defaultCapabilities: { frontend: 1 },
    defaultToolAllowlist: ['fs-read'],
    defaultMemoryPolicy: { access: 'READ', kinds: ['design-decision'] },
    defaultMaxConcurrency: 1,
  },
]

const SAMPLE_DEFINITIONS = [
  {
    id: 'frontend',
    name: 'Frontend Agent',
    purpose: 'Implement bounded React pages within declared write scopes.',
    discoveryTags: ['frontend'],
    status: 'PUBLISHED',
    builtin: true,
    usageCount: 2,
    versions: [
      {
        id: 'frontend-1.0.0',
        version: '1.0.0',
        role: 'frontend',
        model: 'deepseek-flash',
        prompt: 'Default frontend prompt instructions.',
        capabilities: { frontend: 1 },
        toolAllowlist: ['fs-read'],
        memoryPolicy: { access: 'READ', kinds: ['design-decision'] },
        maxConcurrency: 1,
        status: 'PUBLISHED',
      },
    ],
  },
  {
    id: 'custom-frontend-pro',
    name: '可视化前端专家',
    purpose: '专注数据可视化看板页面实现',
    discoveryTags: ['frontend', 'chart'],
    status: 'PUBLISHED',
    builtin: false,
    usageCount: 0,
    versions: [
      {
        id: 'custom-frontend-pro@1.0.0',
        version: '1.0.0',
        role: 'frontend',
        model: 'deepseek-flash',
        prompt: '专注于图表与响应式看板组件。',
        capabilities: { frontend: 1 },
        toolAllowlist: ['fs-read'],
        memoryPolicy: { access: 'READ', kinds: ['design-decision'] },
        maxConcurrency: 2,
        status: 'PUBLISHED',
      },
    ],
  },
]

describe('AgentsPage', () => {
  it('lists built-in and custom Agents, clones an Agent, and deletes an unused custom Agent', async () => {
    const definitions = [...SAMPLE_DEFINITIONS]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/agent-role-templates') {
        return jsonResponse(SAMPLE_TEMPLATES)
      }
      if (url === '/api/v1/agent-definitions' && method === 'GET') {
        return jsonResponse(definitions)
      }
      if (url === '/api/v1/agent-definitions' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          name: string
          purpose: string
          discoveryTags: string[]
        }
        const created = {
          id: 'agent-cloned',
          name: body.name,
          purpose: body.purpose,
          discoveryTags: body.discoveryTags,
          status: 'PUBLISHED',
          builtin: false,
          usageCount: 0,
          versions: [],
        }
        definitions.push(created)
        return jsonResponse(created, 201)
      }
      if (url === '/api/v1/agent-definitions/agent-cloned/versions' && method === 'POST') {
        return jsonResponse({
          id: 'agent-cloned@1.0.0',
          version: '1.0.0',
          role: 'frontend',
          model: 'deepseek-flash',
          capabilities: { frontend: 1 },
          toolAllowlist: ['fs-read'],
          status: 'PUBLISHED',
        }, 201)
      }
      if (url === '/api/v1/agent-definitions/custom-frontend-pro' && method === 'DELETE') {
        const idx = definitions.findIndex(item => item.id === 'custom-frontend-pro')
        if (idx >= 0) definitions.splice(idx, 1)
        return jsonResponse({ deleted: true })
      }
      return jsonResponse({ code: 'NOT_FOUND', message: url }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <LocaleProvider>
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      </LocaleProvider>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('Frontend Agent').length).toBeGreaterThan(0)
      expect(screen.getByText('可视化前端专家')).toBeTruthy()
    })

    // Built-in delete button is disabled, custom unused delete button is enabled
    const deleteBuiltinBtn = screen.getByLabelText('删除 Agent Frontend Agent') as HTMLButtonElement
    expect(deleteBuiltinBtn.disabled).toBe(true)

    const deleteCustomBtn = screen.getByLabelText('删除 Agent 可视化前端专家') as HTMLButtonElement
    expect(deleteCustomBtn.disabled).toBe(false)
    fireEvent.click(deleteCustomBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/agent-definitions/custom-frontend-pro',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    // Clone built-in Frontend Agent into a custom Agent
    fireEvent.click(screen.getByLabelText('克隆为新 Agent Frontend Agent'))
    await waitFor(() => {
      expect(screen.getByDisplayValue('Frontend Agent Pro')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /确\s*认/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/agent-definitions/agent-cloned/versions',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
