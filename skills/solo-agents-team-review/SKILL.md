---
name: solo-agents-team-review
description: Parallel multi-perspective code review orchestrated through Solo MCP worker sub-agents. Use when the user wants a thorough multi-agent review of a branch or PR before merge, run via Solo. Spawns one reviewer worker per lane (correctness, conventions, spec-compliance, contracts, structural-simplification, tests, specialists) and produces a single unified verdict. Self-contained (bundles its reviewer templates); harness-agnostic — the hard dependency is Solo MCP. Triggers on "/solo-agents-team-review", "solo team review", "solo agents review", "review PR with solo agents", "solo-orchestrated review".
---

# Solo Agents Team Review

Parallel, multi-perspective code review where each reviewer is a **Solo MCP worker sub-agent**. The orchestrator spawns one worker per review lane, wakes on idle instead of polling, collects each worker's findings from its own scratchpad, runs a refinement round, and presents one unified verdict.

**Self-contained.** This skill bundles its reviewer templates under `templates/` and depends on no other skill. It can be zipped and distributed as-is. It uses Solo MCP mechanics only (no Claude Code Agent Teams).

**No teammate message bus.** Solo workers cannot message each other. Each reviewer writes its **entire** review (findings *and* cross-lane hand-offs) to its own scratchpad, **named per run**: `review-<run>-<lane>`, where `<run>` = `<pr-or-branch>-<short-sha>` — the PR number (or a branch slug for local reviews) **plus the pinned head short SHA** (e.g. `review-333-aec7c4b-correctness`). Folding in the SHA keeps re-reviews of the same PR/branch at a *new* head from colliding with the old run's scratchpads; for repeated reviews of the *identical* head, also append a timestamp or session id. A bare `review-<lane>` collides across reviews, so **every operational reference in this document uses the full `review-<run>-<lane>` name** — worker write, barrier read, refinement update, and cleanup all name the same pad. The orchestrator aggregates and routes. Because every scratchpad is written by exactly one worker, there is no shared-file contention and no locking is needed.

## Prerequisites

- **Solo MCP available**, with a project selected. Run `whoami` first in a fresh session; `select_project` if scope is unset.
- **An agent harness Solo can spawn.** Resolve it at spawn time via `list_agent_tools` (see Step 4): the **caller-specified** harness if one was given (match by `name` or `id`), otherwise any harness `list_agent_tools` returns — every returned entry is a spawnable agent runtime, so do not filter by name or `tool_type`; if several are returned and the caller named none, pick one and note which (or ask). If a caller named a harness that is not in the list, **halt and report the available names** rather than substituting a different one. Halt too if `list_agent_tools` returns nothing. (The **hard dependency is Solo MCP itself**, not any particular harness.)
- **A worker model — follows the selected harness's contract.** Pass the model in the chosen harness's own form: the `Omp` harness takes a per-launch, provider-qualified `--model <provider>/<model>` (slugs from `omp models`); another harness uses its own documented model flag. A caller-supplied model wins and is tried first — but a harness can only honor it if it has a documented model mechanism. If a model is explicitly requested and the selected harness has no known way to pass it, **halt and report (or pick a harness that supports it)** rather than silently running an unrelated default. Only when no model is requested may a harness run its saved default. Slugs drift and a listed model can still be unauthenticated or rejected at runtime, so always smoke-test whatever ends up selected.
- **`gh`** for PR metadata and diffs.

Stop only if Solo MCP (or a selected project scope) is genuinely unavailable, or Solo can spawn no agent harness at all.

## Invocation

```
/solo-agents-team-review                 # auto-detect scope from git
/solo-agents-team-review <pr-number>     # review a specific PR
/solo-agents-team-review --base develop  # diff against a different base
```

## Reviewer Lanes → Templates (explicit map)

The orchestrator loads the mapped template file and **embeds its full content** in that worker's prompt as the reviewer's Output Format contract. Do not rely on the worker resolving a path; embed the text (robust regardless of where the skill is installed).

