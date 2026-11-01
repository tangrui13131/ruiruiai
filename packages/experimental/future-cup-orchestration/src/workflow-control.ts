/** Versioned control graphs with deterministic, resumable verification and repair execution. */

import { z } from 'zod'

/** Current version of the workflow control definition format. */
export const WORKFLOW_CONTROL_DEFINITION_VERSION = 1

/** Current version of a serialized workflow control snapshot. */
export const WORKFLOW_CONTROL_SNAPSHOT_VERSION = 1

/** Maximum automatic repair attempts in the first fixed Future Cup workflow. */
export const FUTURE_CUP_MAX_REPAIR_ROUNDS = 3

const automaticTransitionLimit = 10_000
/** Inclusive upper bound accepted by one bounded repair loop. */
export const WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS = 100
const identifierSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const instanceIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*@[1-9][0-9]*$/)
const labelSchema = z.string().min(1).max(200)
const summarySchema = z.string().min(1).max(8_000)

/** Control node kinds supported by the versioned workflow definition. */
export const workflowControlNodeTypeSchema = z.enum([
  'TASK',
  'SEQUENCE',
  'PARALLEL',
  'CONDITION',
  'LOOP',
  'SUBWORKFLOW',
  'TERMINAL',
])

/** Verification states carried by workflow edges. */
export const workflowVerificationStatusSchema = z.enum(['PASS', 'FAIL', 'INCOMPLETE'])

/** Bounded loop outcomes carried by workflow edges. */
export const workflowLoopResultSchema = z.enum(['CONTINUE', 'EXHAUSTED'])

/** A control graph may complete successfully or require human escalation. */
export const workflowControlRunStatusSchema = z.enum(['RUNNING', 'PASSED', 'ESCALATED'])

/** Reasons that terminate the automatic repair loop without a passing verification. */
export const workflowEscalationReasonSchema = z.enum([
  'REPEATED_FAILURE',
  'MAX_REPAIR_ROUNDS',
  'REPAIR_TIMEOUT',
  'REPAIR_FAILED',
  'REPAIR_STRATEGY_UNAVAILABLE',
  'VERIFIER_INCOMPLETE',
])

/**
 * Parse one durable workflow escalation reason.
 * @param value - persisted reason text.
 * @returns the validated escalation reason.
 * @throws Error when the stored value is unknown.
 */
export function parseWorkflowEscalationReason(value: string): WorkflowEscalationReason {
  const parsed = workflowEscalationReasonSchema.safeParse(value)
  if (!parsed.success) throw new Error(`unknown escalation reason "${value}"`)
  return parsed.data
}

/** One task node awaiting an external completion event. */
export const workflowTaskNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('TASK'),
  taskRef: identifierSchema,
  expectedResult: z.enum(['COMPLETION', 'VERIFICATION']),
}).strict()

/** A node that forwards execution through exactly one unconditional edge. */
export const workflowSequenceNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('SEQUENCE'),
}).strict()

/** A node that starts all outgoing branches and joins after every branch arrives. */
export const workflowParallelNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('PARALLEL'),
  joinNodeId: identifierSchema,
}).strict()

/** A node that selects one branch from the latest verification result. */
export const workflowConditionNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('CONDITION'),
  subject: z.literal('VERIFICATION_STATUS'),
}).strict()

/** A bounded loop over the verification, repair, and reverification cycle. */
export const workflowLoopNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('LOOP'),
  subject: z.literal('VERIFICATION_REPAIR'),
  maxIterations: z.number().int().positive().max(WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS),
}).strict()

/** A node that enters another graph and resumes after its successful termination. */
export const workflowSubworkflowNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('SUBWORKFLOW'),
  graphId: identifierSchema,
}).strict()

/** A terminal node that ends the run with a durable status. */
export const workflowTerminalNodeSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  type: z.literal('TERMINAL'),
  status: z.enum(['PASSED', 'ESCALATED']),
}).strict()

/** Every supported control node. */
export const workflowControlNodeSchema = z.discriminatedUnion('type', [
  workflowTaskNodeSchema,
  workflowSequenceNodeSchema,
  workflowParallelNodeSchema,
  workflowConditionNodeSchema,
  workflowLoopNodeSchema,
  workflowSubworkflowNodeSchema,
  workflowTerminalNodeSchema,
])

/** An edge that is always selected. */
export const workflowAlwaysEdgeConditionSchema = z.object({
  kind: z.literal('ALWAYS'),
}).strict()

/** An edge selected by one verification result. */
export const workflowVerificationEdgeConditionSchema = z.object({
  kind: z.literal('VERIFICATION_STATUS'),
  status: workflowVerificationStatusSchema,
}).strict()

/** An edge selected by the bounded loop result. */
export const workflowLoopEdgeConditionSchema = z.object({
  kind: z.literal('LOOP_RESULT'),
  result: workflowLoopResultSchema,
}).strict()

/** A deterministic condition on one control edge. */
export const workflowEdgeConditionSchema = z.discriminatedUnion('kind', [
  workflowAlwaysEdgeConditionSchema,
  workflowVerificationEdgeConditionSchema,
  workflowLoopEdgeConditionSchema,
])

/** One directed edge in a control graph. */
export const workflowControlEdgeSchema = z.object({
  id: identifierSchema,
  from: identifierSchema,
  to: identifierSchema,
  condition: workflowEdgeConditionSchema,
}).strict()

/** One versioned graph of control nodes and directed edges. */
export const workflowControlGraphSchema = z.object({
  id: identifierSchema,
  label: labelSchema,
  entryNodeId: identifierSchema,
  nodes: z.array(workflowControlNodeSchema).min(1).max(200),
  edges: z.array(workflowControlEdgeSchema).max(800),
}).strict()

const workflowDefinitionBaseSchema = z.object({
  version: z.literal(WORKFLOW_CONTROL_DEFINITION_VERSION),
  id: identifierSchema,
  label: labelSchema,
  entryGraphId: identifierSchema,
  graphs: z.array(workflowControlGraphSchema).min(1).max(32),
}).strict()

type WorkflowDefinitionBase = z.infer<typeof workflowDefinitionBaseSchema>
type WorkflowGraphValue = z.infer<typeof workflowControlGraphSchema>
type WorkflowControlNodeValue = z.infer<typeof workflowControlNodeSchema>

/** A complete versioned workflow definition with its referenced control graphs. */
export const workflowDefinitionSchema = workflowDefinitionBaseSchema.superRefine((value, context) => {
  validateWorkflowDefinition(value, context)
})

/** Validated workflow definition inferred from the Zod schema. */
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>

/** One validated control graph. */
export type WorkflowControlGraph = z.infer<typeof workflowControlGraphSchema>

/** One validated control node. */
export type WorkflowControlNode = z.infer<typeof workflowControlNodeSchema>

/** One validated control edge. */
export type WorkflowControlEdge = z.infer<typeof workflowControlEdgeSchema>

/** One validated workflow control node type. */
export type WorkflowControlNodeType = z.infer<typeof workflowControlNodeTypeSchema>

/** One verification result accepted by a conditional edge. */
export type WorkflowVerificationStatus = z.infer<typeof workflowVerificationStatusSchema>

/** One bounded loop result accepted by a loop edge. */
export type WorkflowLoopResult = z.infer<typeof workflowLoopResultSchema>

/** One validated run status. */
export type WorkflowControlRunStatus = z.infer<typeof workflowControlRunStatusSchema>

