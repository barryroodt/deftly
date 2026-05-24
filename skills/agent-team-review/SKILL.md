---
name: agent-team-review
description: Parallel multi-agent code review using Claude Code Agent Teams. Use when the user wants a thorough multi-perspective review of a branch or PR before merge — spawns focused reviewer teammates (correctness, conventions, spec-compliance, contracts, structural-simplification, and language specialists) that collaborate via messages and produce a unified verdict. Triggers on "/agent-team-review", "team review", "multi-agent review", "PR review", "branch review", "review before merge". Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var.
---

# Agent Team Code Review

Parallel multi-agent code review using Claude Code Agent Teams. Spawns focused reviewer agents that collaborate to produce a unified assessment.

## Prerequisites

This skill requires Agent Teams. If the setting is not enabled, prompt the user to add it:

```json
// In ~/.claude/settings.json or .claude/settings.json (project level)
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

**Check before proceeding:** Verify the setting exists in either location. If missing, show the user the snippet above and stop until they confirm it's added.

## Invocation

```
/agent-team-review                          # auto-detect scope from git
/agent-team-review packages/api             # review specific directory
/agent-team-review --base develop           # diff against a different base branch
```

## Flow

### 1. Check Prerequisites

Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set. If not, show the user how to enable it and stop.

### 2. Detect Scope

Run `git diff main...HEAD --stat` (or the user-specified base branch) to identify changed files. Group changes by top-level service or repo directory.

If no changes are detected, inform the user and stop.

### 3. Discover Specialist Skills

Scan for skills that match the changed repos, languages, or stacks:

- **Project skills** (`.claude/skills/`): repo-local skills that match the changed stack
- **User skills** (`~/.claude/skills/`): e.g., `rust-pro`, language-specific reviewers
- **Plugin skills**: e.g., a `go-code-review` skill from an installed plugin

Match by:
- Skill descriptions mentioning the changed repo name
- Language/framework keywords matching file extensions in the diff (`.rs` → Rust skills, `.ts` → TypeScript skills, `.go` → Go skills)

Present discovered specialists to the user:

> Found relevant specialist skills for this review:
> - `rust-pro` — Rust patterns and best practices
> - `<other-discovered-skill>` — <description>
>
> Include specialist reviewers? [Yes / No / Select specific ones]

### 4. Decide Team Composition

Before listing reviewers, ask:

- **Which failure modes does this diff most plausibly hit?** Logic bugs? Convention drift? Schema mismatch across services? Missing spec coverage? Structural / maintainability regressions?
- **Which reviewer catches each failure mode?** Pick the minimum set — extra reviewers dilute findings and inflate the refinement round.
- **Where is judgment required vs. mechanical checking?** Mechanical checks (CI, type-check) belong to one reviewer; judgment calls (architecture, naming) belong to the reviewer with the matching template.
- **Is `structural-simplification` warranted?** Add it for non-trivial refactors, diffs that grow large files, diffs that add branching into shared flows, or whenever the user explicitly asks for a strict / thermo-nuclear / maintainability-focused review. Skip for tiny localized bugfixes where there is no structural surface to evaluate.
- **Is a specialist warranted?** Only if a discovered skill genuinely encodes domain knowledge the generic templates miss.

### 5. Present Review Plan

Show the user the planned team composition before spawning:

> **Review plan for `feat/<branch-name>`** (3 changed directories)
>
> | Reviewer | Template | Scope |
> |----------|----------|-------|
> | correctness | correctness.md | All changed files |
> | spec-compliance | spec-compliance.md | All changed files + docs |
> | api-conventions | conventions.md | packages/api/ |
> | web-conventions | conventions.md | packages/web/ |
> | contracts | contracts.md | Cross-package boundaries |
> | structural-simplification | structural-simplification.md | All changed files (if non-trivial refactor) |
> | rust-specialist | rust-pro skill | packages/core/ (if Rust) |
>
> Proceed? [Yes / Adjust]

Wait for user approval before spawning.

### 6. Spawn Team

Use `TeamCreate` to create the review team. Spawn each reviewer as a teammate using the `Agent` tool with `team_name` set.

Each teammate's prompt MUST start with an explicit load instruction:

```
MANDATORY — Read templates/<role>.md and follow its Output Format exactly.
```

Each reviewer receives:
- Their template (from `templates/`) — loaded via the MANDATORY instruction above
- The git diff scoped to their directory (or full diff for cross-cutting reviewers)
- The repo's `AGENTS.md` if it exists (for conventions reviewers)
- CI commands from `AGENTS.md` to execute (conventions reviewers must run them)
- For specialist reviewers: invoke the relevant skill via the `Skill` tool inside the teammate's prompt so it loads with domain context

Do NOT load templates the lead is not spawning — keep the lead's context lean.

**MANDATORY — Read [references/tool-shapes.md](references/tool-shapes.md) for the exact `TeamCreate`, `Agent`, `SendMessage`, and `TeamDelete` shapes used in steps 6, 8, and 10.**

**Important:** Reviewers are teammates, not isolated agents. They can use `SendMessage` to communicate with each other.

### 7. Parallel Review Round

All reviewers work simultaneously. Each produces findings in the structured output format defined in their template.

When a reviewer discovers something outside their focus area, they `SendMessage` the relevant reviewer rather than reporting it themselves (see NEVER "review outside your lane" below for rationale and examples).

**Broadcast vs. direct message:**
- **Direct `SendMessage({ to: "<one>" })`** when the finding affects exactly one reviewer's lane (a cross-cutting hand-off).
- **Broadcast `SendMessage({ to: "*" })`** only when a finding would change every reviewer's verdict (e.g., the diff is on a stale branch, or the spec doc has been superseded). The lead reserves `*` for the Step 8 refinement round.

### 8. Cross-Review Summary

After all reviewers report, the lead:
1. Collects all findings
2. Shares a summary with all reviewers via `broadcast`
3. Asks reviewers to amend, withdraw, or escalate findings based on what others found

This refinement round catches:
- Duplicate findings across reviewers
- Findings that are invalid given another reviewer's context
- Issues that become more severe when combined with other findings

**Example amendment (after broadcast):**

> Correctness reviewer originally reported:
> > Critical — `api/handler.ts:42` — missing null check on `user.email`.
>
> After broadcast, contracts reviewer noted that `user.email` is `NonNullable<string>` in the shared schema. Correctness reviewer responds:
> > **Withdraw** `api/handler.ts:42` — `user.email` is non-nullable per `shared/schema.ts:18`. Not a bug.

The lead reflects the withdrawal in the final verdict — duplicate or invalid findings never reach the user.

### 9. Present Unified Verdict

Compile the final assessment with this structure:

`Title (branch)` → `Overall Verdict (READY | WITH_FIXES | NOT_READY)` → `Summary (2–3 sentences)` → `CI Results (per command, PASS/FAIL)` → `Critical Issues` → `Important Issues` → `Minor Issues` → `Spec Compliance (checklist)` → `Strengths`.

Use the same severity buckets the reviewer templates produce, deduped after the refinement round.

### 10. Cleanup

Shut down all reviewer teammates via `SendMessage` with `type: "shutdown_request"`. Then `TeamDelete` to clean up.

## Output Format (Per Reviewer)

Each reviewer's output format is defined in its template under `templates/<role>.md`. All templates share the same structure: verdict enum, issues by severity, strengths, and cross-reviewer notes. See any of `correctness.md`, `conventions.md`, `contracts.md`, `spec-compliance.md`, or `structural-simplification.md` for the canonical shape.

## Worked Example

See [references/worked-example.md](references/worked-example.md) for a complete end-to-end run from scope detection to cleanup. Load on first invocation if unfamiliar with the flow shape.

## Failure Handling

- **`TeamCreate` fails** (feature unavailable despite env var set): report the exact error to the user, suggest running `claude --version` and checking Agent Teams support. Do not fall back to sequential reviewers — that defeats the skill.
- **A teammate does not respond within reasonable time**: send `SendMessage({ to: "<reviewer>", message: "Status?" })` once. If still silent, mark that reviewer's findings as MISSING in the verdict and proceed with the refinement round using the responders.
- **Broadcast gets no replies**: skip the refinement round, note "no amendments" in the verdict, and present findings as-is.
- **A reviewer reports an error instead of findings**: include the error verbatim in the verdict under that reviewer's section. Do not silently drop the reviewer.
- **Cleanup fails**: retry `TeamDelete` once; if still failing, surface the team name to the user so they can clean up manually.

## Never

### Orchestration (lead)

- **NEVER skip `TeamDelete` on error.** Orphaned teammates persist across sessions and consume context on the next invocation.
- **NEVER broadcast the cross-review summary before every reviewer has reported.** Late findings get dropped from the refinement round and never reach the verdict.
- **NEVER spawn a specialist reviewer without invoking its skill first.** The teammate inherits no domain context — invoke the skill via the `Skill` tool inside the teammate's prompt.
- **NEVER spawn more than 5 reviewers.** The refinement round scales O(n²) with reviewers — beyond 5, broadcast amendments become unmanageable and findings get dropped.
- **NEVER let the lead inject its own review findings.** The lead aggregates, routes, and presents; reviewers find. Mixing the lead's observations with reviewer output destroys the parallel-perspective property the skill exists for.

### Reviewer (per teammate)

- **NEVER let a conventions reviewer report PASS without running CI.** Static analysis lies about lint/format; only the configured CI commands are authoritative.
- **NEVER flag the same issue from two reviewers.** Use the refinement round to dedupe; duplicate criticals erode trust in the verdict.
- **NEVER omit `file:line` from a finding.** Vague feedback ("the error handling is wrong") is unactionable and wastes the review.
- **NEVER review outside your lane.** Flag cross-cutting concerns to the relevant reviewer via `SendMessage` instead of reporting them yourself — out-of-lane findings duplicate work and bloat the verdict. Examples: correctness reviewer finds a convention violation → message conventions; conventions reviewer spots a contract mismatch → message contracts.
- **NEVER scan the diff before reading `AGENTS.md`** (conventions reviewers). The conventions live there, not in the code — reviewing the diff first anchors you on the wrong patterns.