| Lane | Template file | Notes |
|---|---|---|
| `correctness` | `templates/correctness.md` | |
| `conventions` | `templates/conventions.md` | one per language zone (e.g. `conventions:api`, `conventions:web`) |
| `contracts` | `templates/contracts.md` | |
| `spec-compliance` | `templates/spec-compliance.md` | |
| `structural-simplification` | `templates/structural-simplification.md` | |
| `test-reviewer` | `templates/tests.md` | file is `tests.md`, lane is `test-reviewer` |
| `specialist` | *(canonical shape from `templates/correctness.md`)* | loads its own domain skill (`skill://<name>`) for review knowledge; **output contract** is the Output Format section of `correctness.md` with the heading changed to `## <Domain> Specialist Review` — embed that section so the scratchpad aggregates like every other lane |

## Flow

### 1. Scope

- **Pin the PR head AND base, review only from those SHAs, never the local working tree.** For a remote PR: `gh pr view <n> --json headRefOid,baseRefOid` captures both SHAs at scope time. A local checkout may be on a stale branch, and the PR's current head can move after you pin it (a re-push mid-review), so anything but the captured SHAs silently reviews the wrong code (a common source of phantom findings, e.g. a "divergence" that does not exist at the pinned head). Build **one immutable diff** from the pinned SHAs — `gh api repos/<owner>/<repo>/compare/<base-sha>...<head-sha>` or `git diff <base-sha>...<head-sha>` — and hand THAT to reviewers. Use `gh pr diff <n>` only before pinning, or as a convenience after verifying the current head still equals your pinned SHA.
- **Capture the update target during scope.** Record `pinned_sha`, the reviewed branch, and its exact destination. For a PR, also capture `headRefName`, `headRepository`, `headRepositoryOwner`, and `isCrossRepository`, then resolve the push remote for that head repository. For a local-only review, record the full local ref `refs/heads/<branch>` and its current object ID. Treat `pinned_sha` as the expected old value for every later branch update.
- **No PR number (local-branch auto-detect):** the same pinning discipline applies — pin a SHA and review only from it.
  - **Pin first:** `pinned_sha=$(git rev-parse HEAD)` at scope time. That SHA — not "the current branch" — is the review head; if the user keeps committing, the review still covers `pinned_sha`. Everything below uses this variable, never a fresh `HEAD`.
  - **Base:** use `--base <ref>` if given. Otherwise discover the default branch and resolve it to a ref that **actually exists** (a local branch of that name may not exist, so prefer the remote-tracking form). The two discovery commands return **different shapes** — handle each: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` returns a **bare** name (`main`) → prefix it (`origin/main`); `git symbolic-ref --short refs/remotes/origin/HEAD` returns an **already-prefixed** ref (`origin/main`) → use as-is (do not prefix again). Verify with `git rev-parse --verify --quiet <ref>`; if it does not resolve, fall back to a local `<default>` only if it exists, else halt and ask for `--base`. Then `merge_base=$(git merge-base <resolved-base> "$pinned_sha")` — against the pinned SHA, never a live `HEAD`.
  - **Dirty tree:** uncommitted changes are excluded by design — `pinned_sha` covers committed state only. If `git status --porcelain` is non-empty, tell the user their uncommitted changes are not part of the review (commit them and re-run to include them).
  - **Content fetch:** reviewers read file contents via `git show "$pinned_sha":<path>` (or an isolated worktree at the pinned SHA: `git worktree add <dir> "$pinned_sha"`), never the checked-out tree. This is the sanctioned alternative to `gh pr diff` when no remote PR exists, and it satisfies "NEVER trust the local working tree": the working tree is untrusted, the pinned commit object is not.
  - **Changed files:** `git diff "$merge_base"..."$pinned_sha" --stat`.
- Group the immutable diff by top-level service/dir (for a PR, the pinned-SHA compare above; for a local branch, `git diff <merge-base>...<pinned-sha> --stat`). No changes → stop.

### 2. Decide Team Composition

| Failure mode | Lane | Signs in diff |
|---|---|---|
| Logic bugs, null checks, races | `correctness` | new branching, async, null-coalesce |
| Convention/style/lint/CI | `conventions` (per language) | changed files in a language zone |
| Schema / cross-service contract drift | `contracts` | shared types, schemas, API signatures |
| Missing/incomplete spec coverage | `spec-compliance` | new behavior not in plan/AGENTS.md |
| Unmaintainable structure | `structural-simplification` | large diffs, growing files, new shared-flow branching |
| Tests give false confidence | `test-reviewer` | diff touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, `spec/` |
| Language/framework idioms | `specialist` | `.rs`/`.go` etc. + a matching domain skill |

Rules: pick the **minimum set**; **cap at 5 spawned workers** — the cap counts workers, not lanes: each per-zone `conventions:<zone>` instance counts individually, because the refinement round is O(n²) in workers. If language zones push the count past 5, merge the least-changed zones into a single `conventions` worker, then drop optional lanes (`structural-simplification` first, then `specialist`); skip `structural-simplification` for tiny localized diffs; always include `spec-compliance` for features; add `test-reviewer` when test paths change; add a `specialist` only when a domain skill encodes knowledge the templates miss.

### 3. Present the Plan and Confirm the Action Mode

Before spawning any reviewer, complete two separate confirmation gates in order:

1. **Review plan:** Show the composition (lane → template → scope), worker harness and model, and pinned head SHA. Wait for the user to approve or revise the plan.
2. **Action mode:** After plan approval, ask the user to select exactly one mode:
   1. **Summary only (`summary`):** Return the unified verdict. Do not draft or post comments. Do not modify code.
   2. **Draft review comments for approval (`draft-comments`):** Return the unified verdict and exact proposed comments. Wait for explicit approval before posting them. Do not modify code.
   3. **Automatically post review feedback (`auto-post`):** Return the unified verdict and post the final review feedback without another approval. Do not modify code.
   4. **Automatically fix Critical/Important issues (`auto-fix`):** Have the orchestrator fix and verify eligible Critical and Important findings, then update the reviewed branch without another approval. Before spawning reviewers, require an unambiguous update target captured during scope. A local-only target must not be checked out in another worktree because updating its ref behind that worktree is unsafe. If these conditions are not met, report that `auto-fix` is unavailable and ask for another mode. Review workers remain read-only. Do not post review feedback. Keep changes that need design, planning, or a scope decision as proposals.

The modes are mutually exclusive. A mode named in the initial request may be shown as the proposed selection, but the user must confirm it after approving the plan. Never infer a mode from the request, plan approval, prior context, repository ownership, or available permissions. Never select a default. Spawn reviewers only after both gates are complete. If either answer is missing or ambiguous, stop and ask for it.

### 4. Spawn Reviewers as Solo Workers

Create **one todo per lane before spawning any worker** (so each worker's done-criteria map to a specific todo). Then spawn one worker per lane and smoke-test it before trusting it.

```
tools   = list_agent_tools()   # each entry exposes at least: id, name, tool_type
if caller_harness:  # honor EXACTLY (contract: see Prerequisites)
    harness = next((t for t in tools if t["name"] == caller_harness or t["id"] == caller_harness), None)
    if harness is None:
        halt_and_report(f"requested harness {caller_harness!r} not available; choices: {[t['name'] for t in tools]}")