/** One validated escalation reason. */
export type WorkflowEscalationReason = z.infer<typeof workflowEscalationReasonSchema>

/** A task completion event supplied by the bounded control executor's caller. */
export const workflowTaskCompletedEventSchema = z.object({
  type: z.literal('TASK_COMPLETED'),
  instanceId: instanceIdSchema,
  summary: summarySchema.optional(),
}).strict()

/** A verification completion event supplied by an independent verifier. */
export const workflowVerificationCompletedEventSchema = z.object({
  type: z.literal('VERIFICATION_COMPLETED'),
  instanceId: instanceIdSchema,
  status: workflowVerificationStatusSchema,
  failureSignature: z.string().min(1).max(1_000).optional(),
  strategySwitchAvailable: z.boolean().optional(),
}).strict()

/** Every external event that advances a running control graph. */
export const workflowControlEventSchema = z.discriminatedUnion('type', [
  workflowTaskCompletedEventSchema,
  workflowVerificationCompletedEventSchema,
])

/** One task completion event. */
export type WorkflowTaskCompletedEvent = z.infer<typeof workflowTaskCompletedEventSchema>

/** One verification completion event. */
export type WorkflowVerificationCompletedEvent = z.infer<typeof workflowVerificationCompletedEventSchema>

/** Every external workflow control event. */
export type WorkflowControlEvent = z.infer<typeof workflowControlEventSchema>

const sequenceNumberSchema = z.number().int().positive()
const journalNodeFields = {
  graphId: identifierSchema,
  nodeId: identifierSchema,
  nodeType: workflowControlNodeTypeSchema,
  instanceId: instanceIdSchema,
}
/** A durable record of the run start. */
export const workflowRunStartedJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('run/started'),
  definitionId: identifierSchema,
  definitionVersion: z.literal(WORKFLOW_CONTROL_DEFINITION_VERSION),
}).strict()

/** A durable record of entering a control node. */
export const workflowNodeEnteredJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('node/entered'),
  ...journalNodeFields,
}).strict()

/** A durable record of completing a control node. */
export const workflowNodeCompletedJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('node/completed'),
  ...journalNodeFields,
  summary: summarySchema.optional(),
}).strict()

/** A durable record of selecting one control edge. */
export const workflowEdgeSelectedJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('edge/selected'),
  graphId: identifierSchema,
  nodeId: identifierSchema,
  instanceId: instanceIdSchema,
  edgeId: identifierSchema,
  condition: workflowEdgeConditionSchema,
}).strict()

/** A durable record of one bounded loop decision. */
export const workflowLoopEvaluatedJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('loop/evaluated'),
  graphId: identifierSchema,
  nodeId: identifierSchema,
  instanceId: instanceIdSchema,
  round: z.number().int().nonnegative(),
  result: workflowLoopResultSchema,
  escalationReason: workflowEscalationReasonSchema.optional(),
}).strict()

/** A durable record of entering a child graph. */
export const workflowSubworkflowEnteredJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('subworkflow/entered'),
  graphId: identifierSchema,
  nodeId: identifierSchema,
  instanceId: instanceIdSchema,
  childGraphId: identifierSchema,
}).strict()

/** A durable record of leaving a child graph. */
export const workflowSubworkflowExitedJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('subworkflow/exited'),
  graphId: identifierSchema,
  nodeId: identifierSchema,
  instanceId: instanceIdSchema,
  childGraphId: identifierSchema,
}).strict()

/** A durable record of the terminal run status. */
export const workflowRunTerminalJournalSchema = z.object({
  seq: sequenceNumberSchema,
  type: z.literal('run/terminal'),
  status: z.enum(['PASSED', 'ESCALATED']),
  escalationReason: workflowEscalationReasonSchema.optional(),
}).strict()

/** Every durable workflow control journal entry. */
export const workflowControlJournalEntrySchema = z.discriminatedUnion('type', [
  workflowRunStartedJournalSchema,
  workflowNodeEnteredJournalSchema,
  workflowNodeCompletedJournalSchema,
  workflowEdgeSelectedJournalSchema,
  workflowLoopEvaluatedJournalSchema,
  workflowSubworkflowEnteredJournalSchema,
  workflowSubworkflowExitedJournalSchema,
  workflowRunTerminalJournalSchema,
])

/** One durable workflow control journal entry. */
export type WorkflowControlJournalEntry = z.infer<typeof workflowControlJournalEntrySchema>

type DistributiveOmit<T, Key extends PropertyKey> = T extends unknown ? Omit<T, Key> : never
type WorkflowControlJournalDraft = DistributiveOmit<WorkflowControlJournalEntry, 'seq'>

/** One graph and optional parent subworkflow call site. */
export const workflowControlFrameSchema = z.object({
  graphId: identifierSchema,
  parent: z.object({
    instanceId: instanceIdSchema,
    nodeId: identifierSchema,
    barrierId: instanceIdSchema.optional(),
    branchIndex: z.number().int().nonnegative().optional(),
  }).strict().optional(),
}).strict()

/** One task currently waiting for an external completion event. */
export const activeWorkflowControlNodeSchema = z.object({
  instanceId: instanceIdSchema,
  graphId: identifierSchema,
  nodeId: identifierSchema,
  nodeType: z.literal('TASK'),
  taskRef: identifierSchema,
  expectedResult: z.enum(['COMPLETION', 'VERIFICATION']),
  barrierId: instanceIdSchema.optional(),
  branchIndex: z.number().int().nonnegative().optional(),
}).strict()

/** One parallel join waiting for every branch to arrive. */
export const workflowParallelBarrierSchema = z.object({
  id: instanceIdSchema,
  graphId: identifierSchema,
  nodeId: identifierSchema,
  joinNodeId: identifierSchema,
  branchCount: z.number().int().min(2),
  arrivedBranchIndexes: z.array(z.number().int().nonnegative()),
}).strict()

/** Durable loop counters for one loop node. */
export const workflowLoopStateSchema = z.object({
  graphId: identifierSchema,
  nodeId: identifierSchema,
  iterations: z.number().int().nonnegative(),
  maxIterations: z.number().int().positive(),
}).strict()

/** The latest verification result observed by a condition or loop. */
export const workflowVerificationStateSchema = z.object({
  status: workflowVerificationStatusSchema,
  failureSignature: z.string().min(1).max(1_000).optional(),
  repeated: z.boolean(),
  strategySwitchAvailable: z.boolean().optional(),
}).strict()

/** A complete snapshot that can restore the executor without replaying control decisions. */
export const workflowControlSnapshotSchema = z.object({
  snapshotVersion: z.literal(WORKFLOW_CONTROL_SNAPSHOT_VERSION),
  definition: workflowDefinitionSchema,
  status: workflowControlRunStatusSchema,
  revision: z.number().int().nonnegative(),
  frames: z.array(workflowControlFrameSchema).min(1),
  activeNodes: z.array(activeWorkflowControlNodeSchema),
  parallelBarriers: z.array(workflowParallelBarrierSchema),
  loopStates: z.array(workflowLoopStateSchema),
  seenFailureSignatures: z.array(z.string().min(1).max(1_000)),
  lastVerification: workflowVerificationStateSchema.optional(),
  repairRound: z.number().int().nonnegative(),
  escalationReason: workflowEscalationReasonSchema.optional(),
  nextInstanceOrdinal: z.number().int().positive(),
  journal: z.array(workflowControlJournalEntrySchema),
}).strict()

