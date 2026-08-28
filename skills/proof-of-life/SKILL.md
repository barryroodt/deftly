---
name: proof-of-life
description: Proof-backed completion discipline for substantial work and multi-agent builds. Use when work must finish against runnable gates, when independent leaves should run through bounded rolling dispatch, or when blocked work needs an honest restart-ready handover. Triggers on /proof-of-life, prove it is done, completion gates, rolling dispatch, dependency plan, and do not stop half-finished.
license: Apache-2.0 with adapted MIT material; see ATTRIBUTION.md and LICENSE.unlazy
metadata:
  author: Barry Roodt
  source: https://github.com/barryroodt/deftly
  inspired-by: https://github.com/Leonxlnx/unlazy
  upstream-revision: ed9e8d2b5919698cf2c54bda270d507e10b69617
---

# Proof of Life

Proof of Life makes incomplete work structurally visible. A completion claim requires runnable gates, fresh evidence, and parent verification. Larger builds use a machine-checked dependency plan and bounded rolling dispatch.

This skill is inspired by and adapted from [unlazy v2](https://github.com/Leonxlnx/unlazy) by Leonxlnx. Read [ATTRIBUTION.md](ATTRIBUTION.md) for inherited concepts, original changes, and license details.

## When to use

Use this skill when any of these conditions apply:

- The user asks for substantial work that must be complete.
- A long task can drift into a premature report.
- Several independent work leaves can run concurrently.
- Completion requires checks that a worker must not self-certify.
- Failed or impossible work needs a precise handover.

## When not to use

Skip this skill for conversational replies, factual questions, trivial edits, or disposable experiments. Do not create a plan and ledger when the enforcement costs more than the work.

## Core invariants

1. Write gates before implementation.
2. A worker proposes completion. The parent verifies it.
3. Only `verified` dependencies unlock a leaf.
4. One parent owns plan state.
5. Active leaves never overlap in declared ownership.
6. `abandoned` and `blocked` permit handover, never successful completion.
7. Continue dispatching reachable work after an unrelated failure.
8. Report only facts present in the plan state and gate evidence.
9. A dispatched gate contract stays pinned until the parent reviews the change and re-pins it.

## Pick a mode

### Focused mode

Use focused mode for one coherent stretch of work. Create `GATES.md` from [templates/gates-leaf.md](templates/gates-leaf.md), finish every gate, then run:

```bash
node <skill-dir>/scripts/gate-check.mjs --verify --strict GATES.md
```

### Orchestrated mode

Use orchestrated mode for a build with several substantial leaves and explicit integration nodes. Create:

- `PLAN.json` from [templates/PLAN.json](templates/PLAN.json), the machine-readable source of scheduling truth.
- `PLAN.md` from [templates/PLAN.md](templates/PLAN.md), for stable contracts and an append-only event log.
- One gate file per leaf, branch integration node, and root integration node under `gates/`.

Read [references/orchestration.md](references/orchestration.md) before dispatch. `PLAN.md` must not duplicate node state or scheduling order.

## Gates before work

Each gate states one observable outcome. Runnable gates have `CHECK`, `EXPECT`, and `EVIDENCE` lines. Manual gates require concrete evidence before their box is checked.

Run unmet checks and record evidence:

```bash
node <skill-dir>/scripts/gate-check.mjs GATES.md
```

Re-run every runnable gate for independent verification:

```bash
node <skill-dir>/scripts/gate-check.mjs --verify --strict GATES.md
```

`--status` parses without running commands. `--jobs N` runs up to N distinct checks concurrently. Equal `CHECK` commands share one execution and apply each gate's `EXPECT` independently. Keep `--jobs 1` when checks share caches, databases, snapshots, or generated files.

An impossible gate can end with `ABANDON: <gate-id> <reason>`. Default checker behavior preserves unlazy compatibility and treats abandonment as resolved. Orchestrated parent verification always uses `--strict`, which returns a distinct non-success result for abandonment.

Full format: [references/gates.md](references/gates.md).

## Plan before dispatch

`PLAN.json` contains leaf and integration nodes, dependencies, ownership, tier, gate files, one root node, and the concurrency bound. Validate it before spawning workers:

```bash
node <skill-dir>/scripts/plan.mjs check PLAN.json
```

The checker rejects missing dependencies, cycles, invalid ownership claims, overlapping file ownership, duplicate gate files, invalid concurrency bounds, and roots that do not integrate every node.

Ownership uses canonical claims:

- `file:path/from/project/root`
- `artifact:stable-name`

File ownership defaults to the complete file or directory tree. Parent and descendant paths overlap. Claims must be project-relative and must not contain `..`.

## Rolling driver loop

The parent is the sole state writer. State defaults to `.proof-of-life/state.json`.

1. Ask for the next bounded batch:

   ```bash
   node <skill-dir>/scripts/plan.mjs ready PLAN.json
   ```

2. Start each returned node before spawning its worker or running parent integration:

   ```bash
   node <skill-dir>/scripts/plan.mjs start PLAN.json <node-id>
   ```

   `start` pins a fingerprint of the node's gate contract: gate IDs, titles, `CHECK`, `EXPECT`, and `ABANDON` entries. Checkbox and `EVIDENCE` updates from gate runs stay outside the pin.

3. For a leaf, give the worker only the stable contract, its plan entry, and its gate file. For an integration node, the parent can run the gates directly or dispatch a strong integration worker.

4. When execution returns, record the return:

   ```bash
   node <skill-dir>/scripts/plan.mjs return PLAN.json <node-id>
   ```

5. Verify through the scheduler. It executes every runnable gate with strict abandonment handling:

   ```bash
   node <skill-dir>/scripts/plan.mjs verify PLAN.json <node-id>
   ```

   `verify` recomputes the contract fingerprint first and refuses a mismatch without touching node state. Review the amendment, then re-pin deliberately:

   ```bash
   node <skill-dir>/scripts/plan.mjs regate PLAN.json <node-id>
   ```

   If verification fails and the node remains correctable, reserve capacity before redispatch:

   ```bash
   node <skill-dir>/scripts/plan.mjs retry PLAN.json <node-id>
   ```

   Send the executor the exact failed gates. `retry` moves `awaiting-verification` back to `running` and counts the attempt in the ledger. Retry at most twice per approach; from the third retry the scheduler warns. Change the approach or record a terminal outcome instead.

6. A verified node unlocks its dependents. Fill every free slot from the new `ready` set immediately. Do not wait for an unrelated active node. Release a persistent worker once its node verifies and no next assignment exists. A reused worker gets the full fresh brief for its next node.

7. Record non-success outcomes with a reason:

   ```bash
   node <skill-dir>/scripts/plan.mjs fail PLAN.json <node-id> --reason "<observed invariant failure>"
   node <skill-dir>/scripts/plan.mjs abandon PLAN.json <node-id> --reason "<why work cannot continue>"
   node <skill-dir>/scripts/plan.mjs block PLAN.json <node-id> --reason "<external prerequisite>"
   ```

A non-success terminal state blocks dependent nodes. Independent ready work continues. Root success requires verification of every node, including the root integration gate. When no actionable work remains, the run returns a distinct handover result.

## Outcome states

| State | Meaning | May unlock dependents |
|---|---|---|
| `pending` | Not started. Readiness is derived from verified needs. | No |
| `running` | A worker owns the leaf. | No |
| `awaiting-verification` | The worker returned an outcome proposal. | No |
| `verified` | The parent re-ran exact gates successfully. | Yes |
| `failed` | Work ran and a required invariant failed. | No |
| `abandoned` | Work stopped without a correctness claim. | No |
| `blocked` | A named prerequisite prevents action. | No |

`abandoned`, `failed`, and `blocked` are terminal. They prevent root success but allow an honest session exit. Their descendants become `blocked` with the upstream cause recorded.

## Verification authority

A worker never marks itself `verified`. It can only return work and gate evidence. The parent runs `plan.mjs verify`, which delegates to `gate-check.mjs --verify --strict` using the exact gate file declared in `PLAN.json`.

Manual gates remain parent judgments. The parent must replace `pending` with a measurement, deciding output, or precise file reference before verification.

## Handover

When no active or ready nodes remain and root success is impossible, report:

- each verified node and its evidence location
- each failed, abandoned, or blocked node and reason
- descendants blocked by each terminal cause
- unknown facts that were not observed
- the smallest condition that makes work runnable again
- the next exact action after that condition changes

This is a terminal non-success handover. Do not describe it as completion.

## Report audit

Before the final report:

```bash
node <skill-dir>/scripts/plan.mjs status PLAN.json
node <skill-dir>/scripts/gate-check.mjs --status
```

Measure every number in the report. Keep evidence to deciding lines. A successful report requires every leaf, branch integration node, and root integration node to be verified.

## Optional Claude Code stop hook

The stop hook blocks exit while actionable work or unmet gates remain. It allows exit for verified completion and terminal non-success handover.

Install it only with user approval:

```bash
node <skill-dir>/scripts/install-hooks.mjs
```

Remove it with:

```bash
node <skill-dir>/scripts/install-hooks.mjs --uninstall
```

The rest of this skill is portable to any harness that can read Markdown and run Node 18 or later.