else:               # any returned harness; if several, pick one and note it (see Prerequisites)
    harness = tools[0] if tools else None
if harness is None:
    halt_and_report("Solo has no agent harness registered")  # Solo MCP is the hard dep, not any particular harness

# Model passing: per-harness contract — Prerequisites is canonical.
def launch_args(harness, model):
    if model is None:
        return []                       # no model requested -> harness runs its saved default
    if harness["name"] == "Omp":
        return ["--model", model]       # Omp's contract: --model "<provider>/<model>", slugs from `omp models`
    # Unknown harness: DISCOVER its model flag before giving up — check the harness CLI's
    # `--help` output and its docs for a documented model option; if one exists, use it here.
    # Halt only when discovery finds no documented model mechanism.
    halt_and_report(f"harness {harness['name']!r} has no known model-passing mechanism to honor "
                    f"requested model {model!r} — pick a harness that supports it, or omit the model")

for lane in lanes:
    w = spawn_agent(agent_tool_id=harness["id"], name=f"review-{run}-{lane}",  # run = <pr-or-branch>-<short-sha> (+ timestamp for same-head reruns)
                    extra_args=launch_args(harness, requested_model))  # requested_model = caller's model, else None -> saved default
    send_input(process_id=w["process_id"],
               input=w["agent_instructions"] + "\n\n" + reviewer_prompt(lane), wait_ms=10000)
    #   good -> boot banner + starts reviewing
    #   bad  -> auth/model error banner ("No API key" / "not supported ...") -> close_process + next fallback
    #   empty output + NO error banner != broken: slow boot -> extend wait and re-read before concluding
    #   ALWAYS smoke-test: for a non-Omp harness this is how you confirm its default model actually runs
