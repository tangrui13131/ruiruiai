import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('team builder application route', () => {
  it('opens the novice team builder with its navigation entry', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    window.location.hash = '#/team-builder'
    render(<App />)

    expect(await screen.findByRole('heading', { name: '智能配队' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '智能配队' })).toBeTruthy()
  })
})
