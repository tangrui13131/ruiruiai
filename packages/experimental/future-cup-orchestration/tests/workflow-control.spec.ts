import { describe, expect, it } from 'vitest'
import {
  FUTURE_CUP_MAX_REPAIR_ROUNDS,
  FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION,
  WORKFLOW_CONTROL_DEFINITION_VERSION,
  WorkflowControlError,
  WorkflowControlExecutor,
  parseWorkflowControlDefinition,
  parseWorkflowEscalationReason,
  type ActiveWorkflowControlNode,
  type WorkflowControlErrorCode,
  type WorkflowControlSnapshot,
  type WorkflowVerificationStatus,
} from '../src/workflow-control.ts'

function activeNode(snapshot: WorkflowControlSnapshot): ActiveWorkflowControlNode {
  const node = snapshot.activeNodes[0]
  if (node === undefined) throw new Error('expected an active workflow control task')
  return node
}

function activeNodeIds(snapshot: WorkflowControlSnapshot): string[] {
  return snapshot.activeNodes.map(node => node.nodeId)
}

function startFutureCup(): WorkflowControlExecutor {
  return WorkflowControlExecutor.start(FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION)
}

function completeActiveTask(
  executor: WorkflowControlExecutor,
  summary = 'task completed',
): WorkflowControlSnapshot {
  const active = activeNode(executor.snapshot())
  return executor.advance({
    type: 'TASK_COMPLETED',
    instanceId: active.instanceId,
    summary,
  })
}

function completeVerification(
  executor: WorkflowControlExecutor,
  status: WorkflowVerificationStatus,
  failureSignature?: string,
  strategySwitchAvailable?: boolean,
): WorkflowControlSnapshot {
  const active = activeNode(executor.snapshot())
  return executor.advance({
    type: 'VERIFICATION_COMPLETED',
    instanceId: active.instanceId,
    status,
    ...(failureSignature === undefined ? {} : { failureSignature }),
    ...(strategySwitchAvailable === undefined ? {} : { strategySwitchAvailable }),
  })
}

function expectControlError(action: () => void, code: WorkflowControlErrorCode): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowControlError)
    if (!(error instanceof WorkflowControlError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`expected WorkflowControlError with code ${code}`)
}

function cloneSnapshot(snapshot: WorkflowControlSnapshot): WorkflowControlSnapshot {
  return structuredClone(snapshot)
}

