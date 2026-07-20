---
name: refine-skill
description: Refine an existing SKILL.md iteratively using sandboxed batch processing. Use when you want automated skill auditing without real-time interaction. Triggers on /refine-skill, dogfood, batch skill polish, CLI refine, sandboxed audit. Requires Docker daemon and provider API key.
---

# refine-skill (dogfood the CLI)

Dogfoods `@jumptag/refine-skill`, a Docker-sandboxed wrapper around the skill-forge judge + hitl loop. Each pass: judge scores the SKILL.md against a rubric, hitl applies approved improvements, loop exits on convergence or `--iterations` cap. Telemetry lands in `<path>/.refine/log.json`.

> **The judge scores writing quality, not runtime correctness.** It has no model of the tool/MCP API a skill describes and does not verify that a described control loop converges. A high score (even grade A) can encode instructions that call a tool with an argument it does not accept, or a loop that never makes progress. **Always review the refined output against the real tool semantics before adopting it, and never adopt on score alone.** See Agent Rule 9.

## When to Use

- Polishing a SKILL.md before publishing or merging
- Auditing an existing skill against the skill-forge rubric
- Producing a per-pass score / delta trail in `.refine/log.json`
- Batch-refining multiple skills without manually driving each item through HITL
- Running the refine loop in a sandbox so the host filesystem stays untouched beyond the target skill directory

**Decision framework**: Choose this CLI-based skill when the refine loop is batch/unattended (high priority), cost control is tight, or you want persistent telemetry in `.refine/log.json` for later analysis. Choose the in-Claude `refine-skill` skill when the user wants real-time judgment on each improvement, Docker is unavailable, or the skill being refined is the current working context.

## When NOT to Use

- Creating a brand-new skill from scratch. Use the in-Claude-Code `skill-forge-create` / `superpowers:writing-skills` flow instead
- Edits requiring real-time judgment from the user mid-pass. Use the interactive `refine-skill` skill (in-session, no Docker) instead
- Anything that is not a `SKILL.md` directory

## Prerequisites

