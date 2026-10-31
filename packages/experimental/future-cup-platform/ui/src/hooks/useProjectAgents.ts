import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.ts'
import type { AgentView } from '../api/contracts.ts'

interface ProjectAgentsState {
  readonly projectId?: string
  readonly agents: readonly AgentView[]
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error?: unknown
}

export type ProjectAgentLoader = (projectId: string) => Promise<AgentView[]>

/** Load project-scoped Agent metrics and discard responses for superseded projects or event cursors. */
export function useProjectAgents(
  projectId: string | undefined,
  lastEventSeq: number,
  load: ProjectAgentLoader = api.listProjectAgents,
) {
  const requestSequence = useRef(0)
  const [retrySequence, setRetrySequence] = useState(0)
  const [state, setState] = useState<ProjectAgentsState>({
    projectId,
    agents: [],
    loading: projectId !== undefined,
    refreshing: false,
  })

  useEffect(() => {
    if (projectId === undefined) {
      requestSequence.current += 1
      setState({ agents: [], loading: false, refreshing: false })
      return
    }
    const request = ++requestSequence.current
    setState((current) => {
      const sameProject = current.projectId === projectId
      const agents = sameProject ? current.agents : []
      return {
        projectId,
        agents,
        loading: agents.length === 0,
        refreshing: agents.length > 0,
      }
    })
    void load(projectId).then((agents) => {
      if (request !== requestSequence.current) return
      setState({
        projectId,
        agents,
        loading: false,
        refreshing: false,
      })
    }).catch((error: unknown) => {
      if (request !== requestSequence.current) return
      setState(current => ({
        ...current,
        loading: false,
        refreshing: false,
        error,
      }))
    })
    return () => {
      if (requestSequence.current === request) requestSequence.current += 1
    }
  }, [lastEventSeq, load, projectId, retrySequence])

  return {
    agents: state.agents,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    retry: () => { setRetrySequence(value => value + 1) },
  }
}