function parallelDefinition() {
  return parseWorkflowControlDefinition({
    version: 1,
    id: 'parallel-test',
    label: 'Parallel test',
    entryGraphId: 'main',
    graphs: [{
      id: 'main',
      label: 'Main',
      entryNodeId: 'fan-out',
      nodes: [
        { id: 'fan-out', label: 'Fan out', type: 'PARALLEL', joinNodeId: 'join' },
        { id: 'left', label: 'Left', type: 'TASK', taskRef: 'left', expectedResult: 'COMPLETION' },
        { id: 'right', label: 'Right', type: 'TASK', taskRef: 'right', expectedResult: 'COMPLETION' },
        { id: 'join', label: 'Join', type: 'TASK', taskRef: 'join', expectedResult: 'COMPLETION' },
        { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
      ],
      edges: [
        { id: 'fan-left', from: 'fan-out', to: 'left', condition: { kind: 'ALWAYS' } },
        { id: 'fan-right', from: 'fan-out', to: 'right', condition: { kind: 'ALWAYS' } },
        { id: 'left-join', from: 'left', to: 'join', condition: { kind: 'ALWAYS' } },
        { id: 'right-join', from: 'right', to: 'join', condition: { kind: 'ALWAYS' } },
        { id: 'join-done', from: 'join', to: 'done', condition: { kind: 'ALWAYS' } },
      ],
    }],
  })
}

describe('WorkflowControlExecutor', () => {
  it('exposes a versioned fixed definition with a three-round repair bound', () => {
    expect(FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION.version).toBe(WORKFLOW_CONTROL_DEFINITION_VERSION)
    expect(FUTURE_CUP_MAX_REPAIR_ROUNDS).toBe(3)
    const main = FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION.graphs.find(graph => graph.id === 'main')
    const loop = main?.nodes.find(node => node.type === 'LOOP')
    expect(loop?.type === 'LOOP' ? loop.maxIterations : undefined).toBe(3)
  })

  it('runs sequential task nodes in edge order', () => {
    const definition = parseWorkflowControlDefinition({
      version: 1,
      id: 'sequence-test',
      label: 'Sequence test',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'sequence',
        nodes: [
          { id: 'sequence', label: 'Sequence', type: 'SEQUENCE' },
          { id: 'first', label: 'First', type: 'TASK', taskRef: 'first', expectedResult: 'COMPLETION' },
          { id: 'second', label: 'Second', type: 'TASK', taskRef: 'second', expectedResult: 'COMPLETION' },
          { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
        ],
        edges: [
          { id: 'sequence-first', from: 'sequence', to: 'first', condition: { kind: 'ALWAYS' } },
          { id: 'first-second', from: 'first', to: 'second', condition: { kind: 'ALWAYS' } },
          { id: 'second-done', from: 'second', to: 'done', condition: { kind: 'ALWAYS' } },
        ],
      }],
    })
    const executor = WorkflowControlExecutor.start(definition)

    expect(activeNodeIds(executor.snapshot())).toEqual(['first'])
    expect(activeNodeIds(completeActiveTask(executor))).toEqual(['second'])
    expect(completeActiveTask(executor).status).toBe('PASSED')
  })

  it('starts every parallel branch and joins only after all branches arrive', () => {
    const executor = WorkflowControlExecutor.start(parallelDefinition())
    expect(activeNodeIds(executor.snapshot())).toEqual(['left', 'right'])

    const left = activeNode(executor.snapshot())
    const afterLeft = executor.advance({
      type: 'TASK_COMPLETED',
      instanceId: left.instanceId,
      summary: 'left completed',
    })
    expect(activeNodeIds(afterLeft)).toEqual(['right'])

    const afterRight = completeActiveTask(executor)
    expect(activeNodeIds(afterRight)).toEqual(['join'])
    expect(completeActiveTask(executor).status).toBe('PASSED')
  })

  it('selects delivery for PASS', () => {
    const executor = startFutureCup()
    const verification = completeVerification(executor, 'PASS')

    expect(activeNodeIds(verification)).toEqual(['delivery'])
    expect(verification.journal).toContainEqual(expect.objectContaining({
      type: 'edge/selected',
      edgeId: 'pass-to-delivery',
    }))
    expect(completeActiveTask(executor).status).toBe('PASSED')
  })

  it.each([
    ['FAIL', 'failure-a'],
    ['INCOMPLETE', undefined],
  ] as const)('enters the repair subworkflow for %s', (status, failureSignature) => {
    const executor = startFutureCup()
    const snapshot = completeVerification(executor, status, failureSignature)

    expect(activeNodeIds(snapshot)).toEqual(['repair-task'])
    expect(snapshot.frames.at(-1)?.graphId).toBe('repair')
    expect(snapshot.journal).toContainEqual(expect.objectContaining({
      type: 'subworkflow/entered',
      childGraphId: 'repair',
    }))
  })

  it('returns from the repair subworkflow to verification', () => {
    const executor = startFutureCup()
    completeVerification(executor, 'FAIL', 'failure-a')
    const afterRepair = completeActiveTask(executor, 'repair completed')

    expect(activeNodeIds(afterRepair)).toEqual(['verify'])
    expect(afterRepair.frames).toHaveLength(1)
    expect(afterRepair.repairRound).toBe(1)
    expect(afterRepair.journal).toContainEqual(expect.objectContaining({
      type: 'subworkflow/exited',
      graphId: 'main',
      childGraphId: 'repair',
    }))
  })

  it('switches repair strategy before escalating a repeated failure signature', () => {
    const executor = startFutureCup()
    completeVerification(executor, 'FAIL', 'same-signature')
    completeActiveTask(executor)
    const switched = completeVerification(executor, 'FAIL', 'same-signature', true)

    expect(switched.status).toBe('RUNNING')
    expect(activeNodeIds(switched)).toEqual(['repair-task'])
    expect(switched.repairRound).toBe(2)
    expect(switched.lastVerification).toMatchObject({
      repeated: true,
      strategySwitchAvailable: true,
    })
    expect(switched.journal).toContainEqual(expect.objectContaining({
      type: 'loop/evaluated',
      result: 'CONTINUE',
    }))

    completeActiveTask(executor)
    const escalated = completeVerification(executor, 'FAIL', 'same-signature')
    expect(escalated.status).toBe('ESCALATED')
    expect(escalated.escalationReason).toBe('REPEATED_FAILURE')
    expect(escalated.repairRound).toBe(2)
    expect(escalated.activeNodes).toEqual([])
  })

  it('escalates after exactly three distinct repair rounds', () => {
    const executor = startFutureCup()
    const signatures = ['failure-a', 'failure-b', 'failure-c', 'failure-d']
    const first = signatures[0]
    if (first === undefined) throw new Error('missing first failure signature')
    completeVerification(executor, 'FAIL', first)

    for (let round = 1; round <= FUTURE_CUP_MAX_REPAIR_ROUNDS; round += 1) {
      expect(activeNodeIds(executor.snapshot())).toEqual(['repair-task'])
      completeActiveTask(executor)
      expect(activeNodeIds(executor.snapshot())).toEqual(['verify'])
      const signature = signatures[round]
      if (signature === undefined) throw new Error(`missing failure signature ${round}`)
      const snapshot = completeVerification(executor, 'FAIL', signature)
      if (round < FUTURE_CUP_MAX_REPAIR_ROUNDS) {
        expect(activeNodeIds(snapshot)).toEqual(['repair-task'])
      } else {
        expect(snapshot.status).toBe('ESCALATED')
        expect(snapshot.escalationReason).toBe('MAX_REPAIR_ROUNDS')
        expect(snapshot.repairRound).toBe(FUTURE_CUP_MAX_REPAIR_ROUNDS)
      }
    }
  })

  it('resumes from the same active task and produces the same next state', () => {
    const executor = startFutureCup()
    const beforeRepair = completeVerification(executor, 'FAIL', 'failure-a')
    const restored = WorkflowControlExecutor.resume(beforeRepair)

    expect(restored.snapshot()).toEqual(beforeRepair)
    const active = activeNode(beforeRepair)
    const event = {
      type: 'TASK_COMPLETED' as const,
      instanceId: active.instanceId,
      summary: 'repair completed',
    }
    expect(restored.advance(event)).toEqual(executor.advance(event))
  })

  it('parses known escalation reasons and rejects unknown values', () => {
    expect(parseWorkflowEscalationReason('REPEATED_FAILURE')).toBe('REPEATED_FAILURE')
    expect(() => parseWorkflowEscalationReason('UNKNOWN')).toThrow(/unknown escalation reason/)
  })

  it('reports invalid events and transitions explicitly', () => {
    const executor = startFutureCup()
    const verification = activeNode(executor.snapshot())

    expectControlError(() => {
      executor.advance({
        type: 'TASK_COMPLETED',
        instanceId: verification.instanceId,
        summary: 'wrong result kind',
      })
    }, 'INVALID_EVENT')

    completeVerification(executor, 'PASS')
    completeActiveTask(executor)
    expectControlError(() => {
      executor.advance({
        type: 'TASK_COMPLETED',
        instanceId: verification.instanceId,
        summary: 'too late',
      })
    }, 'TERMINAL_TRANSITION')
  })
})