/** One validated workflow control frame. */
export type WorkflowControlFrame = z.infer<typeof workflowControlFrameSchema>

/** One validated active task. */
export type ActiveWorkflowControlNode = z.infer<typeof activeWorkflowControlNodeSchema>

/** One validated parallel join barrier. */
export type WorkflowParallelBarrier = z.infer<typeof workflowParallelBarrierSchema>

/** One validated loop state. */
export type WorkflowLoopState = z.infer<typeof workflowLoopStateSchema>

/** One validated verification state. */
export type WorkflowVerificationState = z.infer<typeof workflowVerificationStateSchema>

/** A complete validated workflow control snapshot. */
export type WorkflowControlSnapshot = z.infer<typeof workflowControlSnapshotSchema>

/** Stable workflow control validation, event, and transition failure codes. */
export type WorkflowControlErrorCode =
  | 'INVALID_DEFINITION'
  | 'INVALID_SNAPSHOT'
  | 'INVALID_EVENT'
  | 'INVALID_TRANSITION'
  | 'TERMINAL_TRANSITION'

/** Typed workflow control validation or execution failure. */
export class WorkflowControlError extends Error {
  /**
   * @param message - actionable description of the rejected value or transition.
   * @param code - stable machine-readable failure code.
   */
  constructor(message: string, readonly code: WorkflowControlErrorCode) {
    super(message)
    this.name = 'WorkflowControlError'
  }
}

/**
 * Parse and validate one versioned workflow definition.
 * @param input - durable or test-supplied definition candidate.
 * @returns a detached validated definition.
 * @throws {WorkflowControlError} with `INVALID_DEFINITION` when validation fails.
 */
export function parseWorkflowControlDefinition(input: unknown): WorkflowDefinition {
  const parsed = workflowDefinitionSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkflowControlError(
      `Invalid workflow control definition: ${formatZodIssues(parsed.error.issues)}`,
      'INVALID_DEFINITION',
    )
  }
  return parsed.data
}

/**
 * Create a fresh copy of the Future Cup M5.2 control definition.
 * @param maxRepairRounds - configured positive automatic repair limit.
 * @returns the versioned verification, repair subworkflow, and escalation graph.
 */
export function createFutureCupWorkflowControlDefinition(
  maxRepairRounds: number = FUTURE_CUP_MAX_REPAIR_ROUNDS,
): WorkflowDefinition {
  const parsedMaxRepairRounds = z.number()
    .int()
    .positive()
    .max(WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS)
    .parse(maxRepairRounds)
  return parseWorkflowControlDefinition({
    version: WORKFLOW_CONTROL_DEFINITION_VERSION,
    id: `future-cup.m5.2.verification-repair.r${String(parsedMaxRepairRounds)}`,
    label: 'Verification and bounded repair',
    entryGraphId: 'main',
    graphs: [
      {
        id: 'main',
        label: 'Verification control flow',
        entryNodeId: 'verification-sequence',
        nodes: [
          {
            id: 'verification-sequence',
            label: 'Start verification',
            type: 'SEQUENCE',
          },
          {
            id: 'verify',
            label: 'Run independent verification',
            type: 'TASK',
            taskRef: 'verification',
            expectedResult: 'VERIFICATION',
          },
          {
            id: 'verification-condition',
            label: 'Choose verification outcome',
            type: 'CONDITION',
            subject: 'VERIFICATION_STATUS',
          },
          {
            id: 'repair-loop',
            label: 'Bound automatic repair',
            type: 'LOOP',
            subject: 'VERIFICATION_REPAIR',
            maxIterations: parsedMaxRepairRounds,
          },
          {
            id: 'repair-subworkflow',
            label: 'Enter repair subworkflow',
            type: 'SUBWORKFLOW',
            graphId: 'repair',
          },
          {
            id: 'delivery',
            label: 'Prepare delivery',
            type: 'TASK',
            taskRef: 'delivery',
            expectedResult: 'COMPLETION',
          },
          {
            id: 'passed',
            label: 'Workflow passed',
            type: 'TERMINAL',
            status: 'PASSED',
          },
          {
            id: 'escalated',
            label: 'Workflow escalated',
            type: 'TERMINAL',
            status: 'ESCALATED',
          },
        ],
        edges: [
          {
            id: 'start-to-verify',
            from: 'verification-sequence',
            to: 'verify',
            condition: { kind: 'ALWAYS' },
          },
          {
            id: 'verify-to-condition',
            from: 'verify',
            to: 'verification-condition',
            condition: { kind: 'ALWAYS' },
          },
          {
            id: 'pass-to-delivery',
            from: 'verification-condition',
            to: 'delivery',
            condition: { kind: 'VERIFICATION_STATUS', status: 'PASS' },
          },
          {
            id: 'fail-to-repair',
            from: 'verification-condition',
            to: 'repair-loop',
            condition: { kind: 'VERIFICATION_STATUS', status: 'FAIL' },
          },
          {
            id: 'incomplete-to-repair',
            from: 'verification-condition',
            to: 'repair-loop',
            condition: { kind: 'VERIFICATION_STATUS', status: 'INCOMPLETE' },
          },
          {
            id: 'repair-continue',
            from: 'repair-loop',
            to: 'repair-subworkflow',
            condition: { kind: 'LOOP_RESULT', result: 'CONTINUE' },
          },
          {
            id: 'repair-exhausted',
            from: 'repair-loop',
            to: 'escalated',
            condition: { kind: 'LOOP_RESULT', result: 'EXHAUSTED' },
          },
          {
            id: 'repair-to-verify',
            from: 'repair-subworkflow',
            to: 'verify',
            condition: { kind: 'ALWAYS' },
          },
          {
            id: 'delivery-to-passed',
            from: 'delivery',
            to: 'passed',
            condition: { kind: 'ALWAYS' },
          },
        ],
      },
      {
        id: 'repair',
        label: 'Repair subworkflow',
        entryNodeId: 'repair-task',
        nodes: [
          {
            id: 'repair-task',
            label: 'Run repair Agent',
            type: 'TASK',
            taskRef: 'repair',
            expectedResult: 'COMPLETION',
          },
          {
            id: 'repair-complete',
            label: 'Repair completed',
            type: 'TERMINAL',
            status: 'PASSED',
          },
        ],
        edges: [
          {
            id: 'repair-to-complete',
            from: 'repair-task',
            to: 'repair-complete',
            condition: { kind: 'ALWAYS' },
          },
        ],
      },
    ],
  })
}

/** The fixed Future Cup M5.2 control definition. */
export const FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION = createFutureCupWorkflowControlDefinition()

interface BranchMembership {
  readonly barrierId: string
  readonly branchIndex: number
}

interface PendingActivation {
  readonly graphId: string
  readonly nodeId: string
  readonly branch?: BranchMembership
}

interface RuntimeFields {
  readonly status: WorkflowControlRunStatus
  readonly frames: readonly WorkflowControlFrame[]
  readonly activeNodes: readonly ActiveWorkflowControlNode[]
  readonly parallelBarriers: readonly WorkflowParallelBarrier[]
  readonly loopStates: readonly WorkflowLoopState[]
  readonly seenFailureSignatures: readonly string[]
  readonly lastVerification?: WorkflowVerificationState | undefined
  readonly escalationReason?: WorkflowEscalationReason | undefined
  readonly nextInstanceOrdinal: number
  readonly journal: readonly WorkflowControlJournalEntry[]
}

