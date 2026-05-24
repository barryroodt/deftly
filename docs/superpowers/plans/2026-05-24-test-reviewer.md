# test-reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth reviewer `test-reviewer` to `skills/agent-team-review` that catches tautological tests — tests that restate the implementation and would not catch a plausible bug in the subject.

**Architecture:** Documentation-only change. One new template file (`templates/tests.md`) following the same shape as existing templates, plus four targeted edits to `SKILL.md` (decision-rules table, decision-rules text, review-plan example, "Never" rules) and one note in `references/worked-example.md`.

**Tech Stack:** Markdown only. No code, no tests. Verification = grep + read + visual check that the template structure mirrors siblings.

**Spec:** `docs/superpowers/specs/2026-05-24-test-reviewer-design.md`

---

## File Structure

- **Create:** `skills/agent-team-review/templates/tests.md`
- **Modify:** `skills/agent-team-review/SKILL.md`
- **Modify:** `skills/agent-team-review/references/worked-example.md`

Each file has a single responsibility — the template defines the reviewer's instructions; SKILL.md routes the reviewer into team composition; the worked example notes the new reviewer exists.

---

### Task 1: Create `templates/tests.md`

**Files:**
- Create: `skills/agent-team-review/templates/tests.md`

- [ ] **Step 1: Write the template**

Create `skills/agent-team-review/templates/tests.md` with exact content:

````markdown
# Test Reviewer

You are reviewing the tests in this diff for whether they provide real confidence. Your bar is unusually strict.

## Your Focus

Evaluate every test added or modified in the diff against one load-bearing question:

> **What plausible bug in the subject under test would this test catch?**

If you cannot name a specific plausible bug the test catches, the test is tautological — it restates the implementation rather than verifying behavior. Tautological tests are net-negative: they create false confidence, slow CI, and force lockstep edits without catching bugs.

## What NOT to Review

- Missing tests for new code (that is the correctness or spec-compliance reviewer)
- Test naming, formatting, file-layout conventions (that is the conventions reviewer)
- Test files growing past 1000 lines or structural smells in test code (that is the structural-simplification reviewer)
- Cross-service contract drift in shared test fixtures (that is the contracts reviewer)
- Flakiness, performance, CI timing

If you find issues in those areas, use `SendMessage` to flag them to the relevant reviewer.

## Non-Negotiable Standards

1. **Plausible-bug test.** For every flagged test you must name a specific plausible bug the test fails to catch. Vague verdicts ("feels tautological", "looks weak") are forbidden.

2. **Strict approval bar.** Any new test matching a pattern in the catalog below → **NOT_READY**. Soft signals (test name vague, behavior unclear but a plausible bug exists) → **WITH_FIXES**.

3. **Delete-biased remedies.** When no behavioral invariant can be recovered, the preferred remedy is delete. Rewriting a tautological test into another tautological shape is not progress.

## Pattern Catalog

Reviewer findings must cite the pattern by name.

| Pattern | Definition |
|---|---|
| **snapshot-only** | Sole assertion is `toMatchSnapshot()` (or equivalent) with no behavioral check. |
| **mock-the-mock** | Assertion verifies a mock was called or returned a value the test itself stubbed. |
| **mirror-the-impl** | Test branching or assertions mirror the subject's conditional structure; any change to the subject forces an identical change to the test. |
| **trivial accessor** | `set x; assert x` shape with no transformation under test. |
| **over-mocked / no subject** | Every dependency mocked; no real subject exercised. |
| **impl-coupled** | Assertions encode private internals or the exact call order of trivial steps instead of a behavior contract. |

## How to Review

1. Read the full diff. Identify every test added or modified.
2. For each test, attempt to name a specific plausible bug it catches.
3. If you cannot name one, match the test against the pattern catalog and cite the pattern.
4. Record the bug-it-fails-to-catch and the preferred remedy.
5. Check whether a real behavioral invariant is recoverable — if yes, prefer rewrite; if no, prefer delete.

## Preferred Remedies

| Pattern | Remedy |
|---|---|
| snapshot-only | Delete unless an output-regression intent is documented. |
| mock-the-mock | Delete; verify behavior of the real subject elsewhere. |
| mirror-the-impl | Rewrite around an invariant; delete if no invariant is recoverable. |
| trivial accessor | Delete. |
| over-mocked / no subject | Rewrite as an integration test, or delete. |
| impl-coupled | Rewrite around the behavior contract; delete if no contract is recoverable. |