describe('workflow control validation', () => {
  it('reports malformed definitions with stable error codes and paths', () => {
    expectControlError(() => parseWorkflowControlDefinition(null), 'INVALID_DEFINITION')
    expectControlError(() => parseWorkflowControlDefinition({
      version: 2,
      id: 'wrong-version',
      label: 'Wrong version',
      entryGraphId: 'main',
      graphs: [],
    }), 'INVALID_DEFINITION')
  })

  it('rejects duplicate and missing graph, node, and edge references', () => {
    expectControlError(() => parseWorkflowControlDefinition({
      version: 1,
      id: 'invalid-references',
      label: 'Invalid references',
      entryGraphId: 'missing-entry-graph',
      graphs: [
        {
          id: 'duplicate',
          label: 'Duplicate one',
          entryNodeId: 'missing-entry-node',
          nodes: [
            { id: 'task', label: 'Task', type: 'TASK', taskRef: 'task', expectedResult: 'COMPLETION' },
            { id: 'task', label: 'Duplicate', type: 'TASK', taskRef: 'other', expectedResult: 'COMPLETION' },
            { id: 'terminal', label: 'Terminal', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'duplicate-edge', from: 'task', to: 'terminal', condition: { kind: 'ALWAYS' } },
            { id: 'duplicate-edge', from: 'ghost-from', to: 'ghost-to', condition: { kind: 'ALWAYS' } },
          ],
        },
        {
          id: 'duplicate',
          label: 'Duplicate two',
          entryNodeId: 'task',
          nodes: [
            { id: 'task', label: 'Task', type: 'TASK', taskRef: 'task', expectedResult: 'COMPLETION' },
            { id: 'terminal', label: 'Terminal', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'task-terminal', from: 'task', to: 'terminal', condition: { kind: 'ALWAYS' } },
          ],
        },
      ],
    }), 'INVALID_DEFINITION')
  })

  it('rejects node-specific edge violations in one definition validation pass', () => {
    expectControlError(() => parseWorkflowControlDefinition({
      version: 1,
      id: 'invalid-semantics',
      label: 'Invalid semantics',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'task',
        nodes: [
          { id: 'task', label: 'Task', type: 'TASK', taskRef: 'task', expectedResult: 'COMPLETION' },
          { id: 'sequence', label: 'Sequence', type: 'SEQUENCE' },
          { id: 'parallel-one', label: 'One branch', type: 'PARALLEL', joinNodeId: 'missing-join' },
          { id: 'parallel-many', label: 'Many branches', type: 'PARALLEL', joinNodeId: 'terminal' },
          { id: 'condition', label: 'Condition', type: 'CONDITION', subject: 'VERIFICATION_STATUS' },
          { id: 'loop', label: 'Loop', type: 'LOOP', subject: 'VERIFICATION_REPAIR', maxIterations: 3 },
          { id: 'subflow', label: 'Subflow', type: 'SUBWORKFLOW', graphId: 'missing-graph' },
          { id: 'terminal', label: 'Terminal', type: 'TERMINAL', status: 'PASSED' },
        ],
        edges: [
          { id: 'task-invalid', from: 'task', to: 'terminal', condition: { kind: 'LOOP_RESULT', result: 'CONTINUE' } },
          { id: 'sequence-invalid', from: 'sequence', to: 'terminal', condition: { kind: 'VERIFICATION_STATUS', status: 'PASS' } },
          { id: 'parallel-one-invalid', from: 'parallel-one', to: 'terminal', condition: { kind: 'ALWAYS' } },
          { id: 'parallel-many-a', from: 'parallel-many', to: 'terminal', condition: { kind: 'ALWAYS' } },
          {
            id: 'parallel-many-b',
            from: 'parallel-many',
            to: 'terminal',
            condition: { kind: 'VERIFICATION_STATUS', status: 'FAIL' },
          },
          { id: 'condition-pass-a', from: 'condition', to: 'terminal', condition: { kind: 'VERIFICATION_STATUS', status: 'PASS' } },
          { id: 'condition-pass-b', from: 'condition', to: 'task', condition: { kind: 'VERIFICATION_STATUS', status: 'PASS' } },
          { id: 'condition-wrong-kind', from: 'condition', to: 'terminal', condition: { kind: 'ALWAYS' } },
          { id: 'loop-continue', from: 'loop', to: 'task', condition: { kind: 'LOOP_RESULT', result: 'CONTINUE' } },
          { id: 'loop-wrong-kind', from: 'loop', to: 'terminal', condition: { kind: 'ALWAYS' } },
          { id: 'subflow-wrong-kind', from: 'subflow', to: 'terminal', condition: { kind: 'LOOP_RESULT', result: 'EXHAUSTED' } },
          { id: 'terminal-outgoing', from: 'terminal', to: 'task', condition: { kind: 'ALWAYS' } },
        ],
      }],
    }), 'INVALID_DEFINITION')
  })

  it('rejects subworkflow cycles but accepts a shared child graph', () => {
    expectControlError(() => parseWorkflowControlDefinition({
      version: 1,
      id: 'cyclic-subworkflows',
      label: 'Cyclic subworkflows',
      entryGraphId: 'a',
      graphs: [
        {
          id: 'a',
          label: 'A',
          entryNodeId: 'to-b',
          nodes: [
            { id: 'to-b', label: 'To B', type: 'SUBWORKFLOW', graphId: 'b' },
            { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'a-to-done', from: 'to-b', to: 'done', condition: { kind: 'ALWAYS' } },
          ],
        },
        {
          id: 'b',
          label: 'B',
          entryNodeId: 'to-a',
          nodes: [
            { id: 'to-a', label: 'To A', type: 'SUBWORKFLOW', graphId: 'a' },
            { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'b-to-done', from: 'to-a', to: 'done', condition: { kind: 'ALWAYS' } },
          ],
        },
      ],
    }), 'INVALID_DEFINITION')

    expect(parseWorkflowControlDefinition({
      version: 1,
      id: 'shared-subworkflow',
      label: 'Shared subworkflow',
      entryGraphId: 'main',
      graphs: [
        {
          id: 'main',
          label: 'Main',
          entryNodeId: 'first',
          nodes: [
            { id: 'first', label: 'First', type: 'SUBWORKFLOW', graphId: 'leaf' },
            { id: 'second', label: 'Second', type: 'SUBWORKFLOW', graphId: 'leaf' },
            { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'first-second', from: 'first', to: 'second', condition: { kind: 'ALWAYS' } },
            { id: 'second-done', from: 'second', to: 'done', condition: { kind: 'ALWAYS' } },
          ],
        },
        {
          id: 'leaf',
          label: 'Leaf',
          entryNodeId: 'task',
          nodes: [
            { id: 'task', label: 'Task', type: 'TASK', taskRef: 'task', expectedResult: 'COMPLETION' },
            { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'task-done', from: 'task', to: 'done', condition: { kind: 'ALWAYS' } },
          ],
        },
      ],
    }).id).toBe('shared-subworkflow')
  })
})

