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
- **Capture authoritative CI evidence once after pinning.** Build one immutable snapshot from check runs for `pinned_sha` plus the referenced workflow/job metadata needed to identify them. An explicit command mapping may come from pinned repository instructions or a pinned workflow step that literally executes that exact command; inferred equivalence is forbidden. The mapping must include workflow path or stable ID, check/job identity, and trusted app identity. Accept one unique result only when `head_sha == pinned_sha`, status is `completed`, and conclusion is `success`. Reject skipped, neutral, stale, merge-ref, pending, cancelled, timed-out, duplicated, or ambiguous evidence. Names alone never prove equivalence. Any gap falls back to local validation; never poll the snapshot again.
- Start phase timing at scope entry. Keep timestamps in orchestrator memory and write elapsed durations once at cleanup; never record prompts, source code, command output, environment values, credentials, or secrets.
- After `pinned_sha` is known, issue independent PR/spec metadata reads, CI evidence capture, pinned-object materialization, and runtime-cache read as the earliest possible parallel tool-call batch. Do not serialize these preflight reads; derive the diff and runtime selection only after their required inputs arrive.

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

Rules: pick the **minimum set**; **cap at 5 spawned reviewer workers** — the cap counts workers, not lanes: each per-zone `conventions:<zone>` instance counts individually, because the refinement round is O(n²) in workers. If language zones push the count past 5, merge the least-changed zones into a single `conventions` worker, then drop optional lanes (`structural-simplification` first, then `specialist`); skip `structural-simplification` for tiny localized diffs; always include `spec-compliance` for features; add `test-reviewer` when test paths change; add a `specialist` only when a domain skill encodes knowledge the templates miss. Orchestrator-owned validation terminals are outside the review team and do not count toward this cap.
- Assign every required command to exactly one evidence owner: one accepted authoritative CI result or the orchestrator-owned local validation runner. Reviewer lanes perform static assessment only and never execute validation.
- Prepare the candidate context and validation records from the proposed plan, but do not write either scratchpad until the current plan and mode are confirmed. A plan revision invalidates these candidate records.

### 3. Resolve Runtime, Present the Plan, and Confirm the Action Mode

Resolve runtime capabilities once before showing the plan:

```
CACHE_KEY = "solo-agents-team-review/runtime-capabilities/v1"
CACHE_TTL_SECONDS = 604800

cached = None if refresh_runtime_cache or caller_harness or caller_model else prefetched_runtime_cache
capabilities = cached if valid_runtime_cache(cached) else discover_runtime_capabilities()
selection = select_runtime(capabilities, caller_harness, caller_model)
```

A caller-specified harness or model bypasses the default cache and uses fresh discovery so exact caller constraints cannot inherit a cached selection. A cache miss, read error, malformed value, or forbidden field also causes one fresh discovery. Discovery records only harness IDs, documented model mechanisms, and provider-qualified model IDs; it never probes or stores credentials. Do not write the cache yet.

Track these durations separately: `scope`, `machine preflight`, `human confirmation`, `reviewer startup`, `validation`, `review lanes`, `refinement`, and `selected action`. Measure human confirmation from form presentation through approval and exclude it from machine preflight. Report timings to the user after the run, never in posted review text.

Present one required confirmation form containing both fields:

1. **Plan decision:** `approve`, or a concrete revision to the shown composition (lane → template → pinned lane slice), selected harness/model, pinned head SHA, and validation plan. The validation plan lists each command, its one evidence owner, accepted exact-SHA CI evidence, local commands, repository-declared parallel-safe groups, and sequential groups.
2. **Action mode:** exactly one of:
   1. **Summary only (`summary`):** Return the unified verdict. Do not draft or post comments. Do not modify code.
   2. **Draft review comments for approval (`draft-comments`):** Return the unified verdict and exact proposed comments. Wait for explicit approval before posting them. Do not modify code.
   3. **Automatically post review feedback (`auto-post`):** Return the unified verdict and post the final review feedback without another approval. Do not modify code.
   4. **Automatically fix Critical/Important issues (`auto-fix`):** Have the orchestrator fix and verify eligible Critical and Important findings, then update the reviewed branch without another approval. Review workers remain read-only. Do not post review feedback. Keep changes that need design, planning, or a scope decision as proposals.

