# PLAN.json format

`PLAN.json` is the canonical scheduling input. It contains declarations only. Runtime state belongs in `.proof-of-life/state.json`.

## Schema

```json
{
  "version": 1,
  "name": "build example",
  "root": "root-integration",
  "maxWorkers": 2,
  "nodes": [
    {
      "id": "contract",
      "kind": "leaf",
      "needs": [],
      "owns": ["file:src/contract.ts"],
      "tier": "strong",
      "gates": "gates/contract.md"
    },
    {
      "id": "root-integration",
      "kind": "integration",
      "needs": ["contract"],
      "owns": [],
      "tier": "strong",
      "gates": "gates/root-integration.md"
    }
  ]
}
```

## Fields

- `version`: must be `1`.
- `name`: non-empty task name.
- `root`: ID of the final integration node.
- `maxWorkers`: positive integer.
- `nodes`: non-empty array of leaf and integration nodes.
- `id`: unique lowercase identifier using letters, numbers, dots, underscores, or hyphens.
- `kind`: `leaf` for implementation work or `integration` for branch and root verification.
- `needs`: unique IDs of prerequisite nodes.
- `owns`: canonical resource claims. Leaf nodes must own at least one resource. Integration nodes can own none.
- `tier`: non-empty routing hint. The harness decides how to interpret it.
- `gates`: unique project-relative gate file path.

The root must have kind `integration`. Its dependency closure must include every other node. This makes root success impossible until every local leaf and branch integration gate verifies.

## Ownership

A claim has one of these forms:

```text
file:path/from/project/root
artifact:stable-name
```

File paths use forward slashes. Absolute paths, empty segments, `.` segments, and `..` segments are invalid. A file claim also owns all descendants. Thus `file:src/api` overlaps `file:src/api/client.ts`.

Artifact names use lowercase letters, numbers, dots, underscores, and hyphens. Artifact claims must be unique.

## Runtime state

The state file contains a record for each node:

```json
{
  "version": 1,
  "plan": "build example",
  "planHash": "<sha256 of the plan>",
  "nodes": {
    "contract": {
      "state": "pending",
      "reason": null,
      "blockedBy": null
    }
  }
}
```

The parent is the only writer. Mutations use an atomic temporary-file rename. A plan hash mismatch invalidates stale state.

## Readiness

A pending node is ready when every `needs` node is `verified`. `ready` returns at most:

```text
maxWorkers - running nodes
```

The result uses lexical node ID order. A different order must come from explicit dependencies, not incidental array order.

Integration nodes use the same lifecycle. The parent can execute them directly or dispatch a strong integration worker. Their gates still require parent verification.

## Terminal result

`status` returns:

- exit `0` when every node, including the root, is verified
- exit `1` while actionable or active work remains
- exit `2` for invalid plan or state
- exit `3` when no action remains and successful completion is impossible