```

Each `reviewer_prompt(lane)` MUST:
- **Embed the mapped template's full content** (per the lane→template map) and instruct the worker to follow its Output Format exactly.
- **Carry the pinned head SHA and the orchestrator's immutable diff.** Instruct the worker to read head-of-PR file contents **only at the pinned SHA** (`gh api repos/<owner>/<repo>/contents/<path>?ref=<head-sha>`, or `git show <head-sha>:<path>`) plus the handed-over pinned diff — NEVER the local working tree, and NEVER a fresh `gh pr diff` (it re-resolves the current head and can drift from the pinned SHA).
- **Scope the lane:** the orchestrator's pinned diff for its area; `AGENTS.md` for conventions; CI commands to run **against the pinned head SHA** (conventions reviewers must run them and must NOT claim PASS for a check they did not run against the PR code; an isolated worktree at the pinned head SHA, building workspace deps first if needed, is the reliable way).
- **Deliver via one scratchpad:** write the complete review (all sections, including **Notes for Other Reviewers**) to `review-<run>-<lane>`. That scratchpad is the delivery channel and the cross-lane channel; the worker writes only its own. Do not report other lanes' issues as your own findings.
- **Treat any "facts" the orchestrator supplies as provisional** and verify them against the PR head; correct the orchestrator if wrong.
- For a `specialist`, instruct the worker to load its domain skill (`skill://<name>`) so it reviews with context. Its output contract is **the Output Format section of `templates/correctness.md`** (Verdict → Issues Critical/Important/Minor → Strengths → Notes for Other Reviewers), with the heading `## <Domain> Specialist Review`; embed that section in the prompt exactly as for template-backed lanes, and use the same scratchpad delivery.

### 5. Idle-Fire Dispatch Loop

Do not busy-poll. Arm one timer over the whole reviewer set. The wake `body` carries **no wake-reason** (the same body fires on idle, timeout, or exit), so inspect each worker yourself first.

```
timer_fire_when_idle_all(
  processes=[<all review worker process_ids>],
  max_wait_ms=600000,
  body="reviewers wake: FIRST get_process_status each worker; running/producing -> Failure & Timeout §2 (do not verify); exited/error -> Failure & Timeout §3 (crash recovery, do not send_input a dead process); idle -> read review-<run>-<lane>, if populated per its template todo_complete else send_input the missing section and re-arm.",
)
```

On wake, for each worker: call `get_process_status` (corroborate with `get_process_output`) and branch:
- **`running` / producing** → timeout handling (§2 below). Do NOT verify.
- **`exited` / error** → crash recovery (§3). Do NOT `send_input` or re-arm a dead process.
- **`idle`** → **idle != done**: read `review-<run>-<lane>`. If it holds a valid, template-formatted review, `todo_complete`. If empty/malformed, `send_input` the specific missing section (re-arming without corrective input is a no-op) and re-arm.

Use `timer_fire_when_idle_all` for the review barrier (all lanes must finish before refinement); `timer_fire_when_idle_any` when chasing a single laggard; `timer_set` for a plain delay.

### 6. Refinement Round

Once every lane's scratchpad is populated, the orchestrator reads all `review-<run>-<lane>` scratchpads (including each one's **Notes for Other Reviewers**), then dispatches amendment prompts to affected workers via `send_input` ("Given <other lane's finding>, amend / withdraw / escalate your finding X and update `review-<run>-<lane>`"). Re-arm `timer_fire_when_idle_any` for the amending workers and collect the updates. Dedupe issues raised by two lanes; drop findings another lane disproves. This catches duplicates, invalid findings, and issues that get more severe combined.