Both answers are mandatory. A value from the initial request may be preselected, but the user must confirm it in this form. Never infer or default either answer. A plan revision invalidates every mode selection, including one submitted with that revision: apply the revision and present both fields again. Spawn reviewers only when one response approves the current plan and confirms exactly one mode.

Only after `auto-fix` is confirmed, complete update preflight before spawning reviewers: capture the PR head repository and branch or the full local branch ref; resolve the exact update destination; require its object ID to equal `pinned_sha`; and reject a local target that `git worktree list --porcelain` shows as checked out elsewhere. If the target is ambiguous or unsafe, report that `auto-fix` is unavailable and present the combined form again for a new explicit mode.

After confirmation and any `auto-fix` preflight, initialize orchestrator-owned `review-<run>-validation`, then write `review-<run>-context` once and keep it read-only. Include only the approved pinned SHAs, PR/spec context, changed-file manifest, pinned instructions, lane scopes and slices, exact commands, evidence owners, accepted CI evidence, validation scratchpad identity, and local-object availability.

#### Lane context

Keep `review-<run>-context` as the immutable audit record and compute its SHA-256 fingerprint from the exact packet content. Before any worker spawns, derive and validate `lane_context[lane]` only from that approved packet and the canonical diff.

Each lane context contains the packet schema/version and fingerprint; pinned base/head SHAs; lane ID, template, and approved scope; complete immutable lane slice; full applicable pinned repository instructions and file mapping; captured PR title/body and spec links; pinned-content read method; lane-relevant validation evidence owners; validation scratchpad identity; and exact output scratchpad name.

The normal path inlines every required field. If the packet contains the field, repair an incomplete lane context before spawn. A genuinely absent required field marks the lane MISSING. Only a field explicitly marked `externalized` in the approved packet may use fallback: record one exact packet heading in the lane context and permit one section read. Never permit a full-packet read, another section, a second fallback read, live metadata, or context reconstruction.

### 4. Start Reviewers and Missing Validation Concurrently

Create one todo per reviewer lane. Start every reviewer concurrently and, in the same startup phase, start local validation for commands without accepted CI evidence. The real first review prompt is the smoke test; never add a synthetic probe or serial per-worker wait.

```
# Derive and validate lane_context[lane] from the approved immutable packet
# and canonical_diff before any worker call.

# Parallel tool-call batch A: one real Solo call per lane.
todo_create(<lane todo>) × lanes

# Parallel tool-call batch B: one real Solo call per lane.
spawn_agent(
    agent_tool_id=selection.harness_id,
    extra_args=launch_args(selection),
    name="review-<run>-<lane>",
) × lanes

# When local validation is needed, prepare one isolated worktree at pinned_sha.
# Spawn one real Solo terminal per validation command group.
spawn_process(
    kind="terminal",
    name="review-<run>-validation-<group>",
) × validation_command_groups

send_input(
    process_id=<validation group process id>,
    input=<command sequence in the single validation worktree>,
    submit=true,
    wait_ms=250,
) × validation_command_groups

# Parallel-safe commands use separate groups. Conflicting or unclassified commands share a group and run sequentially.

# Parallel tool-call batch C: one real Solo call per spawned worker.
send_input(
    process_id=<lane process id>,
    input=<agent_instructions> + "\n\n" + reviewer_prompt(
        lane, lane_context[lane]
    ),
    wait_ms=250,
) × lanes

# Parallel tool-call batch D: inspect all reviewer and validation processes.
get_process_status(process_id=<process id>) × all_started_processes
get_process_output(process_id=<process id>) × all_started_processes

# Only when batch D leaves slow boots ambiguous:
timer_fire_when_idle_any(
    processes=<ambiguous process ids>,
    max_wait_ms=<one bounded boot grace>,
    body="Inspect each ambiguous worker once; classify useful work, explicit failure, or timeout.",
)
```