/** Deterministic owner of one versioned workflow control execution. */
export class WorkflowControlExecutor {
  private readonly graphsById: ReadonlyMap<string, WorkflowControlGraph>
  private readonly nodesByGraphId: ReadonlyMap<string, ReadonlyMap<string, WorkflowControlNode>>
  private status: WorkflowControlRunStatus = 'RUNNING'
  private frames: WorkflowControlFrame[] = []
  private activeNodes: ActiveWorkflowControlNode[] = []
  private parallelBarriers: WorkflowParallelBarrier[] = []
  private loopStates: WorkflowLoopState[] = []
  private seenFailureSignatures: string[] = []
  private lastVerification: WorkflowVerificationState | undefined
  private escalationReason: WorkflowEscalationReason | undefined
  private nextInstanceOrdinal = 1
  private journal: WorkflowControlJournalEntry[] = []

  private constructor(
    private readonly definition: WorkflowDefinition,
    restored?: WorkflowControlSnapshot,
  ) {
    this.graphsById = new Map(definition.graphs.map(graph => [graph.id, graph]))
    this.nodesByGraphId = new Map(definition.graphs.map((graph) => {
      return [graph.id, new Map(graph.nodes.map(node => [node.id, node]))]
    }))
    if (restored !== undefined) this.restore(restored)
  }

  /**
   * Start a new run at the definition's entry graph.
   * @param definitionInput - versioned definition candidate.
   * @returns the executor after automatic entry transitions reach a task or terminal.
   * @throws {WorkflowControlError} for an invalid definition or graph transition.
   */
  static start(definitionInput: unknown): WorkflowControlExecutor {
    const definition = parseWorkflowControlDefinition(definitionInput)
    const executor = new WorkflowControlExecutor(definition)
    executor.frames = [{ graphId: definition.entryGraphId }]
    executor.appendJournal({
      type: 'run/started',
      definitionId: definition.id,
      definitionVersion: definition.version,
    })
    const entry = executor.requireGraph(definition.entryGraphId).entryNodeId
    executor.activate([{ graphId: definition.entryGraphId, nodeId: entry }])
    return executor
  }

  /**
   * Restore one run without replaying its journal or control decisions.
   * @param snapshotInput - durable snapshot candidate.
   * @returns the executor at exactly the serialized state.
   * @throws {WorkflowControlError} for an invalid or internally inconsistent snapshot.
   */
  static resume(snapshotInput: unknown): WorkflowControlExecutor {
    const snapshot = parseWorkflowControlSnapshot(snapshotInput)
    validateSnapshotConsistency(snapshot)
    return new WorkflowControlExecutor(snapshot.definition, snapshot)
  }

  /**
   * Advance the active task with one completion event.
   * @param eventInput - completion or verification event for the active task.
   * @returns the next quiescent snapshot after deterministic control transitions.
   * @throws {WorkflowControlError} for an invalid event, graph transition, or terminal run.
   */
  advance(eventInput: unknown): WorkflowControlSnapshot {
    if (this.status !== 'RUNNING') {
      throw new WorkflowControlError(`workflow is already ${this.status}`, 'TERMINAL_TRANSITION')
    }
    const parsed = workflowControlEventSchema.safeParse(eventInput)
    if (!parsed.success) {
      throw new WorkflowControlError(
        `Invalid workflow control event: ${formatZodIssues(parsed.error.issues)}`,
        'INVALID_EVENT',
      )
    }
    const event = parsed.data
    const active = this.activeNodes.find(node => node.instanceId === event.instanceId)
    if (active === undefined) {
      throw new WorkflowControlError(
        `event targets inactive node instance "${event.instanceId}"`,
        'INVALID_EVENT',
      )
    }
    if (event.type === 'TASK_COMPLETED' && active.expectedResult !== 'COMPLETION') {
      throw new WorkflowControlError(
        `task "${active.nodeId}" expects a verification result`,
        'INVALID_EVENT',
      )
    }
    if (event.type === 'VERIFICATION_COMPLETED' && active.expectedResult !== 'VERIFICATION') {
      throw new WorkflowControlError(
        `task "${active.nodeId}" expects a completion result`,
        'INVALID_EVENT',
      )
    }

    this.activeNodes.splice(this.activeNodes.indexOf(active), 1)
    this.appendJournal({
      type: 'node/completed',
      graphId: active.graphId,
      nodeId: active.nodeId,
      nodeType: 'TASK',
      instanceId: active.instanceId,
      ...(event.type === 'TASK_COMPLETED' && event.summary !== undefined
        ? { summary: event.summary }
        : {}),
    })

    if (event.type === 'VERIFICATION_COMPLETED') {
      this.recordVerification(event)
    }
    const graph = this.requireGraph(active.graphId)
    const node = this.requireNode(active.graphId, active.nodeId)
    const edges = this.requireAlwaysEdge(graph, node)
    this.activate(this.routeEdge(
      active.graphId,
      node,
      active.instanceId,
      edges,
      this.activeBranch(active),
    ))
    return this.snapshot()
  }

  /**
   * Stop one running graph when an external runtime failure cannot be represented by a graph event.
   * @param reason - stable reason requiring human intervention.
   * @returns the terminal snapshot.
   */
  escalate(reason: WorkflowEscalationReason): WorkflowControlSnapshot {
    if (this.status !== 'RUNNING') {
      throw new WorkflowControlError(`workflow is already ${this.status}`, 'TERMINAL_TRANSITION')
    }
    this.status = 'ESCALATED'
    this.escalationReason = reason
    this.activeNodes = []
    this.parallelBarriers = []
    this.appendJournal({
      type: 'run/terminal',
      status: 'ESCALATED',
      escalationReason: reason,
    })
    return this.snapshot()
  }

  /**
   * Read a detached validated snapshot of the current run.
   * @returns the durable control state and complete journal.
   * @throws {WorkflowControlError} when the in-memory state violates its schema.
   */
  snapshot(): WorkflowControlSnapshot {
    return captureSnapshot(this.definition, {
      status: this.status,
      frames: this.frames,
      activeNodes: this.activeNodes,
      parallelBarriers: this.parallelBarriers,
      loopStates: this.loopStates,
      seenFailureSignatures: this.seenFailureSignatures,
      lastVerification: this.lastVerification,
      escalationReason: this.escalationReason,
      nextInstanceOrdinal: this.nextInstanceOrdinal,
      journal: this.journal,
    })
  }

  private restore(snapshot: WorkflowControlSnapshot): void {
    this.status = snapshot.status
    this.frames = [...snapshot.frames]
    this.activeNodes = [...snapshot.activeNodes]
    this.parallelBarriers = [...snapshot.parallelBarriers]
    this.loopStates = [...snapshot.loopStates]
    this.seenFailureSignatures = [...snapshot.seenFailureSignatures]
    this.lastVerification = snapshot.lastVerification
    this.escalationReason = snapshot.escalationReason
    this.nextInstanceOrdinal = snapshot.nextInstanceOrdinal
    this.journal = [...snapshot.journal]
  }

  private recordVerification(event: WorkflowVerificationCompletedEvent): void {
    const signature = event.failureSignature
    const repeated = signature !== undefined && this.seenFailureSignatures.includes(signature)
    if (signature !== undefined && !repeated) this.seenFailureSignatures.push(signature)
    this.lastVerification = {
      status: event.status,
      repeated,
      ...(signature === undefined ? {} : { failureSignature: signature }),
      ...(event.strategySwitchAvailable === undefined
        ? {}
        : { strategySwitchAvailable: event.strategySwitchAvailable }),
    }
  }

