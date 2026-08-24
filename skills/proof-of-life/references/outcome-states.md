# Outcome states and handover

The parent owns every state transition. A worker reports observations but cannot issue `verified`.

## Transition table

| From | To | Condition |
|---|---|---|
| `pending` | `running` | All needs verified and worker capacity available. |
| `running` | `awaiting-verification` | Worker returned control. |
| `awaiting-verification` | `verified` | Exact strict parent verification passed. |
| `awaiting-verification` | `running` | Corrective redispatch reserves available worker capacity. |
| `running` | `failed` | A required invariant failed. |
| `awaiting-verification` | `failed` | Parent verification failed and work ends. |
| `pending` | `abandoned` | The node cannot be attempted and has a reason. |
| `running` | `abandoned` | Work stops without a correctness claim. |
| `awaiting-verification` | `abandoned` | Verification cannot complete and work stops. |
| `pending` | `blocked` | A named external prerequisite prevents dispatch. |

`verified`, `failed`, `abandoned`, and `blocked` are terminal.

## Propagation

When a node becomes `failed`, `abandoned`, or `blocked`, each pending descendant becomes `blocked`. Its state records the nearest terminal ancestor in `blockedBy`.

Running descendants indicate an invalid plan or driver action because dependencies must verify before dispatch. The scheduler reports the inconsistency instead of rewriting active work.

## Handover result

A terminal handover exists when:

- no node is running
- no pending node is ready
- at least one node is failed, abandoned, or blocked

The handover is an honest exit with non-success status. The stop hook allows it because no action remains in the current run.

Every direct terminal outcome requires a reason. Propagated blocked descendants inherit a machine-generated reason and the causal node ID.

## Restart

After an external condition changes, the parent can create a new run state from the same validated plan. It may seed previously verified node states only after re-validating their evidence against the unchanged contract. Proof of Life does not silently reopen terminal states inside one run.
