---
name: solo-agents-team-review
description: Parallel multi-perspective code review orchestrated through Solo MCP worker sub-agents. Use when the user wants a thorough multi-agent review of a branch or PR before merge, run via Solo. Spawns one reviewer worker per lane (correctness, conventions, spec-compliance, contracts, structural-simplification, tests, specialists) and produces a single unified verdict. Self-contained (bundles its reviewer templates); harness-agnostic — the hard dependency is Solo MCP. Triggers on "/solo-agents-team-review", "solo team review", "solo agents review", "review PR with solo agents", "solo-orchestrated review".
---

# Solo Agents Team Review

Parallel, multi-perspective code review where each reviewer is a **Solo MCP worker sub-agent**. The orchestrator spawns one worker per review lane, wakes on idle instead of polling, collects each worker's findings from its own scratchpad, runs a refinement round, and presents one unified verdict.

**Self-contained.** This skill bundles its reviewer templates under `templates/` and depends on no other skill. It can be zipped and distributed as-is. It uses Solo MCP mechanics only (no Claude Code Agent Teams).

**No teammate message bus.** Solo workers cannot message each other. Each reviewer writes its **entire** review (findings *and* cross-lane hand-offs) to its own scratchpad, **named per run**: `review-<run>-<lane>`, where `<run>` = `<pr-or-branch>-<short-sha>` — the PR number (or a branch slug for local reviews) **plus the pinned head short SHA** (e.g. `review-333-aec7c4b-correctness`). Folding in the SHA keeps re-reviews of the same PR/branch at a *new* head from colliding with the old run's scratchpads; for repeated reviews of the *identical* head, also append a timestamp or session id. A bare `review-<lane>` collides across reviews, so **every operational reference in this document uses the full `review-<run>-<lane>` name** — worker write, barrier read, refinement update, and cleanup all name the same pad. The orchestrator aggregates and routes. Because every scratchpad is written by exactly one worker, there is no shared-file contention and no locking is needed.

## Prerequisites

- **Solo MCP available**, with a project selected. Run `whoami` only in a fresh session; `select_project` only if scope is unset.
- **An agent harness Solo can spawn.** Resolve it through the project-scoped runtime-capability cache in Step 3. A caller-specified harness always wins and must match a usable `name` or `id`; never silently substitute another harness. Without a caller choice, prefer the cached last-known-good harness, then fresh discovery. Halt only when fresh `list_agent_tools` discovery finds no spawnable harness.
- **A worker model that follows the selected harness's contract.** A caller-specified model always wins and uses that harness's documented mechanism. `Omp` accepts `--model <provider>/<model>`; other harnesses use their documented flags. A saved harness default is allowed only when the caller did not request a model. Every selected harness/model pair still receives a real-first-prompt smoke test.
- **Project-scoped runtime-capability cache.** Use Solo KV key `solo-agents-team-review/runtime-capabilities/v1` with a seven-day TTL (`604800` seconds). It may contain harness IDs, documented model mechanisms, discovered provider-qualified models, and the last-known-good selection. Never cache authentication, permissions, action modes, repository state, diffs, SHAs, prompts, or worker context. Caller choices override cached values.
- **`gh`** for PR metadata and diffs.

Stop only if Solo MCP (or a selected project scope) is genuinely unavailable, or Solo can spawn no agent harness at all.

## Invocation

```
/solo-agents-team-review                          # auto-detect scope from git
/solo-agents-team-review <pr-number>              # review a specific PR
/solo-agents-team-review --base develop           # diff against a different base
/solo-agents-team-review --refresh-runtime-cache  # bypass cached runtime capabilities
```

