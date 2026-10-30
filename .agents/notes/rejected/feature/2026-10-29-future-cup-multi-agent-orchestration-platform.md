# Agent Note: Future Cup multi-agent orchestration platform

Status: rejected — superseded by the [web frontend engineering plan](../../proposed/feature/2026-10-30-future-cup-web-frontend-agent-platform.md).

English | [中文](2026-10-29-future-cup-multi-agent-orchestration-platform.zh.md)

## Problem

The Future Cup competition asks for a complete engineering platform for tool orchestration and scheduling by large-model agents. The platform is evaluated across knowledge-base definition and integration, Agent team definition, workflow orchestration, dynamic scheduling, self-loop execution, and result verification with feedback optimization. A single Agent that calls tools, an API wrapper, a slide-only concept, or an unmodified framework demonstration cannot satisfy the submission rules.

DeepSeek Harness already supplies concurrent Sessions, isolated subagent Sessions, experimental Agent Teams with a Lead, teammates, a shared task DAG, and direct mailbox delivery, plus a Session event log that supports rewind and fork. It does not supply a quality-verification system, a scheduling policy that reacts to context pressure and Agent capabilities, a bounded repair loop, or a product interface for composing and observing those mechanisms.

The project needs a durable record of the competition constraints, the chosen technical direction, the candidate business scenarios, and the MVP order before implementation starts. Without that record, later work can drift into a framework demo, overbuild the product shell before the repair loop works, or optimize a scenario whose success cannot be verified objectively.

## Proposal

Build the competition platform as a set of Cordis plugins and product surfaces on DeepSeek Harness. Keep the native Session log, subagent, and Agent Teams mechanisms as the execution foundation. Add a scheduler, verification pipeline, bounded self-loop, workflow editor, live sandbox, and execution trace around those mechanisms rather than replacing them with a separate orchestrator.

The platform must use multiple Agents with distinct roles and independent Sessions. The Lead owns decomposition, scheduling decisions, and the final assembly. Teammates implement or inspect bounded tasks. A Verifier Agent reviews evidence that deterministic checks cannot fully judge. Communication and transitions remain observable through durable Team task and Session records.

Any repository published for the competition must state which parts come from the upstream DeepSeek Harness project and identify every modification and added innovation. The repository must include deployment instructions, test cases, and a reproducible demonstration path. Credentials are loaded from environment variables, never committed.

### Competition constraints

- The deliverable is a multi-Agent orchestration platform, not a single-Agent tool-call demonstration or a thin model API wrapper.
- A runnable prototype is mandatory; concept decks and pseudocode are insufficient.
- At least one self-loop must execute a real validation and correction cycle.
- Knowledge-base integration, Agent team definition, workflow orchestration, dynamic scheduling, self-loop execution, verification, and feedback optimization must be represented in the product.
- The submission includes a technical proposal of at least 5,000 Chinese characters, a 10-15 page slide deck, a 3-5 minute end-to-end demonstration video, and a reproducible repository with deployment documentation and tests.

### Platform capabilities

- **Knowledge base:** Define project knowledge, tool contracts, coding rules, verification evidence, and retrieval sources as platform resources. The initial implementation uses workspace documents and test fixtures; a later adapter can connect an external RAG index.
- **Agent team:** Define roles, models, skills, tool permissions, context budgets, and handoff rules for the Lead, workers, reviewers, and specialized Verifier.
- **Workflow orchestration:** Represent work as a DAG whose nodes declare inputs, outputs, dependencies, owner requirements, and validation criteria. A visual editor authors the DAG, while the runtime uses the durable Team task records as its source of truth.
- **Dynamic scheduling:** Select runnable nodes by Agent skill fit, current context use, concurrency capacity, dependency readiness, and prior failures. The scheduler can add focused repair nodes, reassign work, or prune nodes whose outputs are no longer needed.
- **Self-loop:** Run bounded local repair inside a teammate Session, then escalate unresolved work to the Lead for broader replanning or rewind.
- **Verification and feedback:** Combine static checks, sandbox execution evidence, deterministic tests, and a Verifier Agent. Store verdicts and repair evidence so later scheduling decisions use observed outcomes.