**Notes targeting a lane that was not spawned:** do NOT spawn that lane late. Record the note directly in the unified verdict under that lane's category (Critical/Important/Minor per the raising reviewer's severity), tagged as raised cross-lane and not reviewed by a dedicated lane.

**Hard cap: one amendment cycle per lane.** Each lane receives at most one amendment prompt; its updated scratchpad is final. If two lanes still disagree after that cycle (a finding–counterfinding pair), do NOT dispatch another round — the orchestrator adjudicates: keep both positions, mark the finding **Disputed** in the verdict with a one-line note per side, and let the human decide. This prevents amendment ping-pong between lanes.

### 7. Unified Verdict

Compile, deduped:

`Title (branch)` → `Verdict (READY | WITH_FIXES | NOT_READY)` → `Summary (2–3 sentences)` → `CI results (PASS/FAIL)` → `Critical` → `Important` → `Minor` → `Spec checklist` → `Strengths`.

- **Keep it human-scannable.** Lead with what does NOT block merge, then the few findings that matter as short bold headlines + their consequence. Push `file:line` detail, per-test lists, and logs down or out. The scratchpads keep the detail; the verdict is a summary for a human, not a transcript.
- **Red CI triage.** Read the failing job log and classify: code failure (introduced by the diff) vs environmental (missing secrets, fork-PR limitation, flakiness, unrelated pre-existing breakage). Prove it (e.g. all failures share a missing-key/auth cause while the unit suite is green). Do NOT claim a maintainer re-run fixes a fork-secret failure if the workflow runs secret-dependent tests unconditionally on `pull_request` — fork re-runs still receive no secrets; the real fix is a workflow change. Attribute a failure only to the cause the log shows.

### 8. Execute the Selected Action Mode

Posting and code changes are fail-closed. Perform neither unless the confirmed mode explicitly authorizes that action.

- **`summary`:** Present the unified verdict and stop.
- **`draft-comments`:** Present the unified verdict and the exact proposed comment text. Wait for explicit approval before posting. If approved, post only that text. Otherwise stop.
- **`auto-post`:** Post the final review feedback, then present the unified verdict with a link to the posted review. Do not preview it or request another approval because the confirmed mode is the posting authorization.
- **`auto-fix`:** Reviewer workers remain read-only. The orchestrator owns one isolated fix worktree created from `pinned_sha` and completes this phase without pausing:
  1. Build the fix set only from deduplicated, verified, non-disputed Critical and Important reviewer findings in the unified verdict. Keep Minor findings, lead-authored concerns, failed fixes, and changes that need design, planning, or a scope decision as proposals.
  2. Immediately before editing, read the destination head from its source of truth. For a PR, read `refs/heads/<reviewed-branch>` from the captured head-repository remote. For a local-only branch, read the captured local ref. Stop unless its object ID equals `pinned_sha` exactly.
  3. Create a new isolated worktree at `pinned_sha` and a temporary fix branch whose first commit descends directly from `pinned_sha`. Make all edits there. Do not edit the user's working tree, reuse a reviewer worktree, or invent findings while implementing the reviewed fix set.
  4. Run the targeted tests for every changed behavior, then run all repository-required checks for the affected areas. If any required check fails, do not commit or update the reviewed branch. Report the finding, command, and observed failure, then keep that fix as a proposal.
  5. Commit the complete verified fix set in the isolated worktree. If no verified changes remain, do not create a commit or update a branch.
  6. Immediately before integration, read the destination head again and require it to equal `pinned_sha`. For a remote PR branch, push the fix commit to the captured head-repository remote with `git push --force-with-lease=refs/heads/<reviewed-branch>:<pinned_sha> <head-remote> <fix-commit>:refs/heads/<reviewed-branch>`. A lease rejection is a stale-head stop; never retry with a broader force. For a local-only branch, run `git worktree list --porcelain` immediately before integration and stop if the target branch is checked out anywhere outside the isolated fix worktree. Only an unowned target ref may be updated with `git update-ref refs/heads/<reviewed-branch> <fix-commit> <pinned_sha>` as an atomic compare-and-swap. A worktree conflict or compare failure is the same stale-head stop; leave the verified fix commit available for manual review.
  7. Report the fix commit, destination, findings fixed, and validation results. Report each skipped or failed finding with its reason. If a stale-head check or integration fails, state that no branch update occurred and keep any verified commit available for manual review. Do not post review feedback.