describe('workflow control defensive execution', () => {
  it('rejects malformed, inactive, and mismatched completion events', () => {
    const executor = startFutureCup()
    expectControlError(() => executor.advance({ type: 'UNKNOWN' }), 'INVALID_EVENT')
    expectControlError(() => executor.advance({
      type: 'TASK_COMPLETED',
      instanceId: 'missing@1',
      summary: 'inactive',
    }), 'INVALID_EVENT')
    const verification = activeNode(executor.snapshot())
    expectControlError(() => executor.advance({
      type: 'TASK_COMPLETED',
      instanceId: verification.instanceId,
      summary: 'wrong kind',
    }), 'INVALID_EVENT')
    completeVerification(executor, 'PASS')
    const delivery = activeNode(executor.snapshot())
    expectControlError(() => executor.advance({
      type: 'VERIFICATION_COMPLETED',
      instanceId: delivery.instanceId,
      status: 'PASS',
    }), 'INVALID_EVENT')
  })

  it('fails loudly when control data is unavailable or structurally unsupported', () => {
    const conditionWithoutVerification = parseWorkflowControlDefinition({
      version: 1,
      id: 'condition-without-verification',
      label: 'Condition without verification',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'condition',
        nodes: [
          { id: 'condition', label: 'Condition', type: 'CONDITION', subject: 'VERIFICATION_STATUS' },
          { id: 'pass', label: 'Pass', type: 'TERMINAL', status: 'PASSED' },
          { id: 'fail', label: 'Fail', type: 'TERMINAL', status: 'ESCALATED' },
          { id: 'incomplete', label: 'Incomplete', type: 'TERMINAL', status: 'ESCALATED' },
        ],
        edges: [
          { id: 'pass-edge', from: 'condition', to: 'pass', condition: { kind: 'VERIFICATION_STATUS', status: 'PASS' } },
          { id: 'fail-edge', from: 'condition', to: 'fail', condition: { kind: 'VERIFICATION_STATUS', status: 'FAIL' } },
          {
            id: 'incomplete-edge',
            from: 'condition',
            to: 'incomplete',
            condition: { kind: 'VERIFICATION_STATUS', status: 'INCOMPLETE' },
          },
        ],
      }],
    })
    expectControlError(
      () => WorkflowControlExecutor.start(conditionWithoutVerification),
      'INVALID_TRANSITION',
    )

    const loopWithoutVerification = parseWorkflowControlDefinition({
      version: 1,
      id: 'loop-without-verification',
      label: 'Loop without verification',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'loop',
        nodes: [
          { id: 'loop', label: 'Loop', type: 'LOOP', subject: 'VERIFICATION_REPAIR', maxIterations: 1 },
          { id: 'continue', label: 'Continue', type: 'TERMINAL', status: 'PASSED' },
          { id: 'exhausted', label: 'Exhausted', type: 'TERMINAL', status: 'ESCALATED' },
        ],
        edges: [
          { id: 'continue-edge', from: 'loop', to: 'continue', condition: { kind: 'LOOP_RESULT', result: 'CONTINUE' } },
          { id: 'exhausted-edge', from: 'loop', to: 'exhausted', condition: { kind: 'LOOP_RESULT', result: 'EXHAUSTED' } },
        ],
      }],
    })
    expectControlError(
      () => WorkflowControlExecutor.start(loopWithoutVerification),
      'INVALID_TRANSITION',
    )
  })

  it('bounds automatic control transitions and rejects nested parallel nodes', () => {
    const cyclicSequence = parseWorkflowControlDefinition({
      version: 1,
      id: 'cyclic-sequence',
      label: 'Cyclic sequence',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'sequence',
        nodes: [{ id: 'sequence', label: 'Sequence', type: 'SEQUENCE' }],
        edges: [{ id: 'sequence-loop', from: 'sequence', to: 'sequence', condition: { kind: 'ALWAYS' } }],
      }],
    })
    expectControlError(
      () => WorkflowControlExecutor.start(cyclicSequence),
      'INVALID_TRANSITION',
    )

    const nestedParallel = parseWorkflowControlDefinition({
      version: 1,
      id: 'nested-parallel',
      label: 'Nested parallel',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'outer',
        nodes: [
          { id: 'outer', label: 'Outer', type: 'PARALLEL', joinNodeId: 'outer-join' },
          { id: 'inner', label: 'Inner', type: 'PARALLEL', joinNodeId: 'inner-join' },
          { id: 'right', label: 'Right', type: 'TASK', taskRef: 'right', expectedResult: 'COMPLETION' },
          { id: 'inner-left', label: 'Inner left', type: 'TASK', taskRef: 'left', expectedResult: 'COMPLETION' },
          { id: 'inner-right', label: 'Inner right', type: 'TASK', taskRef: 'inner', expectedResult: 'COMPLETION' },
          { id: 'inner-join', label: 'Inner join', type: 'TASK', taskRef: 'inner-join', expectedResult: 'COMPLETION' },
          { id: 'outer-join', label: 'Outer join', type: 'TASK', taskRef: 'outer-join', expectedResult: 'COMPLETION' },
          { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
        ],
        edges: [
          { id: 'outer-inner', from: 'outer', to: 'inner', condition: { kind: 'ALWAYS' } },
          { id: 'outer-right', from: 'outer', to: 'right', condition: { kind: 'ALWAYS' } },
          { id: 'inner-left-edge', from: 'inner', to: 'inner-left', condition: { kind: 'ALWAYS' } },
          { id: 'inner-right-edge', from: 'inner', to: 'inner-right', condition: { kind: 'ALWAYS' } },
          { id: 'inner-left-join', from: 'inner-left', to: 'inner-join', condition: { kind: 'ALWAYS' } },
          { id: 'inner-right-join', from: 'inner-right', to: 'inner-join', condition: { kind: 'ALWAYS' } },
          { id: 'inner-join-outer', from: 'inner-join', to: 'outer-join', condition: { kind: 'ALWAYS' } },
          { id: 'right-outer', from: 'right', to: 'outer-join', condition: { kind: 'ALWAYS' } },
          { id: 'outer-done', from: 'outer-join', to: 'done', condition: { kind: 'ALWAYS' } },
        ],
      }],
    })
    expectControlError(
      () => WorkflowControlExecutor.start(nestedParallel),
      'INVALID_TRANSITION',
    )
  })

  it('requires an escalation reason and handles a terminal parallel branch safely', () => {
    const directEscalation = parseWorkflowControlDefinition({
      version: 1,
      id: 'direct-escalation',
      label: 'Direct escalation',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'start',
        nodes: [
          { id: 'start', label: 'Start', type: 'SEQUENCE' },
          { id: 'escalated', label: 'Escalated', type: 'TERMINAL', status: 'ESCALATED' },
        ],
        edges: [{ id: 'start-escalated', from: 'start', to: 'escalated', condition: { kind: 'ALWAYS' } }],
      }],
    })
    expectControlError(
      () => WorkflowControlExecutor.start(directEscalation),
      'INVALID_TRANSITION',
    )

    const terminalBranch = parseWorkflowControlDefinition({
      version: 1,
      id: 'terminal-parallel-branch',
      label: 'Terminal parallel branch',
      entryGraphId: 'main',
      graphs: [{
        id: 'main',
        label: 'Main',
        entryNodeId: 'fan-out',
        nodes: [
          { id: 'fan-out', label: 'Fan out', type: 'PARALLEL', joinNodeId: 'join' },
          { id: 'passed', label: 'Passed', type: 'TERMINAL', status: 'PASSED' },
          { id: 'right', label: 'Right', type: 'TASK', taskRef: 'right', expectedResult: 'COMPLETION' },
          { id: 'join', label: 'Join', type: 'TASK', taskRef: 'join', expectedResult: 'COMPLETION' },
        ],
        edges: [
          { id: 'fan-passed', from: 'fan-out', to: 'passed', condition: { kind: 'ALWAYS' } },
          { id: 'fan-right', from: 'fan-out', to: 'right', condition: { kind: 'ALWAYS' } },
          { id: 'right-join', from: 'right', to: 'join', condition: { kind: 'ALWAYS' } },
        ],
      }],
    })
    expect(WorkflowControlExecutor.start(terminalBranch).snapshot().status).toBe('PASSED')
  })

  it('returns from a subworkflow inside one parallel branch before joining', () => {
    const definition = parseWorkflowControlDefinition({
      version: 1,
      id: 'parallel-subworkflow',
      label: 'Parallel subworkflow',
      entryGraphId: 'main',
      graphs: [
        {
          id: 'main',
          label: 'Main',
          entryNodeId: 'fan-out',
          nodes: [
            { id: 'fan-out', label: 'Fan out', type: 'PARALLEL', joinNodeId: 'join' },
            { id: 'child', label: 'Child', type: 'SUBWORKFLOW', graphId: 'child-graph' },
            { id: 'right', label: 'Right', type: 'TASK', taskRef: 'right', expectedResult: 'COMPLETION' },
            { id: 'join', label: 'Join', type: 'TASK', taskRef: 'join', expectedResult: 'COMPLETION' },
            { id: 'done', label: 'Done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'fan-child', from: 'fan-out', to: 'child', condition: { kind: 'ALWAYS' } },
            { id: 'fan-right', from: 'fan-out', to: 'right', condition: { kind: 'ALWAYS' } },
            { id: 'child-join', from: 'child', to: 'join', condition: { kind: 'ALWAYS' } },
            { id: 'right-join', from: 'right', to: 'join', condition: { kind: 'ALWAYS' } },
            { id: 'join-done', from: 'join', to: 'done', condition: { kind: 'ALWAYS' } },
          ],
        },
        {
          id: 'child-graph',
          label: 'Child graph',
          entryNodeId: 'child-task',
          nodes: [
            { id: 'child-task', label: 'Child task', type: 'TASK', taskRef: 'child', expectedResult: 'COMPLETION' },
            { id: 'child-done', label: 'Child done', type: 'TERMINAL', status: 'PASSED' },
          ],
          edges: [
            { id: 'child-task-done', from: 'child-task', to: 'child-done', condition: { kind: 'ALWAYS' } },
          ],
        },
      ],
    })
    const executor = WorkflowControlExecutor.start(definition)
    const child = executor.snapshot().activeNodes.find(node => node.nodeId === 'child-task')
    if (child === undefined) throw new Error('expected the child task to be active')
    executor.advance({
      type: 'TASK_COMPLETED',
      instanceId: child.instanceId,
      summary: 'child completed',
    })
    const right = activeNode(executor.snapshot())
    executor.advance({
      type: 'TASK_COMPLETED',
      instanceId: right.instanceId,
      summary: 'right completed',
    })
    expect(activeNodeIds(executor.snapshot())).toEqual(['join'])
  })
})

