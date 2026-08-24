# Method

Adapted from the Depth Tree v2 created by Leonxlnx for [unlazy](https://github.com/Leonxlnx/unlazy). See `../ATTRIBUTION.md` and `../LICENSE.unlazy`.

## Decompose at natural joints

Layer 1 is the task. Internal nodes describe integration. Leaves contain implementation work.

A leaf must have:

- one coherent deliverable
- one exclusive ownership set
- explicit dependencies
- one gates file
- enough work to justify a fresh context

If a leaf hides several deliverables, split it. If a leaf is a mechanical edit that takes less time than its dispatch overhead, combine it with a neighbor.

## Fix contracts before dispatch

Record interfaces, data meaning, naming, error behavior, and integration rules in `PLAN.md`. Record machine-readable dependencies and ownership in `PLAN.json`.

No worker can change the shared contract without returning control to the parent. The parent updates the plan, validates it again, and redispatches affected work.

## Gate leaves and branches

Leaf gates prove local outcomes. Branch gates prove that verified children compose. Root gates prove the user's requested behavior.

Local success cannot replace integration proof. A root is successful only when all leaves and branch gates are verified.

## Work in complete passes

For each leaf:

1. Implement the declared outcome without placeholders.
2. Re-read the result against the domain contract.
3. Find and fix correctness defects.
4. Apply inexpensive polish that improves the declared outcome.

The worker then runs its gates and returns an outcome proposal. The parent performs exact verification.