Minor findings remain in the verdict and are never fixed automatically. The selected mode does not change during the run. A later request for an action outside that mode is a new explicit authorization.

### 9. Failure & Timeout Handling

- **§1 Scratchpad invalid / done-criteria fail:** `send_input` the specific gap and re-arm, up to a small retry cap (~2). On the cap, **escalate — the mechanism depends on the harness**: for `Omp`, `close_process` + `spawn_agent(extra_args=["--model", <stronger>])` (resend the full reviewer prompt, smoke-test, re-arm); for a harness whose model you control by its own flag, respawn with the stronger model in *that* harness's form; for a harness on a fixed default (non-Omp `launch_args` passes no model, so respawning it just relaunches the same default — not an escalation), instead switch to another available harness from `list_agent_tools` and respawn there. (`restart_process` only relaunches the same spec and cannot change the model.) If no stronger model and no alternate harness is available, abort the lane, mark its todo failed, record the reason in a scratchpad, and present that lane as MISSING in the verdict.
- **§2 Worker never goes idle (timeout wake, `running`):** distinguish stuck (no new output) from slow (still producing). Stuck → escalate per §1. Slow → extend `max_wait_ms` once (~2×) and re-arm.
- **§3 Worker crashes (`exited`/error):** re-spawn once on the same harness/model, then once escalated per §1 (stronger model if the harness supports it, else an alternate harness); if both fail, mark the todo blocked, raise an alert scratchpad, stop dispatching.
- **§4 `gh` failures (auth expired, rate limit, no permissions on a fork):** don't abort — fall back to plain git, but reconstruct **both** pinned SHAs (Scope requires base *and* head). (1) **Base remote:** `origin` is often the contributor's fork while `refs/pull/<n>/head` lives on the *base* repo — match `git remote -v` URLs to the base repo (or the conventional `upstream`) and verify with `git ls-remote --exit-code <base-remote> refs/pull/<n>/head`; if no remote exposes it, halt and ask the user to add the base repo as a remote. (2) **Head:** `git fetch <base-remote> refs/pull/<n>/head`, then capture `head_sha=$(git rev-parse FETCH_HEAD)` immediately (a later fetch overwrites `FETCH_HEAD`). (3) **Target base branch:** `refs/pull/<n>/head` does NOT reveal it and `gh` is down, so require `--base <ref>` (or another authoritative source for the PR's base) — **do not assume the default branch**, a non-default-base PR would be reviewed against the wrong base; if the base cannot be determined, halt and ask, do not proceed. (4) **Base SHA:** `git fetch <base-remote> <base-branch>`, then `base_sha=$(git rev-parse FETCH_HEAD)`. (5) Diff `git diff "$(git merge-base "$base_sha" "$head_sha")...$head_sha"` and read contents via `git show <sha>:<path>`. In the verdict, note that PR metadata (title, description, comments) is unavailable — and, if the base had to be supplied manually, note that too. Auth errors → tell the user to run `gh auth login`; rate limits → back off, don't retry in a loop.
- Use exponential backoff on re-arm (double `max_wait_ms`, cap ~10 min) so slow-but-progressing workers don't trigger wake storms.

### 10. Cleanup

`close_process` every reviewer worker. Leave the run-scoped `review-<run>-<lane>` scratchpads as the record — the `<run>` namespace (PR/branch + pinned short SHA, plus a timestamp/session id for identical-head reruns) keeps them from colliding with reviews of other PRs/branches, other heads, or earlier runs of the same head.

## Lock Ordering

Reviewers only read the repo and each writes its own scratchpad, so they parallelize freely. The exception is a reviewer that runs CI/tests: give each such worker its own **isolated worktree at the head SHA** (or have workers `lock_acquire` shared build resources in a consistent order, e.g. alphabetical by path) so concurrent builds don't clobber shared output or deadlock.

## Never

### Orchestrator (lead)
- **NEVER inject your own review findings.** The lead scopes, dispatches, aggregates, and presents; reviewers find. Mixing them destroys the parallel-perspective property.
- **NEVER present lead assumptions as established facts**, especially anything derived from a possibly-stale local tree. Label them provisional for reviewers to verify against the head.
- **NEVER exceed 5 spawned workers** (counted per worker, including each per-zone `conventions` instance). The refinement round scales O(n²).
- **NEVER assume idle means done.** Inspect `get_process_status` first, then verify the lane's scratchpad is populated per its template before completing.
- **NEVER hardcode the agent tool id, and NEVER bias selection toward a particular harness by name or `tool_type`** — resolve it at runtime via `list_agent_tools`: the caller-specified harness if given, else any returned entry (all are spawnable agent runtimes). If the caller named a harness that is not returned, **halt and report the choices — never silently substitute another.** Halt only when `list_agent_tools` returns nothing at all (Solo MCP is the hard dependency).
- **NEVER escalate a stuck/failed worker with `restart_process`** (it can't change the spec) — `close_process` + `spawn_agent`. And **NEVER "escalate" a fixed-default harness by respawning it unchanged** (that relaunches the same model); escalate via that harness's own model mechanism, or switch to another available harness, or mark the lane blocked.
- **NEVER spawn reviewers until the user has separately approved the plan and confirmed exactly one action mode after that approval.** A mode stated before plan approval must be confirmed again at the second gate.
- **NEVER infer, default, combine, or change the action mode.** Plan approval authorizes reviewer spawning only.
- **NEVER post review feedback in `summary` or `auto-fix`, and NEVER post `draft-comments` without separate explicit approval.**
- **NEVER modify code in `summary`, `draft-comments`, or `auto-post`.** In `auto-fix`, reviewer workers remain read-only and the orchestrator alone owns the isolated fix worktree, implementation, validation, commit, and integration.
- **NEVER expand `auto-fix` into a change that needs design, planning, or a scope decision.** Keep it as a proposal.
- **NEVER add a finding to the `auto-fix` set.** Fix only deduplicated, verified, non-disputed Critical and Important reviewer findings from the unified verdict.
- **NEVER edit or integrate when the destination head differs from `pinned_sha`.** Re-read it immediately before editing and immediately before pushing or updating the local ref.
- **NEVER push an unverified fix.** Targeted tests and every repository-required check for the affected areas must pass first.
- **NEVER use an unleased force push, weaken the expected old value, rebase onto a moved head, or overwrite a moved branch.**
- **NEVER use `git update-ref` on a branch checked out in another worktree.** Check `git worktree list --porcelain` immediately before the local compare-and-swap.
- **NEVER skip `close_process` cleanup.** Orphaned workers consume resources.
- **NEVER post to GitHub unless `auto-post` was confirmed at the second gate or the user explicitly approved the exact `draft-comments` text.**

### Reviewer (per worker)
- **NEVER trust the local working tree for a remote PR's current state.** Fetch head-of-PR contents; a stale tree yields findings already fixed at head.
- **NEVER claim a CI/lint/test PASS you did not run against the actual PR head** (conventions reviewers). Static assessment is not a PASS.
- **NEVER omit `file:line` from a finding.**
- **NEVER review outside your lane.** Put cross-lane concerns in the **Notes for Other Reviewers** section of your own `review-<run>-<lane>` scratchpad; the orchestrator routes them.
- **NEVER flag a test as tautological without naming the plausible bug it fails to catch** (test-reviewer).

### Worker mechanics
- **NEVER assume a harness takes Omp's model flag, and NEVER silently ignore a requested model** — model passing follows the per-harness contract in Prerequisites (canonical): halt or switch harnesses if a requested model can't be honored; a saved default is allowed only when no model was requested (smoke-test it).
- **NEVER trust spawn acceptance as readiness** — smoke-test with a real first prompt (prepend `agent_instructions`); a model that boots can still refuse the first turn. Empty output with no error banner is a slow boot, not a broken model — extend the wait and re-read.
- **NEVER send a bare prompt** — prepend `agent_instructions` so the worker has its Solo process/project context.
- **NEVER busy-poll process output** — wake on `timer_fire_when_idle_all/any`.