Each `× ...` line means issue the named existing Solo calls as one parallel tool-call batch. It does not name or require a batch API.

Treat a worker that is running or producing useful review output as ready. An explicit authentication, unsupported-model, missing-runtime, or launch-capability error fails immediately. Empty output without an error is an ambiguous slow boot: arm one delayed wake for only those workers, then inspect each once more. Never wait serially.

If a cached selection causes an explicit runtime-capability failure, close the affected workers and refresh discovery once. Reapply caller choices. If fresh discovery preserves the harness/model shown in the approved plan, retry only the affected lanes with their identical real prompts and pinned slices. If it changes that selection, close all workers and return to Step 3 so the updated plan and mode receive one new combined confirmation. Never silently change an approved runtime.

After the real prompt verifies an unconstrained selection, write the fresh capability set and last-known-good selection with `kv_set(CACHE_KEY, value, ttl_seconds=CACHE_TTL_SECONDS)`. Caller-constrained runs neither read nor overwrite the default cache. A cache write failure is non-fatal: continue with the verified workers, report it once, and do not repeat discovery only to populate the cache.

The CI snapshot and local terminals form one evidence pipeline. Each terminal group emits an explicit start marker, end marker, and independent exit status for every command, and continues to the remaining commands after a failure. The orchestrator writes each command, evidence owner, pinned SHA, terminal state, exit status, and bounded secret-redacted evidence to `review-<run>-validation`. Reviewer workers never write that scratchpad. Parallelize only repository-declared safe groups; unclassified or conflicting commands run sequentially in the same validation worktree.

Each `reviewer_prompt(lane)` MUST:
- **Embed the mapped template's full content** (per the lane→template map) and instruct the worker to follow its Output Format exactly.
- **Embed the complete validated `lane_context[lane]` in the real first prompt.** Include its packet schema/version and SHA-256 fingerprint, both pinned SHAs, lane identity/template/scope, complete immutable slice, applicable pinned instructions, captured PR/spec context, pinned-content read method, lane-relevant validation owners, validation scratchpad identity, and exact output scratchpad. The worker does not read `review-<run>-context` on the normal path.
- **Fail closed on missing inline context.** Repair fields from the approved packet before spawn. A genuinely absent required field marks the lane MISSING. Only an explicitly `externalized` field may name one exact packet heading as fallback; the worker may read that section once and nothing else.
- **Read supporting content from the pinned head only.** Use the method embedded in `lane_context[lane]`: prefer `git show <pinned_sha>:<path>` when local objects are available, otherwise use the pinned GitHub content API. Never use the local working tree, run `gh pr diff` or `git diff`, query a moving head, refresh the slice, or derive another diff.
- **Scope the lane to its inline approved scope and contract.** Cross-cutting lanes may receive the full canonical diff. Inline pinned instructions and file contents may supply context but do not authorize expanding or reconstructing the diff.
- **Enforce static review.** Use inline lane-relevant validation owners and `review-<run>-validation`. The reviewer may assess CI configuration and available evidence, but never runs a validation command or claims PASS without orchestrator-owned evidence.
- **Require a valid Finding Index.** Include one row for every Critical, Important, or Minor issue. Normalize fingerprint as `<file>:<symbol-or-region>:<failure-mode>`: exact diff path, exact source identifier or `<file-scope>`, and a concise lower-kebab-case failure mode. Set `Cross-lane` to `none` unless another lane must supply evidence or adjudication.
- **Deliver via one scratchpad:** write the complete review (all sections, including **Notes for Other Reviewers**) to `review-<run>-<lane>`. That scratchpad is the delivery channel and the cross-lane channel; the worker writes only its own. Do not report other lanes' issues as your own findings.
- **Treat any "facts" the orchestrator supplies as provisional** and verify them against the PR head; correct the orchestrator if wrong.
- For a `specialist`, instruct the worker to load its domain skill (`skill://<name>`) and use the Output Format from `templates/correctness.md`, including the Finding Index, issues, strengths, and notes. Change the heading to `## <Domain> Specialist Review` and the finding ID prefix to its specialist lane ID; embed the full contract and use the same scratchpad delivery.