`--refresh-runtime-cache` forces one fresh capability discovery and replaces the cache only after a real first prompt verifies the selected runtime.

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
- **Capture only review identity during scope.** Record `pinned_sha`, the reviewed branch or PR, and the immutable base/head pair. Do not resolve a push remote, inspect worktree ownership for mutation safety, or perform another update preflight yet. Those checks are unnecessary for read-only modes and run only after the user confirms `auto-fix`, before any reviewer starts.
- **No PR number (local-branch auto-detect):** the same pinning discipline applies — pin a SHA and review only from it.
  - **Pin first:** `pinned_sha=$(git rev-parse HEAD)` at scope time. That SHA — not "the current branch" — is the review head; if the user keeps committing, the review still covers `pinned_sha`. Everything below uses this variable, never a fresh `HEAD`.
  - **Base:** use `--base <ref>` if given. Otherwise discover the default branch and resolve it to a ref that **actually exists** (a local branch of that name may not exist, so prefer the remote-tracking form). The two discovery commands return **different shapes** — handle each: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` returns a **bare** name (`main`) → prefix it (`origin/main`); `git symbolic-ref --short refs/remotes/origin/HEAD` returns an **already-prefixed** ref (`origin/main`) → use as-is (do not prefix again). Verify with `git rev-parse --verify --quiet <ref>`; if it does not resolve, fall back to a local `<default>` only if it exists, else halt and ask for `--base`. Then `merge_base=$(git merge-base <resolved-base> "$pinned_sha")` — against the pinned SHA, never a live `HEAD`.
  - **Dirty tree:** uncommitted changes are excluded by design — `pinned_sha` covers committed state only. If `git status --porcelain` is non-empty, tell the user their uncommitted changes are not part of the review (commit them and re-run to include them).
  - **Content fetch:** reviewers read file contents via `git show "$pinned_sha":<path>` (or an isolated worktree at the pinned SHA: `git worktree add <dir> "$pinned_sha"`), never the checked-out tree. This is the sanctioned alternative to `gh pr diff` when no remote PR exists, and it satisfies "NEVER trust the local working tree": the working tree is untrusted, the pinned commit object is not.
  - **Changed files:** `git diff "$merge_base"..."$pinned_sha" --stat`.
- Build **one canonical immutable diff** from the pinned base and head SHAs. Derive each lane's smallest safe slice from that exact diff before startup, preserving complete hunks and enough context to evaluate the change. Cross-cutting lanes may receive the full canonical diff when slicing would hide interactions. Record each slice with its lane and both SHAs. Reviewers may read file contents at `pinned_sha`, but they never generate, refresh, or re-derive a diff. No changes → stop.
- Materialize the pinned base and head objects once when possible. When available, workers use `git show <pinned_sha>:<path>` for supporting content. Use `gh api repos/<owner>/<repo>/contents/<path>?ref=<pinned_sha>` only when pinned local content is unavailable. Both paths read the captured SHA; neither permits a moving ref or the local working tree.

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
- Create one run-scoped, orchestrator-owned context packet at `review-<run>-context` after selecting the lanes. Write it once before worker spawn and keep it read-only. Include the pinned base/head SHAs, captured PR title/body/spec links, changed-file manifest, applicable repository instructions from pinned files, every lane's scope and slice identifier, the validation ownership map, and whether both pinned Git objects are available locally.
- Assign every validation command to exactly one selected lane before writing the packet. Put the command-to-owner map in the packet and each lane prompt. Other lanes perform static assessment and never duplicate an owned command.

### 3. Resolve Runtime, Present the Plan, and Confirm the Action Mode

Resolve runtime capabilities once before showing the plan:

```
CACHE_KEY = "solo-agents-team-review/runtime-capabilities/v1"
CACHE_TTL_SECONDS = 604800

cached = None if refresh_runtime_cache or caller_harness or caller_model else kv_get(CACHE_KEY)
capabilities = cached if valid_runtime_cache(cached) else discover_runtime_capabilities()
selection = select_runtime(capabilities, caller_harness, caller_model)
```

A caller-specified harness or model bypasses the default cache and uses fresh discovery so exact caller constraints cannot inherit a cached selection. A cache miss, read error, malformed value, or forbidden field also causes one fresh discovery. Discovery records only harness IDs, documented model mechanisms, and provider-qualified model IDs; it never probes or stores credentials. Do not write the cache yet.

Present one required confirmation form containing both fields:

1. **Plan decision:** `approve`, or a concrete revision to the shown composition (lane → template → pinned lane slice), validation ownership map, selected harness/model, and pinned head SHA.
2. **Action mode:** exactly one of:
   1. **Summary only (`summary`):** Return the unified verdict. Do not draft or post comments. Do not modify code.
   2. **Draft review comments for approval (`draft-comments`):** Return the unified verdict and exact proposed comments. Wait for explicit approval before posting them. Do not modify code.
   3. **Automatically post review feedback (`auto-post`):** Return the unified verdict and post the final review feedback without another approval. Do not modify code.
   4. **Automatically fix Critical/Important issues (`auto-fix`):** Have the orchestrator fix and verify eligible Critical and Important findings, then update the reviewed branch without another approval. Review workers remain read-only. Do not post review feedback. Keep changes that need design, planning, or a scope decision as proposals.

Both answers are mandatory. A value from the initial request may be preselected, but the user must confirm it in this form. Never infer or default either answer. A plan revision invalidates every mode selection, including one submitted with that revision: apply the revision and present both fields again. Spawn reviewers only when one response approves the current plan and confirms exactly one mode.

Only after `auto-fix` is confirmed, complete update preflight before spawning reviewers: capture the PR head repository and branch or the full local branch ref; resolve the exact update destination; require its object ID to equal `pinned_sha`; and reject a local target that `git worktree list --porcelain` shows as checked out elsewhere. If the target is ambiguous or unsafe, report that `auto-fix` is unavailable and present the combined form again for a new explicit mode.

### 4. Spawn Reviewers as Solo Workers

Create one todo per lane before spawning any worker. Then start every lane concurrently. The real first review prompt is the smoke test; never add a synthetic probe or a serial per-worker wait.

```
# Derive lane_inputs locally from canonical_diff before any worker call.

