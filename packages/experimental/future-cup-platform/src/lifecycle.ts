/** Structured cleanup for the Future Cup platform plugin. */

/** One resource that participates in platform shutdown. */
export interface FutureCupCloseable {
  /** Release the resource. */
  close(): void | Promise<void>
}

/** Resources owned by one Future Cup plugin activation. */
export interface FutureCupLifecycleResources {
  /** Launcher that may retain Agent runtimes and settlement work. */
  readonly launcher?: FutureCupCloseable | undefined
  /** Server that owns Fastify, Socket.IO, Outbox, and the platform store. */
  readonly server?: FutureCupCloseable | undefined
  /** Store used only when no server was created. */
  readonly store?: FutureCupCloseable | undefined
}

/**
 * Close every created resource even when an earlier close fails.
 * The server owns the store; direct store cleanup runs only when server creation never completed.
 * @param resources - resources created by one plugin activation.
 * @param primaryError - initialization failure to retain as the first aggregate member.
 */
export async function closeFutureCupResources(
  resources: FutureCupLifecycleResources,
  primaryError?: unknown,
): Promise<void> {
  const errors: unknown[] = []
  if (primaryError !== undefined) errors.push(primaryError)
  if (resources.launcher !== undefined) {
    try {
      await resources.launcher.close()
    } catch (error: unknown) {
      errors.push(error)
    }
  }
  if (resources.server !== undefined) {
    try {
      await resources.server.close()
    } catch (error: unknown) {
      errors.push(error)
    }
  } else if (resources.store !== undefined) {
    try {
      await resources.store.close()
    } catch (error: unknown) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Future Cup platform lifecycle cleanup failed')
  }
}
