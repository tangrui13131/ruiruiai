import { PostgresPlatformStore } from '../../src/postgres-store.ts'

const [resourceId, projectId, ownerId] = process.argv.slice(2)
const url = process.env.FUTURE_CUP_POSTGRES_URL
if (resourceId === undefined || projectId === undefined || ownerId === undefined || url === undefined) {
  throw new Error('lease contender requires resourceId, projectId, ownerId, and FUTURE_CUP_POSTGRES_URL')
}

const store = new PostgresPlatformStore(url)
try {
  const result = await store.acquireWorkflowLease(resourceId, projectId, ownerId, 30_000)
  console.log(JSON.stringify({
    acquired: result.acquired,
    ownerId: result.ownerId,
    fencingToken: result.fencingToken?.toString(),
    expiresAt: result.expiresAt,
  }))
} finally {
  await store.close()
}