# Parallel tool-call batch A: one real Solo call per lane.
todo_create(<lane todo>) × lanes

# Parallel tool-call batch B: one real Solo call per lane.
spawn_agent(
    agent_tool_id=selection.harness_id,
    extra_args=launch_args(selection),
    name="review-<run>-<lane>",
) × lanes

# Parallel tool-call batch C: one real Solo call per spawned worker.
send_input(
    process_id=<lane process id>,
    input=<agent_instructions> + "\n\n" + reviewer_prompt(
        lane, pinned_base_sha, pinned_sha, lane_inputs[lane]
    ),
    wait_ms=250,
) × lanes

# Parallel tool-call batch D: both real inspection calls per worker.
get_process_status(process_id=<lane process id>) × lanes
get_process_output(process_id=<lane process id>) × lanes

# Only when batch D leaves slow boots ambiguous:
timer_fire_when_idle_any(
    processes=<ambiguous process ids>,
    max_wait_ms=<one bounded boot grace>,
    body="Inspect each ambiguous worker once; classify useful work, explicit failure, or timeout.",
)
```

Each `× lanes` line means issue the existing per-lane Solo calls together as one parallel tool-call batch. It does not name or require a batch API.

Treat a worker that is running or producing useful review output as ready. An explicit authentication, unsupported-model, missing-runtime, or launch-capability error fails immediately. Empty output without an error is an ambiguous slow boot: arm one delayed wake for only those workers, then inspect each once more. Never wait serially.

If a cached selection causes an explicit runtime-capability failure, close the affected workers and refresh discovery once. Reapply caller choices. If fresh discovery preserves the harness/model shown in the approved plan, retry only the affected lanes with their identical real prompts and pinned slices. If it changes that selection, close all workers and return to Step 3 so the updated plan and mode receive one new combined confirmation. Never silently change an approved runtime.

After the real prompt verifies an unconstrained selection, write the fresh capability set and last-known-good selection with `kv_set(CACHE_KEY, value, ttl_seconds=CACHE_TTL_SECONDS)`. Caller-constrained runs neither read nor overwrite the default cache. A cache write failure is non-fatal: continue with the verified workers, report it once, and do not repeat discovery only to populate the cache.

Each `reviewer_prompt(lane)` MUST:
- **Embed the mapped template's full content** (per the lane→template map) and instruct the worker to follow its Output Format exactly.
- **Carry the shared context packet and assigned immutable lane slice.** Include `review-<run>-context`, both pinned SHAs, and the lane's slice identifier. The packet is orchestrator-owned and read-only. State that the slice came from the one canonical diff.
- **Read supporting content from the pinned head only.** Prefer `git show <pinned_sha>:<path>` when the packet records local objects as available. Use the pinned GitHub content API only as fallback. Never use the local working tree, run `gh pr diff` or `git diff`, query a moving head, refresh the slice, or derive another diff.
- **Scope the lane to its assigned slice and contract.** Cross-cutting lanes may receive the full canonical diff. Pinned repository instructions and file contents may supply context but do not authorize expanding or reconstructing the diff.
- **Enforce single-owner validation.** Include the complete ownership map and identify this lane's commands. The owner runs each command once against an isolated checkout at `pinned_sha` and records the result. Non-owners perform static assessment only. Never claim PASS for a command that its owner did not run against pinned code.
- **Require a valid Finding Index.** Include one row for every Critical, Important, or Minor issue. Normalize fingerprint as `<file>:<symbol-or-region>:<failure-mode>`: exact diff path, exact source identifier or `<file-scope>`, and a concise lower-kebab-case failure mode. Set `Cross-lane` to `none` unless another lane must supply evidence or adjudication.
- **Deliver via one scratchpad:** write the complete review (all sections, including **Notes for Other Reviewers**) to `review-<run>-<lane>`. That scratchpad is the delivery channel and the cross-lane channel; the worker writes only its own. Do not report other lanes' issues as your own findings.
- **Treat any "facts" the orchestrator supplies as provisional** and verify them against the PR head; correct the orchestrator if wrong.
- For a `specialist`, instruct the worker to load its domain skill (`skill://<name>`) and use the Output Format from `templates/correctness.md`, including the Finding Index, issues, strengths, and notes. Change the heading to `## <Domain> Specialist Review` and the finding ID prefix to its specialist lane ID; embed the full contract and use the same scratchpad delivery.

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
- **`idle`** → **idle != done**: read `review-<run>-<lane>`. Complete its todo only when it contains a valid template-formatted review, Finding Index, and Notes section. If any part is empty or malformed, `send_input` the specific gap before re-arming.