  private activate(initial: readonly PendingActivation[]): void {
    const pending = [...initial]
    let transitions = 0
    while (pending.length > 0) {
      transitions += 1
      if (transitions > automaticTransitionLimit) {
        throw new WorkflowControlError(
          'automatic control transitions exceeded the safety limit',
          'INVALID_TRANSITION',
        )
      }
      const activation = requireValue(pending.shift(), 'control activation queue became empty')
      const next = this.activateOne(activation)
      pending.push(...next)
    }
  }

  private activateOne(activation: PendingActivation): PendingActivation[] {
    if (this.status !== 'RUNNING') return []
    const graph = this.requireGraph(activation.graphId)
    const node = this.requireNode(activation.graphId, activation.nodeId)
    const instanceId = this.nextInstanceId(node.id)
    this.appendJournal({
      type: 'node/entered',
      graphId: graph.id,
      nodeId: node.id,
      nodeType: node.type,
      instanceId,
    })

    switch (node.type) {
      case 'TASK':
        this.activeNodes.push({
          instanceId,
          graphId: graph.id,
          nodeId: node.id,
          nodeType: 'TASK',
          taskRef: node.taskRef,
          expectedResult: node.expectedResult,
          ...(activation.branch === undefined
            ? {}
            : {
              barrierId: activation.branch.barrierId,
              branchIndex: activation.branch.branchIndex,
            }),
        })
        return []
      case 'SEQUENCE':
        this.appendCompletion(graph.id, node, instanceId)
        return this.routeEdge(
          graph.id,
          node,
          instanceId,
          this.requireAlwaysEdge(graph, node),
          activation.branch,
        )
      case 'PARALLEL':
        return this.activateParallel(graph, node, instanceId, activation)
      case 'CONDITION':
        return this.activateCondition(graph, node, instanceId, activation)
      case 'LOOP':
        return this.activateLoop(graph, node, instanceId, activation)
      case 'SUBWORKFLOW':
        return this.activateSubworkflow(graph, node, instanceId, activation)
      case 'TERMINAL':
        return this.activateTerminal(graph, node, instanceId)
    }
  }

  private activateParallel(
    graph: WorkflowControlGraph,
    node: Extract<WorkflowControlNode, { type: 'PARALLEL' }>,
    instanceId: string,
    activation: PendingActivation,
  ): PendingActivation[] {
    if (activation.branch !== undefined) {
      throw new WorkflowControlError(
        `parallel node "${node.id}" cannot nest inside an unresolved parallel branch`,
        'INVALID_TRANSITION',
      )
    }
    const outgoing = this.outgoingEdges(graph, node)
    this.appendCompletion(graph.id, node, instanceId)
    this.parallelBarriers.push({
      id: instanceId,
      graphId: graph.id,
      nodeId: node.id,
      joinNodeId: node.joinNodeId,
      branchCount: outgoing.length,
      arrivedBranchIndexes: [],
    })
    return outgoing.flatMap((edge, branchIndex) => {
      this.appendEdgeSelection(graph.id, node, instanceId, edge)
      return this.routeTarget(graph.id, edge.to, {
        barrierId: instanceId,
        branchIndex,
      })
    })
  }

  private activateCondition(
    graph: WorkflowControlGraph,
    node: Extract<WorkflowControlNode, { type: 'CONDITION' }>,
    instanceId: string,
    activation: PendingActivation,
  ): PendingActivation[] {
    this.appendCompletion(graph.id, node, instanceId)
    const verification = this.lastVerification
    if (verification === undefined) {
      throw new WorkflowControlError(
        `condition node "${node.id}" has no verification result`,
        'INVALID_TRANSITION',
      )
    }
    const edge = requireValue(this.outgoingEdges(graph, node).find((candidate) => {
      return candidate.condition.kind === 'VERIFICATION_STATUS'
        && candidate.condition.status === verification.status
    }), `condition node "${node.id}" has no edge for ${verification.status}`)
    this.appendEdgeSelection(graph.id, node, instanceId, edge)
    return this.routeTarget(graph.id, edge.to, activation.branch)
  }

  private activateLoop(
    graph: WorkflowControlGraph,
    node: Extract<WorkflowControlNode, { type: 'LOOP' }>,
    instanceId: string,
    activation: PendingActivation,
  ): PendingActivation[] {
    this.appendCompletion(graph.id, node, instanceId)
    const state = this.requireLoopState(graph.id, node)
    const verification = this.lastVerification
    if (verification === undefined || verification.status === 'PASS') {
      throw new WorkflowControlError(
        `loop node "${node.id}" requires a non-passing verification result`,
        'INVALID_TRANSITION',
      )
    }

    let result: WorkflowLoopResult
    let reason: WorkflowEscalationReason | undefined
    if (state.iterations >= node.maxIterations) {
      result = 'EXHAUSTED'
      reason = 'MAX_REPAIR_ROUNDS'
      this.escalationReason = reason
    } else if (verification.repeated && verification.strategySwitchAvailable !== true) {
      result = 'EXHAUSTED'
      reason = 'REPEATED_FAILURE'
      this.escalationReason = reason
    } else {
      state.iterations += 1
      result = 'CONTINUE'
    }

    this.appendJournal({
      type: 'loop/evaluated',
      graphId: graph.id,
      nodeId: node.id,
      instanceId,
      round: state.iterations,
      result,
      ...(reason === undefined ? {} : { escalationReason: reason }),
    })
    const edge = requireValue(this.outgoingEdges(graph, node).find((candidate) => {
      return candidate.condition.kind === 'LOOP_RESULT' && candidate.condition.result === result
    }), `loop node "${node.id}" has no ${result} edge`)
    this.appendEdgeSelection(graph.id, node, instanceId, edge)
    return this.routeTarget(graph.id, edge.to, activation.branch)
  }

  private activateSubworkflow(
    graph: WorkflowControlGraph,
    node: Extract<WorkflowControlNode, { type: 'SUBWORKFLOW' }>,
    instanceId: string,
    activation: PendingActivation,
  ): PendingActivation[] {
    this.appendJournal({
      type: 'subworkflow/entered',
      graphId: graph.id,
      nodeId: node.id,
      instanceId,
      childGraphId: node.graphId,
    })
    const child = this.requireGraph(node.graphId)
    this.frames.push({
      graphId: child.id,
      parent: {
        instanceId,
        nodeId: node.id,
        ...(activation.branch === undefined
          ? {}
          : {
            barrierId: activation.branch.barrierId,
            branchIndex: activation.branch.branchIndex,
          }),
      },
    })
    return [{ graphId: child.id, nodeId: child.entryNodeId }]
  }

  private activateTerminal(
    graph: WorkflowControlGraph,
    node: Extract<WorkflowControlNode, { type: 'TERMINAL' }>,
    instanceId: string,
  ): PendingActivation[] {
    this.appendCompletion(graph.id, node, instanceId)
    if (node.status === 'ESCALATED') {
      return this.completeEscalated(node)
    }
    if (this.frames.length === 1) {
      this.status = 'PASSED'
      this.activeNodes = []
      this.parallelBarriers = []
      this.appendJournal({
        type: 'run/terminal',
        status: 'PASSED',
      })
      return []
    }

    const child = requireValue(this.frames.pop(), 'subworkflow frame has no child graph')
    const parent = requireValue(child.parent, 'subworkflow frame has no parent call site')
    const parentGraph = requireValue(
      this.frames[this.frames.length - 1],
      'subworkflow has no parent graph',
    )
    this.appendJournal({
      type: 'subworkflow/exited',
      graphId: parentGraph.graphId,
      nodeId: parent.nodeId,
      instanceId: parent.instanceId,
      childGraphId: child.graphId,
    })
    const parentNode = this.requireNode(parentGraph.graphId, parent.nodeId)
    this.appendCompletion(parentGraph.graphId, parentNode, parent.instanceId)
    const edge = this.requireAlwaysEdge(this.requireGraph(parentGraph.graphId), parentNode)
    return this.routeEdge(
      parentGraph.graphId,
      parentNode,
      parent.instanceId,
      edge,
      this.parentBranch(parent),
    )
  }

