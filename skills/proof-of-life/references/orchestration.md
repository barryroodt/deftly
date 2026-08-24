# Orchestrated mode

Proof of Life adapts unlazy v2's fresh-leaf and parent-verification model. It replaces lockstep dispatch with a bounded rolling dependency scheduler.

## Authority split

The parent:

- writes and validates the plan
- owns the state file
- dispatches ready leaf and integration nodes
- records executor returns
- re-runs exact gates
- issues terminal outcomes
- executes or dispatches branch and root integration nodes

A worker:

- changes only declared ownership
- implements one leaf
- runs local gates
- returns evidence or a precise blocker
- never marks itself verified

## Preflight

Run `plan.mjs check PLAN.json` before any spawn. Fix every invalid reference, cycle, duplicate gate file, ownership overlap, and root coverage error.

The root must be an integration node whose dependency closure includes every node. Preflight does not imply readiness. Runtime readiness also requires every need to be `verified`.

## Bounded rolling dispatch

`ready` computes free capacity from `maxWorkers` and current `running` nodes. It returns ready node IDs in stable lexical order.

Start the returned nodes. When execution returns, record `awaiting-verification` and verify immediately. On success, fill the free slot from the newly ready set. Branch and root integration nodes become ready only after their children verify.

Worker concurrency and check concurrency are separate. `maxWorkers` limits running nodes. `gate-check --jobs` limits command executions.

## Exact parent verification

`plan.mjs verify` reads the node's declared gate file and invokes:

```bash
gate-check.mjs --verify --strict <gate-file>
```

A zero exit changes the node to `verified`. Any other result leaves it in `awaiting-verification`. For correctable work, run `plan.mjs retry` before redispatch so the node returns to `running` and consumes capacity. Otherwise record a terminal non-success state.

## Failure isolation

A failed, abandoned, or blocked node makes its pending descendants blocked. The scheduler continues independent ready work.

When no node is running and no pending node is ready:

- every node verified, including root, means successful completion
- any non-success terminal state means terminal handover
- unresolved pending work without a terminal cause means invalid scheduler state

## Shared workspace safety

Ownership is a write contract. Workers may read outside it, but must not modify outside it. Project-wide formatters and generators are prohibited unless the leaf owns every possible output.

If the harness supports isolated worktrees, the parent may use them. Merge order still follows dependency and verification state.

## Worker brief

Send only:

- the relevant stable contract
- the leaf entry from `PLAN.json`
- the leaf gate file
- the instruction to stay within `Owns`
- the command that runs its local gates

Do not send the parent's transcript or unrelated worker output.