### 5. Reviewer and Validation Barrier

Do not busy-poll. Missing validation runs beside reviewer work. Arm one whole-set timer for reviewer workers and, only when local commands exist, one for validation terminals:

```
timer_fire_when_idle_all(
  processes=[<all review worker process ids>],
  max_wait_ms=600000,
  body="reviewers wake: inspect every worker; for idle lanes read headings, Finding Index, Notes, and Issues only when indexed; complete valid lanes or send one corrective prompt.",
)

timer_fire_when_idle_all(
  processes=[<all validation terminal process ids>],
  max_wait_ms=600000,
  body="validation wake: inspect every terminal and record each terminal command state and result in review-<run>-validation.",
)
```

When every command has accepted CI evidence, do not create a validation worktree or terminal and treat the validation process barrier as already complete.

For each idle reviewer, issue `scratchpad_read(mode="headings")`, then section reads for **Finding Index** and **Notes for Other Reviewers**. Read **Issues** only when the index has rows. Complete the lane only when those sections are valid and every indexed issue has one matching detailed issue.

For validation terminals, a failed command is complete evidence. An absent or still-running result keeps the validation barrier closed. After recovery is exhausted, record a terminal `MISSING` result so the barrier can close without inventing PASS. The unified-verdict barrier opens only when every planned lane has a valid review or recorded lane failure and every required command has `PASS`, `FAIL`, or `MISSING` evidence.

Use `timer_fire_when_idle_any` for one laggard and `timer_set` for a plain delay. Never send validation work to a reviewer.

### 6. Refinement Round

Once every planned lane reaches the barrier, reuse the headings, Finding Index, Notes, and indexed Issues sections already read in Step 5. Issue only missing `scratchpad_read(mode="section")` calls as one parallel batch; never re-read an unchanged section or a full scratchpad. Fetch Strengths, requirements, or another section only when needed for refinement or the verdict.


Skip amendment workers only when every condition is true:

1. every planned lane completed with a valid Finding Index;
2. no index contains a Critical finding;
3. every `Cross-lane` value is `none`;
4. every Notes section is exactly `- none`;
5. every Critical, Important, or Minor issue has exactly one matching index row; and
6. no fingerprint repeats within one lane or occurs in multiple lanes, and no two lanes report the same `<file>:<symbol-or-region>` pair.

An index is valid only when it has the template's five columns, uses the allowed severities, supplies a pinned `file:line`, normalizes the fingerprint path, region, and lower-kebab-case failure mode, and has no missing or orphan rows. A missing lane or malformed index disables the fast path.

When refinement is required, fetch only the complete indexed findings and routed notes involved. Group all relevant evidence for each affected lane into one amendment prompt. Include matching fingerprints and counterevidence. A Critical finding returns to its originating lane and one appropriate spawned peer when available. Each affected lane receives at most one prompt.

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

`Title (branch)` → `Verdict (READY | WITH_FIXES | NOT_READY)` → `Summary (2–3 sentences)` → `Validation evidence (authoritative CI or local PASS/FAIL/MISSING)` → `Critical` → `Important` → `Minor` → `Spec checklist` → `Strengths`.