### Adaptive scheduling

The scheduler admits runnable DAG nodes into a bounded concurrency pool. It ranks candidates using declared Agent skill fit, token-context occupancy, dependency criticality, historical success, and the cost of another repair attempt. An Agent above its context watermark receives no new implementation work until it compacts, forks, or hands the task to a better-fit teammate.

Runtime changes remain explicit and logged. When verification invalidates a branch, the scheduler prunes downstream nodes that depended on the rejected output, requeues affected work, and records why the DAG changed. Replanning is not a hidden retry loop; each node addition, reassignment, suppression, or rollback must be reconstructable from Session events and Team task revisions.

### Verification and self-loop

Verification uses complementary evidence. Static analysis catches syntax, type, schema, and policy errors before execution. A sandbox runs the generated artifact and captures exit codes, stdout, stderr, browser console errors, failed requests, and preview state. An independent Verifier Agent reviews the task requirements against the collected evidence and can fail work that merely runs successfully without satisfying the requested behavior.

The micro-loop runs inside the owning teammate Session. Validation failures return structured evidence to that teammate for up to three repairs. A successful repair proceeds to the next validation stage; exhaustion, timeout, or three consecutive equivalent failures stops the local loop.

The macro-loop belongs to the Lead. It receives the failed evidence, rewinds or forks the execution path when needed, changes the task decomposition or Agent assignment, and sends a new bounded task through the mailbox. A Loop Guard enforces attempt, wall-clock, token, and no-progress limits. It raises a visible terminal failure instead of allowing an unbounded retry cycle.

Feedback optimization uses the persisted verification history. The scheduler can deprioritize an Agent or strategy with repeated failures for the same failure signature and can prefer a successful repair path discovered in an earlier fork. This is an observed scheduling signal, not an opaque learned model in the MVP.

### Product interface

The product presents three linked surfaces. A React Flow canvas edits the Agent team and workflow DAG. A sandbox panel shows the generated page or application, hot reloads accepted revisions, and exposes captured runtime errors. An execution trace shows task ownership, mailbox handoffs, validation verdicts, repair attempts, rewinds, forks, and final assembly in chronological order.

The visual editor does not become a second source of truth. It submits and renders the durable workflow state owned by the Host. The trace and preview derive from execution and Session evidence, so a refreshed client can reconstruct what happened.

### Candidate scenario and MVP

The preferred scenario is a micro-frontend and operations H5 orchestration platform. A user enters a page requirement; multiple Agents produce component code and integration code; the sandbox renders the result; a deliberately injected runtime error produces a white screen or console failure; the Verifier rejects the revision; the micro-loop repairs it or the macro-loop rewinds and reassigns it; the repaired page hot reloads successfully. The visual result and the captured failure-to-success transition make this the strongest competition demonstration.

Three fallback scenarios retain objective validation signals:

- An enterprise microservice vulnerability locator uses failing unit-test exit codes and targeted test evidence as the rejection signal before sending code back for repair.
- A listed-company financial report analysis platform uses accounting identities, cross-statement consistency rules, and cited RAG evidence to reject unsupported findings.
- A major-project tender qualification reviewer applies disqualifying-clause checks and requires the self-loop to complete missing evidence without overriding a one-vote veto.

The MVP uses the preferred scenario. Other scenarios remain available after the core loop is stable and are not implemented in parallel before qualification.

### Delivery order

The tactical goal is to pass the initial round with a small, reliable demonstration. The implementation order is:

1. Compose the existing Agent Teams profile and prove a Lead, at least two role-distinct teammates, and a Verifier can complete one workflow with isolated Sessions.
2. Add deterministic validation and sandbox evidence capture to the worker-to-verifier path.
3. Implement the three-attempt micro-loop, Loop Guard, mailbox escalation, and one rewind or reassignment path.
4. Add the minimal execution trace and sandbox preview needed to make the failure, repair, and recovery visible.
5. Add the React Flow authoring surface, knowledge and team definition forms, deployment documentation, tests, technical proposal, slide deck, and demonstration video.