  private completeEscalated(
    node: Extract<WorkflowControlNode, { type: 'TERMINAL' }>,
  ): PendingActivation[] {
    if (this.escalationReason === undefined) {
      throw new WorkflowControlError(
        `terminal node "${node.id}" requires an escalation reason`,
        'INVALID_TRANSITION',
      )
    }
    this.status = 'ESCALATED'
    this.activeNodes = []
    this.parallelBarriers = []
    this.appendJournal({
      type: 'run/terminal',
      status: 'ESCALATED',
      escalationReason: this.escalationReason,
    })
    return []
  }

  private routeEdge(
    graphId: string,
    node: WorkflowControlNode,
    instanceId: string,
    edge: WorkflowControlEdge,
    branch: BranchMembership | undefined,
  ): PendingActivation[] {
    this.appendEdgeSelection(graphId, node, instanceId, edge)
    return this.routeTarget(graphId, edge.to, branch)
  }

  private routeTarget(
    graphId: string,
    targetNodeId: string,
    branch: BranchMembership | undefined,
  ): PendingActivation[] {
    if (branch === undefined) return [{ graphId, nodeId: targetNodeId }]
    const barrierIndex = this.parallelBarriers.findIndex(barrier => barrier.id === branch.barrierId)
    const barrier = requireValue(
      this.parallelBarriers[barrierIndex],
      `parallel barrier "${branch.barrierId}" does not exist`,
    )
    if (targetNodeId !== barrier.joinNodeId) {
      return [{ graphId, nodeId: targetNodeId, branch }]
    }
    barrier.arrivedBranchIndexes.push(branch.branchIndex)
    if (barrier.arrivedBranchIndexes.length !== barrier.branchCount) return []
    this.parallelBarriers.splice(barrierIndex, 1)
    return [{ graphId, nodeId: barrier.joinNodeId }]
  }

  private requireLoopState(
    graphId: string,
    node: Extract<WorkflowControlNode, { type: 'LOOP' }>,
  ): WorkflowLoopState {
    const existing = this.loopStates.find(state => state.graphId === graphId && state.nodeId === node.id)
    if (existing !== undefined) return existing
    const created: WorkflowLoopState = {
      graphId,
      nodeId: node.id,
      iterations: 0,
      maxIterations: node.maxIterations,
    }
    this.loopStates.push(created)
    return created
  }

  private activeBranch(active: ActiveWorkflowControlNode): BranchMembership | undefined {
    if (active.barrierId === undefined || active.branchIndex === undefined) return undefined
    return { barrierId: active.barrierId, branchIndex: active.branchIndex }
  }

  private parentBranch(parent: NonNullable<WorkflowControlFrame['parent']>): BranchMembership | undefined {
    if (parent.barrierId === undefined || parent.branchIndex === undefined) return undefined
    return { barrierId: parent.barrierId, branchIndex: parent.branchIndex }
  }

  private requireAlwaysEdge(
    graph: WorkflowControlGraph,
    node: WorkflowControlNode,
  ): WorkflowControlEdge {
    const edges = this.outgoingEdges(graph, node).filter(edge => edge.condition.kind === 'ALWAYS')
    return requireValue(edges[0], `node "${node.id}" requires exactly one ALWAYS edge`)
  }

  private outgoingEdges(
    graph: WorkflowControlGraph,
    node: WorkflowControlNode,
  ): WorkflowControlEdge[] {
    return graph.edges.filter(edge => edge.from === node.id)
  }

  private appendCompletion(
    graphId: string,
    node: WorkflowControlNode,
    instanceId: string,
  ): void {
    this.appendJournal({
      type: 'node/completed',
      graphId,
      nodeId: node.id,
      nodeType: node.type,
      instanceId,
    })
  }

  private appendEdgeSelection(
    graphId: string,
    node: WorkflowControlNode,
    instanceId: string,
    edge: WorkflowControlEdge,
  ): void {
    this.appendJournal({
      type: 'edge/selected',
      graphId,
      nodeId: node.id,
      instanceId,
      edgeId: edge.id,
      condition: edge.condition,
    })
  }

  private appendJournal(entry: WorkflowControlJournalDraft): void {
    const parsed = workflowControlJournalEntrySchema.parse({
      ...entry,
      seq: this.journal.length + 1,
    })
    this.journal.push(parsed)
  }

  private nextInstanceId(nodeId: string): string {
    const ordinal = this.nextInstanceOrdinal
    this.nextInstanceOrdinal += 1
    return `${nodeId}@${String(ordinal)}`
  }

  private requireGraph(graphId: string): WorkflowControlGraph {
    return requireValue(this.graphsById.get(graphId), `control graph "${graphId}" does not exist`)
  }

  private requireNode(graphId: string, nodeId: string): WorkflowControlNode {
    const graph = requireValue(
      this.nodesByGraphId.get(graphId),
      `control graph "${graphId}" does not exist`,
    )
    return requireValue(graph.get(nodeId), `control node "${graphId}/${nodeId}" does not exist`)
  }
}

/**
 * Parse and validate one workflow control snapshot against its versioned schema.
 * @param input - durable snapshot candidate.
 * @returns a detached validated snapshot.
 * @throws {WorkflowControlError} with `INVALID_SNAPSHOT` when validation fails.
 */
export function parseWorkflowControlSnapshot(input: unknown): WorkflowControlSnapshot {
  const parsed = workflowControlSnapshotSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkflowControlError(
      `Invalid workflow control snapshot: ${formatZodIssues(parsed.error.issues)}`,
      'INVALID_SNAPSHOT',
    )
  }
  return parsed.data
}

function captureSnapshot(
  definition: WorkflowDefinition,
  fields: RuntimeFields,
): WorkflowControlSnapshot {
  return parseWorkflowControlSnapshot({
    snapshotVersion: WORKFLOW_CONTROL_SNAPSHOT_VERSION,
    definition,
    status: fields.status,
    revision: fields.journal.length,
    frames: fields.frames,
    activeNodes: fields.activeNodes,
    parallelBarriers: fields.parallelBarriers,
    loopStates: fields.loopStates,
    seenFailureSignatures: fields.seenFailureSignatures,
    lastVerification: fields.lastVerification,
    repairRound: fields.loopStates.reduce((maximum, state) => Math.max(maximum, state.iterations), 0),
    escalationReason: fields.escalationReason,
    nextInstanceOrdinal: fields.nextInstanceOrdinal,
    journal: fields.journal,
  })
}