- **Keep it human-scannable.** Lead with what does NOT block merge, then the few findings that matter as short bold headlines + their consequence. Push `file:line` detail, per-test lists, and logs down or out. The scratchpads keep the detail; the verdict is a summary for a human, not a transcript.
- **Validation evidence.** Use only `review-<run>-validation`. For CI reuse, show the exact mapped workflow/check identity and `pinned_sha`; never infer equivalence from names. For local validation, show the command and observed result. Missing or ambiguous evidence is not PASS.
- **Red CI triage.** Read accepted check evidence and a failing job log only when needed. Classify code versus environmental failure from observed evidence; an environmental explanation never converts a failed required command into PASS.
- **Timings.** Write durations once to `review-<run>-timings` and report them separately to the user. Keep them out of draft or posted review text.

### 8. Execute the Selected Action Mode

Posting and code changes are fail-closed. Perform neither unless the confirmed mode explicitly authorizes that action.
Pre-fix validation evidence never satisfies post-fix verification. In `auto-fix`, run new targeted and repository-required checks after editing and record those results separately.

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

- **Lane-context validation failure:** Do not spawn a lane with an incomplete schema or mismatched packet fingerprint. Repair only from the approved immutable packet. A genuinely absent required field marks the lane MISSING. Permit fallback only for one explicitly `externalized` field and exact packet heading. A worker that reads the packet on the normal path, reads broadly, uses a second fallback, queries live metadata, or reconstructs context violates the prompt contract: close it and recover with the identical validated inline context.
- **Runtime capability or cache failure:** Treat an expired, malformed, unreadable, or rejected cache entry as unavailable. Refresh discovery once, reapply caller choices, and retry affected workers with the identical real first prompts and pinned slices only when the approved harness/model remains unchanged. If discovery changes the selection, return to the combined confirmation. Never fall back to the rejected cache. Cache write failure is non-fatal after successful smoke testing.
- **Ambiguous slow boot:** The concurrent `wait_ms=250` sends are intentionally short. After one parallel status/output inspection, arm one delayed wake for only the ambiguous workers. Explicit runtime errors fail immediately. Do not add per-worker serial waits.
- **§1 Scratchpad invalid / done-criteria fail:** `send_input` the specific gap and re-arm, up to a small retry cap (~2). On the cap, close the worker. Any escalation to a stronger model or alternate harness follows the runtime-selection rules: reuse the identical pinned SHAs, lane slice, template, and prompt; if the harness/model differs from the approved plan, return to Step 3 before respawning. If no approved selection can recover the lane, mark its todo failed, record the reason in a scratchpad, and present that lane as MISSING.
- **Validation runner failure:** A reviewer never inherits validation. Recover one local terminal for the command in the single validation worktree only when prior execution provably did not start. If status is unknown, the command failed, or recovery cannot produce a result, record `MISSING` or the observed failure in `review-<run>-validation`. Never duplicate execution, infer PASS, or assign the command to a lane.
- **CI evidence ambiguity:** Any absent mapping, name-only match, missing identity, non-unique run, wrong `head_sha`, merge-ref result, untrusted app, incomplete run, or non-success conclusion fails closed to local validation. Do not refresh or poll the captured CI snapshot.
- **Validation timeout:** Distinguish a producing terminal from a stuck one. Extend a producing terminal once. Recover a stuck terminal only when the command provably did not start; otherwise preserve the observed status and record `MISSING` or failure.
- **§2 Worker never goes idle (timeout wake, `running`):** distinguish stuck (no new output) from slow (still producing). Stuck → escalate per §1. Slow → extend `max_wait_ms` once (~2×) and re-arm.
- **§3 Worker crashes (`exited`/error):** Re-spawn once with the same approved harness/model and identical prompt. A later escalation follows §1 and requires a new combined confirmation if the runtime changes. If recovery fails, mark the todo blocked, raise an alert scratchpad, and stop dispatching that lane.
- **§4 `gh` failures (auth expired, rate limit, no permissions on a fork):** don't abort — fall back to plain git, but reconstruct **both** pinned SHAs (Scope requires base *and* head). (1) **Base remote:** `origin` is often the contributor's fork while `refs/pull/<n>/head` lives on the *base* repo — match `git remote -v` URLs to the base repo (or the conventional `upstream`) and verify with `git ls-remote --exit-code <base-remote> refs/pull/<n>/head`; if no remote exposes it, halt and ask the user to add the base repo as a remote. (2) **Head:** `git fetch <base-remote> refs/pull/<n>/head`, then capture `head_sha=$(git rev-parse FETCH_HEAD)` immediately (a later fetch overwrites `FETCH_HEAD`). (3) **Target base branch:** `refs/pull/<n>/head` does NOT reveal it and `gh` is down, so require `--base <ref>` (or another authoritative source for the PR's base) — **do not assume the default branch**, a non-default-base PR would be reviewed against the wrong base; if the base cannot be determined, halt and ask, do not proceed. (4) **Base SHA:** `git fetch <base-remote> <base-branch>`, then `base_sha=$(git rev-parse FETCH_HEAD)`. (5) Diff `git diff "$(git merge-base "$base_sha" "$head_sha")...$head_sha"` and read contents via `git show <sha>:<path>`. In the verdict, note that PR metadata (title, description, comments) is unavailable — and, if the base had to be supplied manually, note that too. Auth errors → tell the user to run `gh auth login`; rate limits → back off, don't retry in a loop.
- Use exponential backoff on re-arm (double `max_wait_ms`, cap ~10 min) so slow-but-progressing workers don't trigger wake storms.

### 10. Cleanup

`close_process` every reviewer worker and validation terminal. Remove the single validation worktree only after those terminals stop. Write elapsed durations once to `review-<run>-timings`. Leave the context, validation, timings, and lane scratchpads as the run record; never reuse them, including at the same head SHA.

## Lock Ordering

Reviewer workers only read pinned content and write their own scratchpads. They never acquire validation locks. The orchestrator acquires shared resources in this order: review-run coordination lock → validation-worktree lock → repository-declared command-resource lock (stable name order) → orchestrator scratchpad write lock. Release in reverse. Prepare one validation worktree. Parallelize only repository-declared safe command groups; serialize groups that share a resource.

## Never

### Orchestrator (lead)
- **NEVER inject your own review findings.** The lead scopes, dispatches, aggregates, and presents; reviewers find. Mixing them destroys the parallel-perspective property.
- **NEVER present lead assumptions as established facts**, especially anything derived from a possibly-stale local tree. Label them provisional for reviewers to verify against the head.
- **NEVER exceed 5 spawned reviewer workers** (including each per-zone conventions worker). Validation terminals do not join refinement and do not count toward this cap.
- **NEVER assume idle means done.** Inspect `get_process_status` first, then verify the lane's scratchpad is populated per its template before completing.
- **NEVER hardcode or silently substitute a harness or model.** Bypass the default cache whenever the caller names either value. Use cached last-known-good selection only for unconstrained runs, and refresh discovery once when it fails. If the selected runtime changes after approval, return to confirmation before spawning again.
- **NEVER escalate a stuck/failed worker with `restart_process`** (it cannot change the spec). Close and respawn it under Failure & Timeout Handling, always with the original pinned SHAs and lane slice.
- **NEVER spawn reviewers until one response explicitly approves the current plan and confirms exactly one action mode.** Any plan revision invalidates the mode and requires the complete combined form again.
- **NEVER infer, default, or change either confirmation value.** The approved plan and confirmed mode remain separate explicit fields in the same interaction.
- **NEVER cache authentication, permissions, action modes, repository state, diffs, SHAs, prompts, or worker context.**
- **NEVER resolve push remotes or inspect worktrees for mutation safety before `auto-fix` is confirmed.** Complete that preflight before reviewer spawn when `auto-fix` is selected.
- **NEVER spawn or smoke-test reviewers serially.** Create todos, spawn workers, send real first prompts with `wait_ms=250`, and inspect status/output as parallel batches. Use one delayed wake only for ambiguous slow boots.
- **NEVER derive more than one canonical diff or let a lane reconstruct one.** Every lane slice comes from the pinned canonical diff; use the full canonical diff when a cross-cutting slice would hide interactions.
- **NEVER spawn an incomplete or unvalidated `lane_context[lane]`, derive it from another source, or let a required field silently disappear.**
- **NEVER make `review-<run>-context` a routine worker input.** Inline the complete lane context. One explicitly externalized field may permit one exact-section read once; all broader fallback is forbidden.
- **NEVER let a worker create, modify, or replace `review-<run>-context`, `review-<run>-validation`, or `review-<run>-timings`.**
- **NEVER prefer a network read when the required pinned Git object is available locally.**
- **NEVER give one validation command more than one evidence owner.** Its owner is one accepted authoritative CI result or the local validation runner.
- **NEVER let a reviewer execute validation or create a validation worktree, terminal, process, or lock.**
- **NEVER infer CI equivalence from names.** Reuse requires an explicit command-to-workflow/check/app mapping and one unique successful result at `pinned_sha`.
- **NEVER accept skipped, neutral, stale, merge-ref, pending, cancelled, timed-out, duplicated, ambiguous, wrong-SHA, or untrusted CI evidence.**
- **NEVER query or poll the CI evidence snapshot again after pinning.** Ambiguity falls back to local validation.
- **NEVER delay missing local validation until reviewers finish, create more than one validation worktree, or count validation terminals toward the reviewer cap.**
- **NEVER read a full reviewer scratchpad by default.** Read headings, Finding Index, and Notes first; fetch only needed sections.
- **NEVER store prompts, code, command output, environment values, credentials, or secrets in timings, combine human wait with machine preflight, or include timings in posted review text.**
- **NEVER use pre-fix evidence as post-fix verification.**
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
- **NEVER claim validation PASS from static assessment.** Consume results only from orchestrator-owned `review-<run>-validation`.
- **NEVER omit `file:line` from a finding.**
- **NEVER review outside your lane.** Put cross-lane concerns in the **Notes for Other Reviewers** section of your own `review-<run>-<lane>` scratchpad; the orchestrator routes them.
- **NEVER generate, refresh, or re-derive a diff.** Review only the assigned immutable lane slice, or the full canonical diff when supplied, and read supporting file contents only at `pinned_sha`.
- **NEVER read `review-<run>-context` on the normal path.** Use the inline lane context. If one field is explicitly externalized, read only the named packet section once; never read the full packet, another section, live metadata, or reconstruct context.
- **NEVER modify the shared context, validation, or timings records, or substitute moving PR metadata for pinned values.**
- **NEVER run tests, builds, linters, formatters, type checks, generators, or another validation command, and NEVER create a validation worktree, terminal, process, or lock.**
- **NEVER omit or malform the Finding Index.** Give every Critical, Important, or Minor issue one row and normalize its fingerprint.
- **NEVER flag a test as tautological without naming the plausible bug it fails to catch** (test-reviewer).

### Worker mechanics
- **NEVER assume a harness takes Omp's model flag, silently ignore a requested model, or switch runtime after approval.** Model passing follows Prerequisites; a changed harness/model requires a new combined confirmation before spawn.
- **NEVER trust spawn acceptance as readiness.** Send the real reviewer prompt as the smoke test with `wait_ms=250`, then inspect all worker statuses and outputs once in parallel. Use one delayed wake only for ambiguous slow boots; explicit runtime errors use the one-refresh fallback.
- **NEVER send a bare prompt** — prepend `agent_instructions` so the worker has its Solo process/project context.
- **NEVER busy-poll process output** — wake on `timer_fire_when_idle_all/any`.