Use `timer_fire_when_idle_all` for the review barrier (all lanes must finish before refinement); `timer_fire_when_idle_any` when chasing a single laggard; `timer_set` for a plain delay.

### 6. Refinement Round

Once every planned lane has a valid scratchpad, issue the `scratchpad_read` calls for all `review-<run>-<lane>` records as one parallel tool-call batch. Read each **Finding Index**, full findings, and **Notes for Other Reviewers**.

Skip amendment workers only when every condition is true:

1. every planned lane completed with a valid Finding Index;
2. no index contains a Critical finding;
3. every `Cross-lane` value is `none`;
4. every Notes section is exactly `- none`;
5. every Critical, Important, or Minor issue has exactly one matching index row; and
6. no fingerprint repeats within one lane or occurs in multiple lanes, and no two lanes report the same `<file>:<symbol-or-region>` pair.

An index is valid only when it has the template's five columns, uses the allowed severities, supplies a pinned `file:line`, normalizes the fingerprint path, region, and lower-kebab-case failure mode, and has no missing or orphan rows. A missing lane or malformed index disables the fast path.

When refinement is required, group all relevant evidence for each affected lane into one amendment prompt. Include matching fingerprints, complete involved findings, routed notes, and counterevidence. A Critical finding returns to its originating lane and one appropriate spawned peer when available. Each affected lane receives at most one prompt.

Issue the real `send_input(..., wait_ms=250)` calls for all affected lanes as one parallel tool-call batch. Then arm one barrier for the complete affected set:

```
timer_fire_when_idle_all(
    processes=[<all affected lane process ids>],
    max_wait_ms=<one bounded amendment wait>,
    body="amendment wake: inspect every affected worker, then read and validate each updated review-<run>-<lane> scratchpad",
)
```

On wake, inspect all affected workers and collect their updated scratchpads. Dedupe matching fingerprints, withdraw disproved findings, and escalate severity when combined evidence requires it. Do not add a serial prompt, per-lane timer, or second barrier.

**Notes targeting a lane that was not spawned:** do not spawn that lane late. Record the note in the unified verdict at the raising reviewer's severity, tagged as cross-lane and not reviewed by a dedicated lane.

**Hard cap: one amendment cycle per lane.** If lanes still disagree after that cycle, keep both positions, mark the finding **Disputed**, add one line per side, and leave the decision to the human.

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