function validateSnapshotConsistency(snapshot: WorkflowControlSnapshot): void {
  if (snapshot.revision !== snapshot.journal.length) {
    invalidSnapshot(
      `snapshot revision ${snapshot.revision} does not match ${snapshot.journal.length} journal entries`,
    )
  }
  for (const [index, entry] of snapshot.journal.entries()) {
    if (entry.seq !== index + 1) {
      invalidSnapshot(
        `journal entry ${index} has sequence ${entry.seq}, expected ${index + 1}`,
      )
    }
  }
  if (snapshot.status === 'RUNNING' && snapshot.journal.some(entry => entry.type === 'run/terminal')) {
    invalidSnapshot('running snapshot contains a terminal journal entry')
  }
  if (snapshot.status !== 'RUNNING' && snapshot.activeNodes.length > 0) {
    invalidSnapshot('terminal snapshot still has active task nodes')
  }
  const expectedRepairRound = snapshot.loopStates.reduce(
    (maximum, state) => Math.max(maximum, state.iterations),
    0,
  )
  if (snapshot.repairRound !== expectedRepairRound) {
    invalidSnapshot(
      `snapshot repair round ${snapshot.repairRound} does not match loop state`,
    )
  }
  const graphs = new Map(snapshot.definition.graphs.map(graph => [graph.id, graph]))
  const nodes = new Map(snapshot.definition.graphs.map((graph) => {
    return [graph.id, new Map(graph.nodes.map(node => [node.id, node]))]
  }))
  for (const [index, frame] of snapshot.frames.entries()) {
    if (!graphs.has(frame.graphId)) {
      invalidSnapshot(`snapshot frame references missing graph "${frame.graphId}"`)
    }
    if (index === 0 && frame.parent !== undefined) {
      invalidSnapshot('root snapshot frame cannot have a parent')
    }
    if (index > 0 && frame.parent === undefined) {
      invalidSnapshot(`snapshot frame ${index} has no parent call site`)
    }
    if (frame.parent !== undefined) {
      const parentFrame = snapshot.frames[index - 1]
      const parentNode = parentFrame === undefined
        ? undefined
        : nodes.get(parentFrame.graphId)?.get(frame.parent.nodeId)
      if (parentNode?.type !== 'SUBWORKFLOW') {
        invalidSnapshot(`snapshot frame ${index} does not point at a subworkflow node`)
      }
      if (parentNode.graphId !== frame.graphId) {
        invalidSnapshot(`snapshot frame ${index} enters graph "${frame.graphId}" from "${parentNode.graphId}"`)
      }
    }
  }
  const instanceIds = new Set<string>()
  for (const active of snapshot.activeNodes) {
    if (instanceIds.has(active.instanceId)) {
      invalidSnapshot(
        `snapshot repeats active instance "${active.instanceId}"`,
      )
    }
    instanceIds.add(active.instanceId)
    const node = nodes.get(active.graphId)?.get(active.nodeId)
    if (node?.type !== 'TASK') {
      invalidSnapshot(`snapshot active node "${active.graphId}/${active.nodeId}" is not a task`)
    }
    if (node.taskRef !== active.taskRef || node.expectedResult !== active.expectedResult) {
      invalidSnapshot(`snapshot active task "${active.instanceId}" does not match its definition`)
    }
    if ((active.barrierId === undefined) !== (active.branchIndex === undefined)) {
      invalidSnapshot(`snapshot active task "${active.instanceId}" has incomplete branch membership`)
    }
  }
  const barrierIds = new Set<string>()
  for (const barrier of snapshot.parallelBarriers) {
    if (barrierIds.has(barrier.id)) {
      invalidSnapshot(`snapshot repeats parallel barrier "${barrier.id}"`)
    }
    barrierIds.add(barrier.id)
    const node = nodes.get(barrier.graphId)?.get(barrier.nodeId)
    if (node?.type !== 'PARALLEL' || node.joinNodeId !== barrier.joinNodeId) {
      invalidSnapshot(`snapshot barrier "${barrier.id}" does not match its parallel node`)
    }
    if (barrier.arrivedBranchIndexes.some(index => index >= barrier.branchCount)) {
      invalidSnapshot(`snapshot barrier "${barrier.id}" contains an out-of-range branch`)
    }
  }
  for (const active of snapshot.activeNodes) {
    if (active.barrierId === undefined) continue
    const barrier = snapshot.parallelBarriers.find(candidate => candidate.id === active.barrierId)
    if (barrier === undefined || active.branchIndex === undefined) {
      invalidSnapshot(`snapshot active task "${active.instanceId}" has no active parallel barrier`)
    }
    if (active.branchIndex >= barrier.branchCount) {
      invalidSnapshot(`snapshot active task "${active.instanceId}" has an out-of-range branch`)
    }
  }
  const loopKeys = new Set<string>()
  for (const state of snapshot.loopStates) {
    const key = `${state.graphId}/${state.nodeId}`
    if (loopKeys.has(key)) invalidSnapshot(`snapshot repeats loop state "${key}"`)
    loopKeys.add(key)
    const node = nodes.get(state.graphId)?.get(state.nodeId)
    if (node?.type !== 'LOOP' || node.maxIterations !== state.maxIterations) {
      invalidSnapshot(`snapshot loop state "${key}" does not match its loop node`)
    }
  }
  const maximumOrdinal = snapshot.journal.reduce((maximum, entry) => {
    if (!('instanceId' in entry)) return maximum
    const separator = entry.instanceId.lastIndexOf('@')
    return Math.max(maximum, Number(entry.instanceId.slice(separator + 1)))
  }, 0)
  if (snapshot.nextInstanceOrdinal <= maximumOrdinal) {
    invalidSnapshot(
      `next instance ordinal ${snapshot.nextInstanceOrdinal} was already used`,
    )
  }
}

function invalidSnapshot(message: string): never {
  throw new WorkflowControlError(message, 'INVALID_SNAPSHOT')
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new WorkflowControlError(message, 'INVALID_TRANSITION')
  return value
}

function validateWorkflowDefinition(
  value: WorkflowDefinitionBase,
  context: z.RefinementCtx,
): void {
  const graphById = new Map<string, WorkflowGraphValue>()
  for (const [graphIndex, graph] of value.graphs.entries()) {
    if (graphById.has(graph.id)) {
      addDefinitionIssue(context, ['graphs', graphIndex, 'id'], `duplicate graph id "${graph.id}"`)
      continue
    }
    graphById.set(graph.id, graph)
  }
  if (!graphById.has(value.entryGraphId)) {
    addDefinitionIssue(
      context,
      ['entryGraphId'],
      `entry graph "${value.entryGraphId}" does not exist`,
    )
  }

  for (const [graphIndex, graph] of value.graphs.entries()) {
    validateGraph(graph, graphIndex, graphById, context)
  }
  validateSubworkflowCycles(value, graphById, context)
}