Front-end breadth and document polish follow a working end-to-end loop. They do not precede evidence that the platform can reject bad output, repair it under a bound, and show the recovery.

## Alternatives considered

**Wrap one model with tools and present the result as an Agent platform.** Rejected because the competition explicitly excludes a single-Agent call path or API shell, and the submission cannot demonstrate team coordination, scheduling, or a meaningful self-loop.

**Submit the default Agent Teams example with cosmetic changes.** Rejected because it supplies coordination primitives but no quality verifier, context-aware scheduling policy, loop bound, product workflow, or stated modification set. It also conflicts with the requirement to disclose meaningful changes to an open-source base.

**Build a separate orchestrator from scratch.** Rejected because DeepSeek Harness already owns durable Sessions, subagents, Team tasks, inbox delivery, and rewind/fork behavior. Replacing them would increase implementation risk and weaken the traceability of the demonstration.

**Implement all four business scenarios for the initial round.** Rejected because the scenarios require different validation tools, domain knowledge, and user interfaces. A broad but shallow platform is less convincing than one complete failure-to-recovery demonstration with a stable test path.

**Start with the full visual platform before the repair loop works.** Rejected because a polished canvas without a functioning verifier and bounded recovery would still fail the core technical evaluation. The loop and its evidence come first; the interface then exposes that proven behavior.

**Retry indefinitely until the model eventually succeeds.** Rejected because repeated equivalent errors consume time and tokens without guaranteeing progress. The platform requires a visible no-progress bound and an escalated terminal state.

## Acceptance criteria

- The reproducible demo starts from a declared page requirement, creates a Lead and at least two distinct teammates, executes a DAG, and assembles the result without exposing parent and child contexts to cross-contamination.
- A deterministic injected defect is rejected by static or runtime evidence, reaches the owning teammate with a structured report, and triggers at most three local repair attempts.
- When repair continues to fail, the Loop Guard stops local retries, records the failure signature, escalates through the Team mailbox, and performs or schedules exactly one bounded rewind, fork, or reassignment path.
- The repaired artifact reaches a successful sandbox preview, and the execution trace reconstructs ownership, task revisions, mailbox handoffs, validation evidence, repair attempts, rewinds or forks, and final success.
- Dynamic scheduling decisions expose the selected Agent, context-watermark evidence, dependency readiness, concurrency state, and the reason for node addition, pruning, or reassignment.
- Tests cover successful validation, repairable failure, exhausted repair, repeated-error circuit breaking, dependency pruning, and client reconstruction from durable state.
- The repository clearly labels upstream and modified code, contains no committed credentials, and documents installation, environment configuration, tests, and the demonstration flow.
- The final submission contains the required technical proposal, 10-15 page slide deck, 3-5 minute demonstration video, and complete reproducible repository.

## Risks

- Agent Teams and related Session APIs are experimental and can change. The competition branch needs a pinned upstream revision and explicit adaptation tests.
- Browser console capture and preview recovery can be timing-sensitive. The demo needs a deterministic injected fault and evidence collection that does not depend on transient animation timing.
- Skill-fit and token-watermark scores can appear algorithmic without improving outcomes. The MVP must show measurable scheduling effects such as fewer context-overflow failures or faster completion on a fixed benchmark.
- Three repair attempts can be too restrictive for a complex task. The bound is a competition safety default and must be configurable by deployment rather than silently changed in plugin code.
- A Verifier Agent can approve plausible but incorrect output. Deterministic checks remain authoritative where available, and the Agent verdict must cite the evidence it reviewed.
- Four candidate domains can fragment implementation effort. Only the preferred micro-frontend scenario belongs in the initial end-to-end path.
- The initial-round schedule is short. Deliverables, tests, and the recorded demonstration are acceptance work, not post-code cleanup.
