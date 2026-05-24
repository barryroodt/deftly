# test-reviewer (agent-team-review)

**Status:** Approved design
**Date:** 2026-05-24
**Skill:** `skills/agent-team-review`

## Motivation

> "Do not add tests which simply restate the implementation. These provide zero confidence."
>
> "Getting sick of shit tests just to provide evidence of RGR."

Tests that mirror the implementation (snapshot-only, mock-the-mock, mirror-the-impl branching, trivial accessors, over-mocked-no-subject, impl-coupled) are net-negative: they create false confidence, slow CI, and force lockstep edits without catching real bugs. Existing reviewers in `agent-team-review` do not target this failure mode — correctness reviews logic, conventions reviews style, spec-compliance reviews coverage of the plan, contracts reviews cross-service shape, and structural-simplification reviews production code structure. None ask the load-bearing question: *"would a plausible bug in the subject break this test?"*

## Goal

Add a sixth reviewer, `test-reviewer`, that evaluates tests in the diff against a single standard: every test must name a plausible bug it catches. Tests that fail this standard block the PR.

## Non-goals

- Detecting missing tests (correctness / spec-compliance handle absence of coverage).
- Test style, naming, or formatting (conventions).
- Test file decomposition or >1000-line tests (structural-simplification).
- Flakiness, performance, or CI timing issues.
- Integration-vs-unit ratio policy.

## Lane definition

**In:** evaluating tests present in the diff for whether they provide real confidence.

**Out:** test absence, test style, test performance, test infra. Out-of-lane findings → `SendMessage` to the relevant reviewer.

## Activation

Spawn `test-reviewer` when the diff contains changes to any of:

- `*.test.*`
- `*.spec.*`
- `__tests__/` paths
- `tests/` paths
- `spec/` paths

Skip the reviewer if no test paths are touched. The reviewer does not comment on test absence — that belongs to correctness or spec-compliance.

## Detection model

### Load-bearing heuristic

For each test in the diff, the reviewer must answer:

> What plausible bug in the subject under test would this test catch? If none can be named, the test is tautological.

Reviewer findings must cite the bug the test fails to catch. Vague verdicts ("feels tautological") are forbidden.

### Pattern catalog

Named anti-patterns the reviewer cites:

| Pattern | Definition |
|---|---|
| **snapshot-only** | Sole assertion is `toMatchSnapshot()` (or equivalent) with no behavioral check. |
| **mock-the-mock** | Assertion verifies a mock was called or returned a value the test itself stubbed. |
| **mirror-the-impl** | Test branching/assertions mirror the subject's conditional structure; any change to the subject forces an identical change to the test. |
| **trivial accessor** | `set x; assert x` shape with no transformation under test. |
| **over-mocked / no subject** | Every dependency mocked; no real subject exercised. |
| **impl-coupled** | Assertions encode private internals or exact call order of trivial steps instead of a behavior contract. |

## Approval bar (strict)

- Any new test matching the catalog → **NOT_READY**.
- Soft signal (test name vague, behavior unclear but a plausible bug exists) → **WITH_FIXES**.
- Clean test changes, or no test changes in scope → **READY**.

Bar matches the strictness of `structural-simplification` — opinionated by design.

## Preferred remedies (per pattern, delete-biased)

| Pattern | Remedy |
|---|---|
| snapshot-only | Delete unless output-regression intent is documented. |
| mock-the-mock | Delete; verify behavior of the real subject elsewhere. |
| mirror-the-impl | Rewrite around an invariant; delete if no invariant is recoverable. |
| trivial accessor | Delete. |
| over-mocked / no subject | Rewrite as integration test, or delete. |
| impl-coupled | Rewrite around the behavior contract; delete if no contract is recoverable. |

## Output format

Standard reviewer shape (verdict / issues by severity / strengths / notes for other reviewers) plus one extra section:

```markdown
## Test Review

### Verdict: READY | WITH_FIXES | NOT_READY

### Plausible-Bug Audit
- `file:line` — Pattern: <name>. **Bug it fails to catch:** <specific plausible bug>. **Remedy:** <delete | rewrite around invariant X>.

### Issues

#### Critical
- `file:line` — Description. **Why it matters:** <false confidence + maintenance cost>. **Suggested remedy:** <per-pattern remedy>.

#### Important
- ...

#### Minor
- ...

### Strengths
- Specific tests with file references that exemplify good behavioral coverage.

### Notes for Other Reviewers
- Missing-coverage flags → correctness or spec-compliance.
- Style/naming → conventions.
- File-size or structural smells → structural-simplification.
```

## Cross-reviewer routing

| Concern | Route to |
|---|---|
| Missing tests for new code | correctness or spec-compliance |
| Test naming / style | conventions |
| Test file >1000 lines / structural smells | structural-simplification |
| Cross-service test contract drift | contracts |

## SKILL.md edits

1. **Decision-rules table** — append row:

   | Tests provide false confidence (tautological / RGR-only) | **test-reviewer** | diff touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/` |

2. **Decision-rules text** — append bullet:

   > **Add `test-reviewer`** if the diff touches test paths. Reviewer evaluates existing tests for tautology; it does not flag missing tests (that is correctness/spec-compliance).

3. **Review-plan example table** — add example row showing `test-reviewer` with template `tests.md` scoped to `**/*.test.*` and similar globs.

4. **"Never" rules** — append under "Reviewer (per teammate)":

   > **NEVER flag a test as tautological without naming the plausible bug it fails to catch.** Vague verdicts ("feels tautological") are unactionable and erode trust.

5. **Reviewer count guard** — `test-reviewer` counts toward the existing 5-reviewer cap. No special-case priority; existing prioritization stands.

## Template file

New file: `skills/agent-team-review/templates/tests.md`. Structure mirrors `structural-simplification.md`:

- Role + lane
- Non-negotiable standards (load-bearing heuristic + strict bar)
- Pattern catalog (with examples)
- How to review (procedure)
- Preferred remedies table
- Approval bar
- Output format

## Acceptance criteria

- `templates/tests.md` exists with the structure above.
- `SKILL.md` decision-rules table, decision-rules text, review-plan example, and "Never" rules updated.
- `references/worked-example.md` either updated to show a test-reviewer entry or explicitly notes test-reviewer follows the same shape (decide during implementation).
- Skill still passes its existing self-checks (no broken cross-references).

## Out of scope (this spec)

- Auto-detection of language-specific test frameworks (Jest vs pytest vs cargo-test). The reviewer reads diffs; pattern detection is language-agnostic.
- Wiring a CLI flag to force-include or force-exclude `test-reviewer`. Activation is purely diff-driven.
- Changes to `references/tool-shapes.md` (no new tool shapes needed).