describe('workflow control snapshot validation', () => {
  it('rejects schema-invalid snapshots', () => {
    expectControlError(
      () => WorkflowControlExecutor.resume(null),
      'INVALID_SNAPSHOT',
    )
  })

  it('rejects inconsistent journal, frame, active-node, and ordinal state', () => {
    const base = startFutureCup().snapshot()
    const corruptions: readonly [string, (snapshot: WorkflowControlSnapshot) => void][] = [
      ['revision', (snapshot) => { snapshot.revision += 1 }],
      ['journal sequence', (snapshot) => { snapshot.journal[0]!.seq = 2 }],
      ['running terminal journal', (snapshot) => {
        snapshot.journal = [{ seq: 1, type: 'run/terminal', status: 'PASSED' }]
        snapshot.revision = 1
      }],
      ['terminal active node', (snapshot) => {
        snapshot.status = 'PASSED'
        snapshot.journal = [{ seq: 1, type: 'run/terminal', status: 'PASSED' }]
        snapshot.revision = 1
      }],
      ['repair round', (snapshot) => { snapshot.repairRound = 1 }],
      ['missing frame graph', (snapshot) => { snapshot.frames[0]!.graphId = 'missing' }],
      ['root frame parent', (snapshot) => {
        snapshot.frames[0]!.parent = {
          instanceId: snapshot.activeNodes[0]!.instanceId,
          nodeId: snapshot.activeNodes[0]!.nodeId,
        }
      }],
      ['child frame without parent', (snapshot) => {
        snapshot.frames.push({ graphId: 'repair' })
      }],
      ['child frame with non-subworkflow parent', (snapshot) => {
        snapshot.frames.push({
          graphId: 'repair',
          parent: {
            instanceId: snapshot.activeNodes[0]!.instanceId,
            nodeId: snapshot.activeNodes[0]!.nodeId,
          },
        })
      }],
      ['child frame with wrong graph', (snapshot) => {
        snapshot.frames.push({
          graphId: 'main',
          parent: {
            instanceId: 'repair-subworkflow@99',
            nodeId: 'repair-subworkflow',
          },
        })
      }],
      ['duplicate active node', (snapshot) => {
        snapshot.activeNodes.push({ ...snapshot.activeNodes[0]! })
      }],
      ['active node is not a task', (snapshot) => {
        snapshot.activeNodes[0]!.nodeId = 'verification-sequence'
      }],
      ['active task mismatch', (snapshot) => {
        snapshot.activeNodes[0]!.taskRef = 'delivery'
      }],
      ['incomplete branch membership', (snapshot) => {
        snapshot.activeNodes[0]!.barrierId = 'barrier@99'
      }],
      ['branch without barrier', (snapshot) => {
        snapshot.activeNodes[0]!.barrierId = 'barrier@99'
        snapshot.activeNodes[0]!.branchIndex = 0
      }],
      ['used instance ordinal', (snapshot) => { snapshot.nextInstanceOrdinal = 2 }],
    ]

    for (const [name, corrupt] of corruptions) {
      const snapshot = cloneSnapshot(base)
      corrupt(snapshot)
      expectControlError(
        () => WorkflowControlExecutor.resume(snapshot),
        'INVALID_SNAPSHOT',
      )
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('rejects inconsistent loop and parallel barrier state', () => {
    const loopBase = startFutureCup()
    completeVerification(loopBase, 'FAIL', 'failure-a')
    const loopCorruptions: readonly [string, (snapshot: WorkflowControlSnapshot) => void][] = [
      ['duplicate loop state', (snapshot) => { snapshot.loopStates.push({ ...snapshot.loopStates[0]! }) }],
      ['loop state mismatch', (snapshot) => { snapshot.loopStates[0]!.maxIterations = 99 }],
    ]
    for (const [, corrupt] of loopCorruptions) {
      const snapshot = cloneSnapshot(loopBase.snapshot())
      corrupt(snapshot)
      expectControlError(
        () => WorkflowControlExecutor.resume(snapshot),
        'INVALID_SNAPSHOT',
      )
    }

    const parallelBase = WorkflowControlExecutor.start(parallelDefinition()).snapshot()
    const barrierCorruptions: readonly [string, (snapshot: WorkflowControlSnapshot) => void][] = [
      ['duplicate barrier', (snapshot) => { snapshot.parallelBarriers.push({ ...snapshot.parallelBarriers[0]! }) }],
      ['barrier join mismatch', (snapshot) => { snapshot.parallelBarriers[0]!.joinNodeId = 'done' }],
      ['barrier branch out of range', (snapshot) => { snapshot.parallelBarriers[0]!.arrivedBranchIndexes = [2] }],
      ['active branch out of range', (snapshot) => { snapshot.activeNodes[0]!.branchIndex = 2 }],
    ]
    for (const [, corrupt] of barrierCorruptions) {
      const snapshot = cloneSnapshot(parallelBase)
      corrupt(snapshot)
      expectControlError(
        () => WorkflowControlExecutor.resume(snapshot),
        'INVALID_SNAPSHOT',
      )
    }
  })
})