## Approval Bar

Required for `READY`:

- Every new or modified test has a nameable plausible bug it would catch.
- No test matches a pattern in the catalog.

Treat as presumptive blockers:

- a test whose sole assertion is a snapshot
- a test that verifies its own mock
- a test whose structure mirrors the subject's branching
- a test that exercises no real subject (everything mocked)
- a test that asserts on private internals or exact call order of trivial steps

## Output Format

```markdown
## Test Review

### Verdict: READY | WITH_FIXES | NOT_READY

### Plausible-Bug Audit
- `file:line` — Pattern: <name>. **Bug it fails to catch:** <specific plausible bug>. **Remedy:** <delete | rewrite around invariant X>.

### Issues

#### Critical
- `file:line` — Description. **Why it matters:** <false confidence + maintenance cost>. **Suggested remedy:** <per-pattern remedy>.

#### Important
- `file:line` — Description. **Why it matters:** explanation. **Suggested remedy:** <per-pattern remedy>.

#### Minor
- `file:line` — Description.

### Strengths
- Specific tests with file references that exemplify good behavioral coverage.

### Notes for Other Reviewers
- Missing-coverage flags → correctness or spec-compliance.
- Style/naming → conventions.
- File-size or structural smells → structural-simplification.
```
````

- [ ] **Step 2: Verify file exists and structure matches siblings**

Run: `rtk wc skills/agent-team-review/templates/tests.md`
Expected: line count >100 (sibling templates are 50–160 lines).

Run: `rtk grep -c "^## " skills/agent-team-review/templates/tests.md`
Expected: ≥7 (Your Focus, What NOT to Review, Non-Negotiable Standards, Pattern Catalog, How to Review, Preferred Remedies, Approval Bar, Output Format).

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/templates/tests.md
git -c commit.gpgsign=false commit -m "feat(agent-team-review): add tests.md template for test-reviewer

Strict anti-tautology reviewer. Load-bearing question: name a
plausible bug the test catches; if none, it is tautological.
Pattern catalog + delete-biased remedies."
```

---

### Task 2: SKILL.md — add decision-rules table row

**Files:**
- Modify: `skills/agent-team-review/SKILL.md` (decision-rules table around line 69–76)

- [ ] **Step 1: Edit the table**

Find this row in the decision-rules table:

```markdown
| Unmaintainable structures, redundant branching, unclear intent | **structural-simplification** | Large diffs, growing files, new branching into shared flows, refactors |
```

Insert a new row immediately after it:

```markdown
| Tests provide false confidence (tautological / RGR-only) | **test-reviewer** | Diff touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/` |
```

The row order must be: ... structural-simplification → **test-reviewer** → specialist.

- [ ] **Step 2: Verify**

Run: `rtk grep -n "test-reviewer" skills/agent-team-review/SKILL.md`
Expected: at least one match on the new table row.

Run: `rtk grep -A1 "structural-simplification.*Large diffs" skills/agent-team-review/SKILL.md`
Expected: shows the new test-reviewer row directly after.

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/SKILL.md
git -c commit.gpgsign=false commit -m "feat(agent-team-review): add test-reviewer to decision-rules table"
```

---

### Task 3: SKILL.md — add decision-rules text bullet

**Files:**
- Modify: `skills/agent-team-review/SKILL.md` (decision rules bullets around line 78–83)

- [ ] **Step 1: Edit the bullets**

Find this bullet:

```markdown
- **Always include `spec-compliance`** for features — even "small" changes to shared contracts must be checked against the plan.
```

Insert immediately after it:

```markdown
- **Add `test-reviewer`** if the diff touches test paths (`*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/`). The reviewer evaluates existing tests for tautology; it does not flag missing tests (that is correctness / spec-compliance).
```

- [ ] **Step 2: Verify**

Run: `rtk grep -n "Add \`test-reviewer\`" skills/agent-team-review/SKILL.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/SKILL.md
git -c commit.gpgsign=false commit -m "feat(agent-team-review): add test-reviewer decision rule"
```

---

### Task 4: SKILL.md — add review-plan example row

**Files:**
- Modify: `skills/agent-team-review/SKILL.md` (review-plan table around line 92–99)

- [ ] **Step 1: Edit the table**

Find this row in the example review-plan table:

```markdown
> | structural-simplification | structural-simplification.md | All changed files (if non-trivial refactor) |
```

Insert immediately after it:

```markdown
> | test-reviewer | tests.md | All test files in diff (`*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/`) |
```

- [ ] **Step 2: Verify**

Run: `rtk grep -c "tests.md" skills/agent-team-review/SKILL.md`
Expected: ≥1.

Run: `rtk grep -B1 "test-reviewer | tests.md" skills/agent-team-review/SKILL.md`
Expected: shows structural-simplification row immediately before.

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/SKILL.md
git -c commit.gpgsign=false commit -m "feat(agent-team-review): add test-reviewer to review-plan example"
```