Requires Docker daemon (Engine 20.10+), Node 20+ on PATH, and a provider API key matching the chosen model (default `claude-sonnet-4-5` expects `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`; see [MODELS.md](https://github.com/barryroodt/refine-skill/blob/main/MODELS.md) for other providers). If any is missing, surface the exact gap and stop. Do **not** fall back to in-session judge/hitl (defeats the sandbox purpose).

### Credentials (handle secrets safely)

- **Never have the user paste a token or key into the chat.** It becomes a reusable secret in the conversation log.
- Read the credential only inside the single run command, from a secure store: a macOS Keychain item (`security add-generic-password -a "$USER" -s refine-skill-token -w` to add with a hidden prompt; `security find-generic-password -s refine-skill-token -w` to read), or a `0600` temp file. Expand it inline: `ANTHROPIC_OAUTH_TOKEN="$(security find-generic-password -s refine-skill-token -w)" npx ...`.
- **Redact tokens in any streamed output** you echo back: pipe through `sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-***REDACTED***/g'`.
- **OAuth-refresh gotcha:** an expired Keychain OAuth token is *not* refreshed into a re-readable form by invoking `claude`. The Claude CLI refreshes in-process from the refresh token and holds the access token in memory only; the on-disk/Keychain entry stays byte-identical. To get a durable token for the sandbox, run `claude setup-token` (long-lived automation token) or supply a fresh API key. OAuth subscription tokens used by a third-party app also need "extra usage" credit enabled on the account.

## Invocation

```
/refine-skill <path-to-skill-dir>                       # default: 3 iterations, claude-sonnet-4-5
/refine-skill <path> --model claude-haiku-4-5           # cheaper; recommended for small skills
/refine-skill <path> --iterations 5                     # cap higher
/refine-skill <path> --pi-timeout 1800                  # override per-pi-call timeout (sec); auto 1800 for opus/fable-class, 600 otherwise
/refine-skill <path> --dry-run                          # print docker invocation, don't run
/refine-skill <path> --verbose                          # stream pi output uncut
/refine-skill <path> --no-log                           # skip .refine/log.json
```

Path may be absolute or relative; the CLI resolves it before mounting. The directory must contain a `SKILL.md`.

## Flow

### 1. Resolve the target

If the user gave a path, validate it points to a directory containing `SKILL.md`. If they did not, ask which skill; do not guess across `skills/`.

**If the input is precious (already sanitized, hand-curated, or you are experimenting with a model/settings), run on a throwaway copy** (`cp -r <skill> /tmp/refine-probe/<skill>`) and evaluate the result before promoting anything back. The loop rewrites files in place, and (see Agent Rule 9) the output is not guaranteed better than the input.

### 2. Check prerequisites

Run the checks above in parallel. On any failure, report the specific gap (`docker not running`, `ANTHROPIC_API_KEY unset`, etc.) and stop.

### 3. Confirm cost / scope

Before launching, surface:

- Target path
- Model + estimated cost band (Haiku ≈ $0.01-0.05/run for a small skill; Sonnet ≈ $0.03-0.15/run; Opus ≈ $0.30-1+/run)
- Iteration cap and `--pi-timeout` (auto-scales: 1800s for opus/fable-class, 600s otherwise; override if a model runs long)
- That telemetry will be written to `<path>/.refine/log.json` unless `--no-log` was passed

Wait for user approval before invoking the CLI.

### 4. Run

**The CLI preflights the model against the image's bundled catalog.** The pi model catalog is baked into the Docker image (not the npm CLI), so a valid provider slug the image predates would otherwise fail deep in the first judge call. The CLI now checks the slug up front and, if it is absent, exits **5** immediately (free, ~0s) and prints the closest supported slugs — no need to parse `judge.err` to tell "model not found" from a crash. If a new model matters, a newer `--image` tag (or `--pull always`) may be required; `@latest` on the CLI does not guarantee a current catalog.

Always pass `--dry-run` first to verify Docker mount + image resolution:

```bash
ANTHROPIC_OAUTH_TOKEN="$(security find-generic-password -s refine-skill-token -w)" \
  npx @jumptag/refine-skill@latest <abs-path> --model <model> --iterations <n> --dry-run
```

Once confirmed, invoke without `--dry-run`. Stream output but pipe through a token redactor. The redactor pipe would otherwise mask the CLI's exit code (a pipeline returns the *last* command's status, i.e. `sed`'s `0`), which would break every exit-code branch below, so enable `pipefail` and capture the CLI's real status:

```bash
set -o pipefail   # pipeline returns the CLI's non-zero status, not sed's 0
ANTHROPIC_OAUTH_TOKEN="$(security find-generic-password -s refine-skill-token -w)" \
  npx @jumptag/refine-skill@latest <abs-path> --model <model> --iterations <n> 2>&1 \
  | sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-***REDACTED***/g'
status=${PIPESTATUS[0]}          # capture immediately: any later command (even echo) resets $?
printf 'EXIT=%s\n' "$status"     # readable marker to branch on (see Exit Code Map)
exit "$status"                   # propagate the CLI's status as the script's own; drop this line when running inline in a persistent shell and branch on $status instead
```

Do not otherwise wrap stdout/stderr: the CLI's progress markers (per-pass score, item count, stop reason) are the primary signal. Verify propagation once (e.g. an unknown `--model` should surface `EXIT=5`, not `EXIT=0`) before trusting the exit-code branches.

### 5. Report results

After the CLI exits, read `<path>/.refine/log.json` (unless `--no-log`) and summarise:

- Passes run
- **Score trajectory (per pass), and whether the final score is at least the input score.** Read `summary` from `log.json`: it reports `input` (pass 1, the original skill), `best`, and `final` as normalized `score/max` fractions, plus `regressed_below_input`. The loop can converge on a state scoring *below* the input (the regressive pass stays committed), and because the rubric `max` can move between passes a positive raw delta can still be a normalized regression — so trust `summary.regressed_below_input`, not the raw per-pass `delta`. If it is `true`, inspect the diffs and revert to `summary.best` (via that pass's per-item commits) rather than adopting the final state.
- Stop reason (observed: `delta_below_threshold`; also documented: `all_obsolete`, `tradeoff_floor`, `max_iterations`)
- Per-pass improvements and commit shas, read from `passes[].items[]` in `log.json` (each item has `sha`, `commit_message`, `status`, `diff`)

**Do NOT run `git -C <path> log`.** The host skill dir is not a git repo: the loop commits inside a shadow worktree *in the container* and writes only the final files back. The commit trail (shas + diffs) is in `log.json`, not on the host.

**Actual `log.json` schema** (parse this; do not paste it raw):

```json
{
  "version": 1,
  "skill": "orchestrating-solo-agents",
  "started_at": "2026-07-16T15:30:37Z",
  "finished_at": "2026-07-16T15:41:35Z",
  "model": "claude-sonnet-4-5",
  "image": "",
  "stop_reason": "delta_below_threshold",
  "total_tokens": { "input": 0, "output": 0 },
  "passes": [
    {
      "n": 1,
      "score": 94,
      "max": 120,
      "grade": "C",
      "delta": 0,
      "items": [
        { "sha": "eef4afe...", "commit_message": "Add orchestration context", "status": "applied", "diff": "commit eef4afe...\n..." }
      ]
    },
    {
      "n": 3,
      "score": 85,
      "max": 120,
      "grade": "C",
      "delta": -16,
      "items": [],
      "stopped_before_hitl": true
    }
  ],
  "summary": {
    "input": { "pass": 1, "score": 94, "max": 120, "pct": 0.783 },
    "best":  { "pass": 2, "score": 101, "max": 120, "pct": 0.842 },
    "final": { "pass": 3, "score": 85, "max": 120, "pct": 0.708 },
    "regressed_below_input": true
  }
}
```

If `log.json` is missing or malformed, the run crashed before telemetry was written; check `.refine/debug/passes/N/{judge,hitl}.err`. For exit 12 (partial apply), inspect the written-back files directly (the host dir is not a git repo, so `git checkout` does not apply); re-run on a fresh copy if the state looks mid-edit.

## Exit Code Map

| Code | Meaning | Agent response |
|------|---------|----------------|
| 0 | Natural convergence | Report stop reason and score trajectory; check `summary.regressed_below_input` (Report step 5) |
| 1 | Max iterations reached | Note another pass might help; do not auto-rerun |
| 2 | Bad path / missing `SKILL.md` | Surface the path; ask user to confirm target |
| 3 | Missing / mismatched API key | Tell user which env var the chosen model needs |
| 4 | Docker not available | Tell user to start the daemon; stop |
| 5 | Model not found in image catalog | The slug is absent from the image's pi catalog. Pick a supported slug from the printed suggestions (or pass a newer `--image`); this is deterministic, so do **not** verbose-retry |
| 10 | Pi crash | Re-run with `--verbose`, capture stderr; do not retry blindly. (Model-not-found is now its own code 5.) |
| 11 | Judge output malformed | Likely model issue; suggest switching model |
| 12 | Hitl partial apply | Often a `--pi-timeout` overrun on a slow model; raise the timeout. Inspect written-back files directly (host dir is not a git repo); re-run on a fresh copy if mid-edit |
| 13 | Disk full / OOM | Surface and stop |
| 14 | Another refine running on the same path | Tell user; do not force |
| 130 | SIGINT | User cancelled; report partial state |
| 143 | SIGTERM | Same as SIGINT |

## Agent Rules

1. **Never invoke the CLI without explicit user approval of cost/iteration.** Refine runs are paid API calls; default to confirming.
2. **Never bypass Docker by running `pi` directly on the host.** The sandbox is the point.
3. **Never auto-rerun on exit code 1.** Max-iterations means the rubric plateaued; another pass grinds out diminishing returns. Surface and let the user decide.
4. **Never edit the target SKILL.md by hand mid-loop.** The hitl loop tracks commit boundaries; manual edits between passes corrupt the trail. (Editing *before* a run or *after* it exits is fine.)
5. **Always prefer `npx @jumptag/refine-skill@latest`** over a globally-installed copy unless the user pinned a version. Keeps the version surface visible.
6. **Pass `--dry-run` first on an unfamiliar path** to verify mount + image resolution before burning API calls.
7. **Treat `.refine/log.json` as machine-readable telemetry.** Parse it; do not paste it raw. The commit trail is there, not in host-side git.
8. **Stop on exit codes 2, 3, 4, 5, 13, 14.** These are environment/precondition problems; retrying without fixing them wastes the user's time.
9. **Review the output against real tool semantics before adopting; never adopt on score alone.** The judge scores prose, not executability (see the banner at the top). Concretely: (a) check every tool/API call the refined skill prescribes against that tool's actual signature; (b) check that any described loop makes progress on each iteration and terminates; (c) if the skill was intentionally sanitized (placeholders), re-sanitize, the rubric re-injects literal example values; (d) confirm `summary.regressed_below_input` is `false` before adopting. Run on a throwaway copy (Flow step 1) and promote only the parts that are correct.
10. **Guard secrets.** Read credentials only inside the run command from a secure store; never paste them in chat; redact `sk-ant-` in echoed output (see Credentials).

## Distinguishing from the in-Claude `refine-skill` skill

The environment also exposes an interactive `refine-skill` skill that runs the judge -> hitl loop directly inside the current Claude Code session (no Docker).

| Criterion | CLI-based (Docker) | In-Claude (interactive) |
|-----------|-------------------|-------------------------|
| Real-time interactivity | No (hands-off batch) | Yes (review each finding) |
| Docker required | Yes | No |
| Persistent telemetry | Yes (`.refine/log.json`) | No (session-only) |
| Cost predictability | Yes (tight control) | No (uses session model) |
| Skill context needed | No (sandbox isolates) | Yes (full session context) |
| Commit-per-item history | Yes (in log.json) | Manual or scripted |
| Setup friction | Requires Docker daemon | None |

**Pick the CLI version when:** the user says "dogfood"/"CLI"/"sandboxed"/"Docker"; wants telemetry on disk; wants a hands-off batch run; wants a commit-per-item trail.

**Pick the in-Claude version when:** the user wants to review each finding interactively; Docker is unavailable; the skill being refined is the *current* working skill and they want context-aware judgments.

If unclear, ask which they want; do not silently pick the wrong loop.

---

### Further Reading

- **CLI source / issues** (load if troubleshooting or contributing): https://github.com/barryroodt/refine-skill
- **npm package** (reference only; do NOT load unless checking versions): https://www.npmjs.com/package/@jumptag/refine-skill
- **Supported models + env vars** (load only if switching away from the default `claude-sonnet-4-5`): https://github.com/barryroodt/refine-skill/blob/main/MODELS.md
- **Full CLI design spec** (reference only; do NOT load unless designing new refine features): `specs/2026-05-20-deftly-refine-cli-design.md` in the upstream repo
