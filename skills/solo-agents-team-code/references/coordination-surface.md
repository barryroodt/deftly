# Coordination Surface

Load this reference only when an exact coordination operation is required. Use the live Solo tool schemas as the source of truth.

## Capability gate

Run live capability preflight before choosing an adapter.

Solo project and process tools are required. Use them to select the project, inspect workers, send input, and manage worker lifecycle.

The following surfaces are optional:

- Todos
- Scratchpads
- Timers
- Locks
- KV

Use only the optional tools that the live session exposes. Never pass a revision guard, response mode, or other parameter unless the live schema supports it.

## Adapter order

Choose the strongest available adapter for each need:

| Need | Preferred adapter | Fallback |
|---|---|---|
| Work queue and dependencies | Todos | Scratchpad or orchestrator-owned state |
| Handoff or restart packet | Scratchpad | Todo comment, bounded KV, then orchestrator-owned state |
| Delayed wake-up | Timer | New user turn or lifecycle event |
| Exclusive ownership | Lock | Explicit disjoint assignment |
| Small shared state | KV | Scratchpad or orchestrator-owned state |

Do not emulate a missing optional capability by polling or by inventing tool parameters.

## Mutation readback

After a coordination mutation, read back the changed object when the surface supports reads. Confirm the stored state before another worker depends on it.

For revision-based surfaces:

1. Read the current object.
2. Use only the revision parameter shown by the live mutation schema.
3. Read the object again after mutation.

When no read operation exists, preserve the mutation response and label the state unverified.

## Worker handoffs

Before replacing, restarting, or closing a worker, persist a restart packet in the best available adapter.

Include:

- Assignment and current state
- Completed work and evidence
- Remaining work and exact next action
- Files or resources touched
- Active task packet ID and schema version
- Validation evidence owners and collected results
- Blockers and dependencies
- Commands or checks still required

Read the packet back when supported. Give the recovered packet to the replacement worker before dispatch.

## Todos and blockers

After task verification, complete its todo through the live schema and read it back when possible. Inspect every dependent todo returned or affected by completion. Dispatch only work that Solo now reports unblocked.

Without todos, update the orchestrator-owned dependency state and perform the same blocker check before dispatch.

## Timers

Timers wake an orchestrator. They do not prove service readiness or task completion.

Treat idle timers as edge notifications:

- `timer_fire_when_idle_any` can ignore processes that were already idle when armed.
- `already_satisfied` means an idle-all condition was already true and no later wake will occur.
- A deadline wake means the maximum wait elapsed, not that the condition became true.
- After every wake, inspect the relevant worker or shared state before dispatch.

Without timers, inspect only on a new user turn or a worker lifecycle event. Never poll.
