import { describe, expect, it } from 'vitest'
import { closeFutureCupResources } from '../src/lifecycle.ts'

function closeable(
  name: string,
  calls: string[],
  failure?: Error,
): { close(): Promise<void> } {
  return {
    async close() {
      calls.push(name)
      if (failure !== undefined) throw failure
    },
  }
}

describe('Future Cup lifecycle cleanup', () => {
  it('closes the server after launcher failure and preserves both errors', async () => {
    const calls: string[] = []
    const launcherError = new Error('launcher close failed')
    const serverError = new Error('server close failed')
    let caught: unknown
    try {
      await closeFutureCupResources({
        launcher: closeable('launcher', calls, launcherError),
        server: closeable('server', calls, serverError),
        store: closeable('store', calls),
      })
    } catch (error: unknown) {
      caught = error
    }
    expect(calls).toEqual(['launcher', 'server'])
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([launcherError, serverError])
  })

  it('closes the store directly when initialization never created a server', async () => {
    const calls: string[] = []
    const primary = new Error('launcher construction failed')
    const launcherError = new Error('partial launcher close failed')
    let caught: unknown
    try {
      await closeFutureCupResources({
        launcher: closeable('launcher', calls, launcherError),
        store: closeable('store', calls),
      }, primary)
    } catch (error: unknown) {
      caught = error
    }
    expect(calls).toEqual(['launcher', 'store'])
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([primary, launcherError])
  })

  it('closes launcher and server in order without touching the server-owned store', async () => {
    const calls: string[] = []
    await closeFutureCupResources({
      launcher: closeable('launcher', calls),
      server: closeable('server', calls),
      store: closeable('store', calls),
    })
    expect(calls).toEqual(['launcher', 'server'])
  })
})
