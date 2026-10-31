import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { ProjectStore } from './project-store.ts'
import type { ProjectStoreState } from './project-store.ts'

const ProjectStoreContext = createContext<ProjectStore | undefined>(undefined)

/** Create and dispose one realtime project store for a project route. */
export function ProjectStoreProvider({
  projectId,
  children,
}: {
  readonly projectId: string
  readonly children: ReactNode
}) {
  const store = useMemo(() => new ProjectStore(projectId), [projectId])
  useEffect(() => {
    void store.start()
    return () => { store.stop() }
  }, [store])
  return <ProjectStoreContext.Provider value={store}>{children}</ProjectStoreContext.Provider>
}

/** Read the active project state through React's external-store contract. */
export function useProjectState(): ProjectStoreState {
  const store = useContext(ProjectStoreContext)
  if (store === undefined) throw new Error('useProjectState must be used inside ProjectStoreProvider')
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** Read the active project store for explicit refresh actions. */
export function useProjectStore(): ProjectStore {
  const store = useContext(ProjectStoreContext)
  if (store === undefined) throw new Error('useProjectStore must be used inside ProjectStoreProvider')
  return store
}