function validateGraph(
  graph: WorkflowGraphValue,
  graphIndex: number,
  graphById: ReadonlyMap<string, WorkflowGraphValue>,
  context: z.RefinementCtx,
): void {
  const graphPath = ['graphs', graphIndex] as const
  const nodeById = new Map<string, WorkflowControlNodeValue>()
  const edgeIds = new Set<string>()
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    if (nodeById.has(node.id)) {
      addDefinitionIssue(
        context,
        [...graphPath, 'nodes', nodeIndex, 'id'],
        `duplicate node id "${node.id}"`,
      )
      continue
    }
    nodeById.set(node.id, node)
  }
  for (const [edgeIndex, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      addDefinitionIssue(
        context,
        [...graphPath, 'edges', edgeIndex, 'id'],
        `duplicate edge id "${edge.id}"`,
      )
    }
    edgeIds.add(edge.id)
    if (!nodeById.has(edge.from)) {
      addDefinitionIssue(
        context,
        [...graphPath, 'edges', edgeIndex, 'from'],
        `edge "${edge.id}" starts at missing node "${edge.from}"`,
      )
    }
    if (!nodeById.has(edge.to)) {
      addDefinitionIssue(
        context,
        [...graphPath, 'edges', edgeIndex, 'to'],
        `edge "${edge.id}" ends at missing node "${edge.to}"`,
      )
    }
  }
  if (!nodeById.has(graph.entryNodeId)) {
    addDefinitionIssue(
      context,
      [...graphPath, 'entryNodeId'],
      `entry node "${graph.entryNodeId}" does not exist`,
    )
  }
  for (const [nodeIndex, node] of graph.nodes.entries()) {
    validateNodeEdges(
      graph,
      node,
      [...graphPath, 'nodes', nodeIndex],
      nodeById,
      graphById,
      context,
    )
  }
}

function validateNodeEdges(
  graph: WorkflowGraphValue,
  node: WorkflowControlNodeValue,
  nodePath: readonly PropertyKey[],
  nodeById: ReadonlyMap<string, WorkflowControlNodeValue>,
  graphById: ReadonlyMap<string, WorkflowGraphValue>,
  context: z.RefinementCtx,
): void {
  const outgoing = graph.edges.filter(edge => edge.from === node.id)
  switch (node.type) {
    case 'TASK':
      validateAllAlways(node, outgoing, nodePath, context)
      return
    case 'SEQUENCE':
      if (outgoing.length !== 1 || outgoing[0]?.condition.kind !== 'ALWAYS') {
        addDefinitionIssue(
          context,
          [...nodePath, 'type'],
          `SEQUENCE node "${node.id}" requires exactly one ALWAYS edge`,
        )
      }
      return
    case 'PARALLEL':
      validateParallelEdges(node, outgoing, nodeById, nodePath, context)
      return
    case 'CONDITION':
      validateConditionEdges(node, outgoing, nodePath, context)
      return
    case 'LOOP':
      validateLoopEdges(node, outgoing, nodePath, context)
      return
    case 'SUBWORKFLOW':
      if (!graphById.has(node.graphId)) {
        addDefinitionIssue(
          context,
          [...nodePath, 'graphId'],
          `subworkflow graph "${node.graphId}" does not exist`,
        )
      }
      if (outgoing.length !== 1 || outgoing[0]?.condition.kind !== 'ALWAYS') {
        addDefinitionIssue(
          context,
          [...nodePath, 'type'],
          `SUBWORKFLOW node "${node.id}" requires exactly one ALWAYS edge`,
        )
      }
      return
    case 'TERMINAL':
      if (outgoing.length > 0) {
        addDefinitionIssue(
          context,
          [...nodePath, 'type'],
          `TERMINAL node "${node.id}" cannot have outgoing edges`,
        )
      }
      return
  }
}

function validateAllAlways(
  node: WorkflowControlNodeValue,
  outgoing: readonly WorkflowControlEdge[],
  nodePath: readonly PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (outgoing.some(edge => edge.condition.kind !== 'ALWAYS')) {
    addDefinitionIssue(
      context,
      nodePath,
      `TASK node "${node.id}" only supports ALWAYS edges`,
    )
  }
}

function validateParallelEdges(
  node: Extract<WorkflowControlNodeValue, { type: 'PARALLEL' }>,
  outgoing: readonly WorkflowControlEdge[],
  nodeById: ReadonlyMap<string, WorkflowControlNodeValue>,
  nodePath: readonly PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (outgoing.length < 2 || outgoing.some(edge => edge.condition.kind !== 'ALWAYS')) {
    addDefinitionIssue(
      context,
      nodePath,
      `PARALLEL node "${node.id}" requires at least two ALWAYS edges`,
    )
  }
  if (!nodeById.has(node.joinNodeId)) {
    addDefinitionIssue(
      context,
      [...nodePath, 'joinNodeId'],
      `parallel join "${node.joinNodeId}" does not exist`,
    )
  }
  const targets = outgoing.map(edge => edge.to)
  if (new Set(targets).size !== targets.length) {
    addDefinitionIssue(
      context,
      nodePath,
      `PARALLEL node "${node.id}" requires distinct branch targets`,
    )
  }
}

function validateConditionEdges(
  node: Extract<WorkflowControlNodeValue, { type: 'CONDITION' }>,
  outgoing: readonly WorkflowControlEdge[],
  nodePath: readonly PropertyKey[],
  context: z.RefinementCtx,
): void {
  const statuses = new Set<WorkflowVerificationStatus>()
  for (const edge of outgoing) {
    if (edge.condition.kind !== 'VERIFICATION_STATUS') {
      addDefinitionIssue(
        context,
        nodePath,
        `CONDITION node "${node.id}" only supports verification edges`,
      )
      continue
    }
    if (statuses.has(edge.condition.status)) {
      addDefinitionIssue(
        context,
        nodePath,
        `CONDITION node "${node.id}" repeats status ${edge.condition.status}`,
      )
    }
    statuses.add(edge.condition.status)
  }
  for (const status of workflowVerificationStatusSchema.options) {
    if (!statuses.has(status)) {
      addDefinitionIssue(
        context,
        nodePath,
        `CONDITION node "${node.id}" is missing ${status}`,
      )
    }
  }
}

function validateLoopEdges(
  node: Extract<WorkflowControlNodeValue, { type: 'LOOP' }>,
  outgoing: readonly WorkflowControlEdge[],
  nodePath: readonly PropertyKey[],
  context: z.RefinementCtx,
): void {
  for (const result of workflowLoopResultSchema.options) {
    const matching = outgoing.filter((edge) => {
      return edge.condition.kind === 'LOOP_RESULT' && edge.condition.result === result
    })
    if (matching.length !== 1) {
      addDefinitionIssue(
        context,
        nodePath,
        `LOOP node "${node.id}" requires exactly one ${result} edge`,
      )
    }
  }
  if (outgoing.some(edge => edge.condition.kind !== 'LOOP_RESULT')) {
    addDefinitionIssue(
      context,
      nodePath,
      `LOOP node "${node.id}" only supports loop-result edges`,
    )
  }
}

function validateSubworkflowCycles(
  value: WorkflowDefinitionBase,
  graphById: ReadonlyMap<string, WorkflowGraphValue>,
  context: z.RefinementCtx,
): void {
  const states = new Map<string, 'visiting' | 'visited'>()
  const visit = (graphId: string, path: readonly PropertyKey[]): void => {
    const state = states.get(graphId)
    if (state === 'visited') return
    if (state === 'visiting') {
      addDefinitionIssue(context, path, `subworkflow cycle includes graph "${graphId}"`)
      return
    }
    const graph = graphById.get(graphId)
    if (graph === undefined) return
    states.set(graphId, 'visiting')
    for (const node of graph.nodes) {
      if (node.type !== 'SUBWORKFLOW') continue
      visit(node.graphId, [...path, node.id])
    }
    states.set(graphId, 'visited')
  }
  visit(value.entryGraphId, ['entryGraphId'])
}

function addDefinitionIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string,
): void {
  context.addIssue({
    code: 'custom',
    path: [...path],
    message,
  })
}

function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.slice(0, 8).map((issue) => {
    const path = issue.path.length === 0 ? '<root>' : issue.path.map(String).join('.')
    return `${path}: ${issue.message}`
  }).join('; ')
}
