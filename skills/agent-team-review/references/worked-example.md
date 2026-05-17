# Worked Example: End-to-End Run

A complete agent-team-review run on a hypothetical branch. Shows the shape of every step; use as a reference for first-time invocation.

## Setup

- Branch: `feat/email-notifications`
- Diff: 6 files across `packages/api/` and `packages/web/`
- Spec: `docs/plans/email-notifications.md`

## Step 1–2: Prereq + Scope

```
✓ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
$ git diff main...HEAD --stat
 packages/api/src/notifications.ts          | 84 ++++++++++
 packages/api/src/queue.ts                  | 12 +-
 packages/web/src/components/Bell.tsx       | 41 ++++++
 packages/web/src/hooks/useUnread.ts        | 22 +++
 shared/schema.ts                           |  6 +
 docs/plans/email-notifications.md          | 38 ++++
```

## Step 3: Specialist Discovery

No project skills match. User skills: `rust-pro` (irrelevant — no Rust). No specialist included.

## Step 4: Decide Composition

- Failure modes: API logic, async queue handling, cross-package schema drift, missing spec coverage.
- Reviewers chosen: correctness, spec-compliance, api-conventions, web-conventions, contracts. (5 — at the cap.)

## Step 5: Present Plan (user approves)

## Step 6: Spawn

```
TeamCreate({ name: "review-email-notifications" })
Agent({ team_name: ..., name: "correctness", ... })
Agent({ team_name: ..., name: "spec-compliance", ... })
Agent({ team_name: ..., name: "api-conventions", ... })
Agent({ team_name: ..., name: "web-conventions", ... })
Agent({ team_name: ..., name: "contracts", ... })
```

## Step 7: Parallel Round (excerpted findings)

**correctness:**
> Critical — `packages/api/src/queue.ts:34` — missing retry on transient SMTP failure.
> Important — `packages/web/src/hooks/useUnread.ts:18` — race when WebSocket reconnects mid-fetch.

**api-conventions:**
> CI: lint:check PASS, types:check PASS, test FAIL (1 snapshot stale).
> Important — `packages/api/src/notifications.ts:12` — uses `console.log` instead of project logger.

**contracts:** (sends direct message)
> SendMessage to correctness: "`shared/schema.ts:24` defines `email` as `string`, not `string | null` — your null-check finding at api/notifications.ts:51 looks unnecessary."

## Step 8: Refinement (broadcast)

Lead broadcasts aggregated summary. correctness withdraws the null-check finding per contracts' message. spec-compliance escalates a missing requirement (rate-limit) from Important → Critical because contracts noted the shared rate-limiter was not wired in.

## Step 9: Unified Verdict

```
Overall Verdict: WITH_FIXES

Summary: 6-file change implements email notifications. 2 critical issues
(missing retry, missing rate-limit wiring) must be fixed. CI reveals one
stale snapshot.

CI Results:
- lint:check: PASS
- types:check: PASS
- test: FAIL (1 snapshot stale — packages/api)

Critical Issues:
- packages/api/src/queue.ts:34 — missing retry on SMTP transient failure.
- packages/api/src/notifications.ts (rate-limit) — shared rate-limiter not wired.

Important Issues:
- packages/web/src/hooks/useUnread.ts:18 — WebSocket reconnect race.
- packages/api/src/notifications.ts:12 — use project logger, not console.log.

Spec Compliance:
- [x] Email send on new message
- [ ] Rate-limit per user (missing)
- [x] WebSocket unread badge

Strengths:
- Clean schema additions in shared/schema.ts.
- Plan document updated alongside code.
```

## Step 10: Cleanup

```
SendMessage({ to: "correctness", type: "shutdown_request" })
... (same for each reviewer)
TeamDelete({ name: "review-email-notifications" })
```