- **Runtime capability or cache failure:** Treat an expired, malformed, unreadable, or rejected cache entry as unavailable. Refresh discovery once, reapply caller choices, and retry affected workers with the identical real first prompts and pinned slices only when the approved harness/model remains unchanged. If discovery changes the selection, return to the combined confirmation. Never fall back to the rejected cache. Cache write failure is non-fatal after successful smoke testing.
- **Ambiguous slow boot:** The concurrent `wait_ms=250` sends are intentionally short. After one parallel status/output inspection, arm one delayed wake for only the ambiguous workers. Explicit runtime errors fail immediately. Do not add per-worker serial waits.
- **§1 Scratchpad invalid / done-criteria fail:** `send_input` the specific gap and re-arm, up to a small retry cap (~2). On the cap, close the worker. Any escalation to a stronger model or alternate harness follows the runtime-selection rules: reuse the identical pinned SHAs, lane slice, template, and prompt; if the harness/model differs from the approved plan, return to Step 3 before respawning. If no approved selection can recover the lane, mark its todo failed, record the reason in a scratchpad, and present that lane as MISSING.
- **Validation owner failure:** Reassign a command once only when evidence proves its original owner did not start it. Record the override in orchestrator-owned `review-<run>-validation`, then send one corrective prompt to one surviving lane. If execution status is unknown, the command ran and failed, or the new owner cannot run it, report `MISSING` or the observed failure; never duplicate it or attempt a second reassignment.
- **§2 Worker never goes idle (timeout wake, `running`):** distinguish stuck (no new output) from slow (still producing). Stuck → escalate per §1. Slow → extend `max_wait_ms` once (~2×) and re-arm.
- **§3 Worker crashes (`exited`/error):** Re-spawn once with the same approved harness/model and identical prompt. A later escalation follows §1 and requires a new combined confirmation if the runtime changes. If recovery fails, mark the todo blocked, raise an alert scratchpad, and stop dispatching that lane.
- **§4 `gh` failures (auth expired, rate limit, no permissions on a fork):** don't abort — fall back to plain git, but reconstruct **both** pinned SHAs (Scope requires base *and* head). (1) **Base remote:** `origin` is often the contributor's fork while `refs/pull/<n>/head` lives on the *base* repo — match `git remote -v` URLs to the base repo (or the conventional `upstream`) and verify with `git ls-remote --exit-code <base-remote> refs/pull/<n>/head`; if no remote exposes it, halt and ask the user to add the base repo as a remote. (2) **Head:** `git fetch <base-remote> refs/pull/<n>/head`, then capture `head_sha=$(git rev-parse FETCH_HEAD)` immediately (a later fetch overwrites `FETCH_HEAD`). (3) **Target base branch:** `refs/pull/<n>/head` does NOT reveal it and `gh` is down, so require `--base <ref>` (or another authoritative source for the PR's base) — **do not assume the default branch**, a non-default-base PR would be reviewed against the wrong base; if the base cannot be determined, halt and ask, do not proceed. (4) **Base SHA:** `git fetch <base-remote> <base-branch>`, then `base_sha=$(git rev-parse FETCH_HEAD)`. (5) Diff `git diff "$(git merge-base "$base_sha" "$head_sha")...$head_sha"` and read contents via `git show <sha>:<path>`. In the verdict, note that PR metadata (title, description, comments) is unavailable — and, if the base had to be supplied manually, note that too. Auth errors → tell the user to run `gh auth login`; rate limits → back off, don't retry in a loop.
- Use exponential backoff on re-arm (double `max_wait_ms`, cap ~10 min) so slow-but-progressing workers don't trigger wake storms.

### 10. Cleanup

`close_process` every reviewer worker. Leave `review-<run>-context`, any `review-<run>-validation` override record, and the run-scoped lane scratchpads as the review record. Never reuse them for another run, including a rerun at the same head SHA.

## Lock Ordering

Reviewers only read the repo and each writes its own scratchpad, so they parallelize freely. The exception is a reviewer that runs CI/tests: give each such worker its own **isolated worktree at the head SHA** (or have workers `lock_acquire` shared build resources in a consistent order, e.g. alphabetical by path) so concurrent builds don't clobber shared output or deadlock.

## Never

### Orchestrator (lead)
- **NEVER inject your own review findings.** The lead scopes, dispatches, aggregates, and presents; reviewers find. Mixing them destroys the parallel-perspective property.
- **NEVER present lead assumptions as established facts**, especially anything derived from a possibly-stale local tree. Label them provisional for reviewers to verify against the head.
- **NEVER exceed 5 spawned workers** (counted per worker, including each per-zone `conventions` instance). The refinement round scales O(n²).
- **NEVER assume idle means done.** Inspect `get_process_status` first, then verify the lane's scratchpad is populated per its template before completing.
- **NEVER hardcode or silently substitute a harness or model.** Bypass the default cache whenever the caller names either value. Use cached last-known-good selection only for unconstrained runs, and refresh discovery once when it fails. If the selected runtime changes after approval, return to confirmation before spawning again.
- **NEVER escalate a stuck/failed worker with `restart_process`** (it cannot change the spec). Close and respawn it under Failure & Timeout Handling, always with the original pinned SHAs and lane slice.
- **NEVER spawn reviewers until one response explicitly approves the current plan and confirms exactly one action mode.** Any plan revision invalidates the mode and requires the complete combined form again.
- **NEVER infer, default, or change either confirmation value.** The approved plan and confirmed mode remain separate explicit fields in the same interaction.
- **NEVER cache authentication, permissions, action modes, repository state, diffs, SHAs, prompts, or worker context.**
- **NEVER resolve push remotes or inspect worktrees for mutation safety before `auto-fix` is confirmed.** Complete that preflight before reviewer spawn when `auto-fix` is selected.
- **NEVER spawn or smoke-test reviewers serially.** Create todos, spawn workers, send real first prompts with `wait_ms=250`, and inspect status/output as parallel batches. Use one delayed wake only for ambiguous slow boots.
- **NEVER derive more than one canonical diff or let a lane reconstruct one.** Every lane slice comes from the pinned canonical diff; use the full canonical diff when a cross-cutting slice would hide interactions.
- **NEVER let a worker create, modify, or replace `review-<run>-context` or `review-<run>-validation`.**
- **NEVER prefer a network read when the required pinned Git object is available locally.**
- **NEVER assign one validation command to multiple lanes or let an unassigned lane run it.** Reassign once only when the original command provably did not start; otherwise report the known result or `MISSING`.
- **NEVER take the refinement fast path with a missing lane or Critical, malformed, duplicate, cross-lane, or noted finding.**
- **NEVER dispatch amendment prompts serially or run more than one amendment cycle per lane.** Send one complete prompt per affected lane as a parallel batch, then use one `timer_fire_when_idle_all` barrier.
- **NEVER reuse an earlier run's result solely because its head SHA matches.**
- **NEVER post review feedback in `summary` or `auto-fix`, and NEVER post `draft-comments` without separate explicit approval.**
- **NEVER modify code in `summary`, `draft-comments`, or `auto-post`.** In `auto-fix`, reviewer workers remain read-only and the orchestrator alone owns the isolated fix worktree, implementation, validation, commit, and integration.
- **NEVER expand `auto-fix` into a change that needs design, planning, or a scope decision.** Keep it as a proposal.
- **NEVER add a finding to the `auto-fix` set.** Fix only deduplicated, verified, non-disputed Critical and Important reviewer findings from the unified verdict.
- **NEVER edit or integrate when the destination head differs from `pinned_sha`.** Re-read it immediately before editing and immediately before pushing or updating the local ref.
- **NEVER push an unverified fix.** Targeted tests and every repository-required check for the affected areas must pass first.
- **NEVER use an unleased force push, weaken the expected old value, rebase onto a moved head, or overwrite a moved branch.**
- **NEVER use `git update-ref` on a branch checked out in another worktree.** Check `git worktree list --porcelain` immediately before the local compare-and-swap.
- **NEVER skip `close_process` cleanup.** Orphaned workers consume resources.
- **NEVER post to GitHub unless `auto-post` was confirmed in the combined form or the user explicitly approved the exact `draft-comments` text.**

### Reviewer (per worker)
- **NEVER trust the local working tree for a remote PR's current state.** Fetch head-of-PR contents; a stale tree yields findings already fixed at head.
- **NEVER claim a CI/lint/test PASS you did not run against the actual PR head** (conventions reviewers). Static assessment is not a PASS.
- **NEVER omit `file:line` from a finding.**
- **NEVER review outside your lane.** Put cross-lane concerns in the **Notes for Other Reviewers** section of your own `review-<run>-<lane>` scratchpad; the orchestrator routes them.
- **NEVER generate, refresh, or re-derive a diff.** Review only the assigned immutable lane slice, or the full canonical diff when supplied, and read supporting file contents only at `pinned_sha`.
- **NEVER modify the shared context or validation-override record, or substitute moving PR metadata for pinned values.**
- **NEVER run a validation command assigned to another lane.**
- **NEVER omit or malform the Finding Index.** Give every Critical, Important, or Minor issue one row and normalize its fingerprint.
- **NEVER flag a test as tautological without naming the plausible bug it fails to catch** (test-reviewer).

### Worker mechanics
- **NEVER assume a harness takes Omp's model flag, silently ignore a requested model, or switch runtime after approval.** Model passing follows Prerequisites; a changed harness/model requires a new combined confirmation before spawn.
- **NEVER trust spawn acceptance as readiness.** Send the real reviewer prompt as the smoke test with `wait_ms=250`, then inspect all worker statuses and outputs once in parallel. Use one delayed wake only for ambiguous slow boots; explicit runtime errors use the one-refresh fallback.
- **NEVER send a bare prompt** — prepend `agent_instructions` so the worker has its Solo process/project context.
- **NEVER busy-poll process output** — wake on `timer_fire_when_idle_all/any`.
