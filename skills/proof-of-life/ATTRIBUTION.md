# Attribution

Proof of Life is inspired by and adapted from [unlazy v2](https://github.com/Leonxlnx/unlazy) by [Leonxlnx](https://github.com/Leonxlnx).

Upstream revision used for this adaptation:

```text
ed9e8d2b5919698cf2c54bda270d507e10b69617
```

Unlazy is distributed under the MIT License. Its license and copyright notice are preserved in [LICENSE.unlazy](LICENSE.unlazy).

## Inherited concepts

Proof of Life credits unlazy for these ideas:

- The Depth Tree as a decomposition method.
- Acceptance gates stored in files before work begins.
- Runnable `CHECK`, `EXPECT`, and `EVIDENCE` records.
- Separate leaf and branch integration gates.
- Fresh worker contexts for substantial leaves.
- Parent re-verification instead of worker self-certification.
- Stop-hook enforcement for unfinished gates.
- Measured final reports backed by a ledger.
- Visible abandonment instead of silent scope reduction.

## Proof of Life changes

Proof of Life adds or materially changes:

- A machine-readable `PLAN.json` as scheduling truth.
- Deterministic dependency and ownership preflight.
- Bounded rolling dispatch instead of lockstep leaf dispatch.
- A parent-owned state machine with explicit terminal outcomes.
- Scheduler-integrated exact gate re-execution.
- Strict abandonment semantics for parent verification.
- Blocked-descendant propagation and restart-ready handover.
- Concurrent, deduplicated gate checks with a serial compatibility mode.
- Stop-hook behavior that permits terminal non-success handover.

## Adapted files

These files preserve unlazy structure or implementation ideas and remain covered by its MIT notice:

- `SKILL.md`
- `references/gates.md`
- `references/method.md`
- `references/orchestration.md`
- `templates/gates-leaf.md`
- `templates/gates-node.md`
- `templates/PLAN.md`
- `scripts/gate-check.mjs`
- `scripts/stop-hook.mjs`
- `scripts/install-hooks.mjs`

The following files are original Proof of Life work:

- `references/plan-format.md`
- `references/outcome-states.md`
- `templates/PLAN.json`
- `scripts/plan.mjs`
- `tests/run.mjs`

The repository's Apache-2.0 license applies to original Proof of Life work. The preserved MIT terms apply to adapted unlazy material.