---

### Task 5: SKILL.md — add "Never" rule

**Files:**
- Modify: `skills/agent-team-review/SKILL.md` (Reviewer "Never" rules around line 211–216)

- [ ] **Step 1: Edit the section**

Find this bullet in the "Reviewer (per teammate)" subsection of "Never":

```markdown
- **NEVER scan the diff before reading `AGENTS.md`** (conventions reviewers). The conventions live there, not in the code — reviewing the diff first anchors you on the wrong patterns.
```

Insert immediately after it:

```markdown
- **NEVER flag a test as tautological without naming the plausible bug it fails to catch** (test-reviewer). Vague verdicts ("feels tautological", "looks weak") are unactionable and erode trust in the verdict.
```

- [ ] **Step 2: Verify**

Run: `rtk grep -n "plausible bug" skills/agent-team-review/SKILL.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/SKILL.md
git -c commit.gpgsign=false commit -m "feat(agent-team-review): add test-reviewer 'never' rule"
```

---

### Task 6: Update `references/worked-example.md`

The example is fine without rewriting (the diff in the example has no test files). Add a short note that test-reviewer would spawn if tests were present, so readers learn its activation.

**Files:**
- Modify: `skills/agent-team-review/references/worked-example.md` (Step 4 section around line 30–34)

- [ ] **Step 1: Edit Step 4 commentary**

Find this line:

```markdown
- Reviewers chosen: correctness, spec-compliance, api-conventions, web-conventions, contracts. (5 — at the cap.)
```

Replace with:

```markdown
- Reviewers chosen: correctness, spec-compliance, api-conventions, web-conventions, contracts. (5 — at the cap.)
- Note: `test-reviewer` would also spawn if the diff included test files (`*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/`); this example's diff has no test paths, so it is skipped.
```

- [ ] **Step 2: Verify**

Run: `rtk grep -n "test-reviewer" skills/agent-team-review/references/worked-example.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add skills/agent-team-review/references/worked-example.md
git -c commit.gpgsign=false commit -m "docs(agent-team-review): note test-reviewer activation in worked example"
```

---

### Task 7: Final cross-reference check

- [ ] **Step 1: Confirm all spec edits landed**

Run: `rtk grep -c "test-reviewer" skills/agent-team-review/SKILL.md`
Expected: ≥4 (table row, decision rule bullet, review-plan row, "Never" rule).

Run: `rtk find skills/agent-team-review/templates -name "tests.md"`
Expected: one result.

Run: `rtk grep -c "test-reviewer" skills/agent-team-review/references/worked-example.md`
Expected: ≥1.

- [ ] **Step 2: Confirm no stray references**

Run: `rtk grep -rn "test-reviewer" skills/agent-team-review/ | rtk grep -v "SKILL.md\|tests.md\|worked-example.md"`
Expected: empty (no references in unexpected files).

- [ ] **Step 3: Git log sanity check**

Run: `git log --oneline -7`
Expected: six new commits, one per task (Tasks 1–6).

No commit for Task 7 — verification only.

---

## Acceptance Criteria (from spec)

- [x] `templates/tests.md` exists with the structured sections → Task 1
- [x] `SKILL.md` decision-rules table row → Task 2
- [x] `SKILL.md` decision-rules text bullet → Task 3
- [x] `SKILL.md` review-plan example row → Task 4
- [x] `SKILL.md` "Never" rule → Task 5
- [x] `references/worked-example.md` notes test-reviewer → Task 6
- [x] No broken cross-references → Task 7

## Out of Scope

- Auto-detection of language-specific test frameworks (reviewer reads diffs; pattern detection is language-agnostic).
- CLI flags to force-include or force-exclude `test-reviewer`.
- Changes to `references/tool-shapes.md` (no new tool shapes needed).
