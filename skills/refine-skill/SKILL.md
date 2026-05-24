---
name: refine-skill
description: Refine an existing SKILL.md iteratively using sandboxed batch processing. Use when you want automated skill auditing without real-time interaction. Triggers on /refine-skill, dogfood, batch skill polish, CLI refine, sandboxed audit. Requires Docker daemon and provider API key.
---

# refine-skill (dogfood the CLI)

Dogfoods `@jumptag/refine-skill` — a Docker-sandboxed wrapper around the skill-forge judge + hitl loop. Each pass: judge scores the SKILL.md against a rubric, hitl applies approved improvements, loop exits on convergence or `--iterations` cap. Telemetry lands in `<path>/.refine/log.json`.

## When to Use

- Polishing a SKILL.md before publishing or merging
- Auditing an existing skill against the skill-forge rubric
- Producing a per-pass score / delta trail in `.refine/log.json`
- Batch-refining multiple skills without manually driving each item through HITL
- Running the refine loop in a sandbox so the host filesystem stays untouched beyond the target skill directory

**Decision framework**: Choose this CLI-based skill when the refine loop is batch/unattended (high priority), cost control is tight (prefers Haiku), or you want persistent telemetry in `.refine/log.json` for later analysis. Choose the in-Claude `refine-skill` skill when the user wants real-time judgment on each improvement, Docker is unavailable, or the skill being refined is the current working context.

## When NOT to Use

- Creating a brand-new skill from scratch — use the in-Claude-Code `skill-forge-create` / `superpowers:writing-skills` flow instead
- Edits requiring real-time judgment from the user mid-pass — use the interactive `refine-skill` skill (in-session, no Docker) instead
- Anything that is not a `SKILL.md` directory

## Prerequisites

Requires Docker daemon (Engine 20.10+), Node 20+ on PATH, and a provider API key matching the chosen model (default `claude-sonnet-4-5` expects `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`; see [MODELS.md](https://github.com/barryroodt/refine-skill/blob/main/MODELS.md) for other providers). If any is missing, surface the exact gap and stop — do **not** fall back to in-session judge/hitl (defeats the sandbox purpose).

## Invocation

```
/refine-skill <path-to-skill-dir>                       # default: 3 iterations, claude-sonnet-4-5
/refine-skill <path> --model claude-haiku-4-5           # cheaper, recommended for small skills
/refine-skill <path> --iterations 5                     # cap higher
/refine-skill <path> --dry-run                          # print docker invocation, don't run
/refine-skill <path> --verbose                          # stream pi output uncut
```

Path may be absolute or relative; the CLI resolves it before mounting. The directory must contain a `SKILL.md`.

## Flow

### 1. Resolve the target

If the user gave a path, validate it points to a directory containing `SKILL.md`. If they did not, ask which skill — do not guess across `skills/`.

### 2. Check prerequisites

Run the three checks above in parallel. On any failure, report the specific gap (`docker not running`, `ANTHROPIC_API_KEY unset`, etc.) and stop.

### 3. Confirm cost / scope

Before launching, surface:

- Target path
- Model + estimated cost band (Haiku typically costs $0.02–0.03 per small skill ≤500 lines / $0.04–0.08 per medium skill 500–1000 lines; Sonnet ≈ $0.03–0.15/run; Opus ≈ $0.30–1+/run)
- Iteration cap
- That telemetry will be written to `<path>/.refine/log.json` unless `--no-log` was passed

**Cost estimation walkthrough**: To calculate the expected cost for a specific skill:

1. **Count the lines** in the target `SKILL.md` (e.g., 300 lines)
2. **Estimate input tokens**: ~4 tokens per line for typical Markdown prose: 300 lines × 4 tokens/line = 1,200 tokens/pass
3. **Divide by convergence rate**: Typical refine loops run 2–4 passes before converging (delta drops below improvement threshold). Assume 3 passes: 1,200 tokens × 3 passes = 3,600 input tokens total
4. **Look up model pricing**: Claude Haiku (default) input: $0.80/M tokens; output ~500 tokens/pass (improvements): $4.00/M tokens
   - Input cost: 3,600 ÷ 1,000,000 × $0.80 = $0.0029
   - Output cost: (500 tokens × 3 passes) ÷ 1,000,000 × $4.00 = $0.0060
   - **Total: ~$0.01** (plus minor overhead for docker init, typically ≤$0.005)
5. **For larger skills** (800 lines), expect 2–3× the cost due to longer context; for Sonnet (4× input cost), expect 4× the Haiku cost.

**Example**: A 300-line skill refined with Haiku over 3 passes ≈ $0.01–0.02 total. A 500-line skill with Sonnet ≈ $0.04–0.06.

Wait for user approval before invoking the CLI.

### 4. Run

Before burning API calls, always pass `--dry-run` first to verify Docker mount and image resolution:

```bash
npx @jumptag/refine-skill@latest <abs-path> --model <model> --iterations <n> --dry-run
```

Once confirmed, invoke without `--dry-run`:

```bash
npx @jumptag/refine-skill@latest <abs-path> --model <model> --iterations <n>
```

Stream output. Do **not** wrap stdout/stderr — the CLI's progress markers (per-pass score, item count, stop reason) are the primary signal.

### 5. Report results

After the CLI exits, read `<path>/.refine/log.json` (unless `--no-log`) and summarise:

- Passes run
- Score trajectory (per pass)
- Stop reason (`all_obsolete`, `delta_below_threshold`, `tradeoff_floor`, `max_iterations`)
- Per-pass commit summary (one-line each) — link directly to commits if the skill dir is a git repo
- Exit code interpretation (see table below)

Then run `git -C <path> log --oneline -<passes>` so the user sees the actual diff trail.

**Sample log.json structure** (for confident parsing on first run):

```json
{
  "skill_path": "/var/skills/my-skill",
  "model": "claude-haiku-4-5",
  "start_timestamp": "2026-05-24T09:01:20Z",
  "passes": [
    {
      "pass": 1,
      "score": 78,
      "items_applied": 5,
      "items_skipped": 0,
      "improvements": [
        "Fix incomplete agent rules example",
        "Add flow diagram",
        "Clarify precedence of When NOT to Use"
      ]
    },
    {
      "pass": 2,
      "score": 84,
      "items_applied": 3,
      "items_skipped": 1,
      "improvements": [
        "Expand Prerequisites section",
        "Add Exit Code table"
      ]
    }
  ],
  "final_score": 84,
  "stop_reason": "delta_below_threshold",
  "total_items_applied": 8,
  "total_runtime_sec": 42
}
```

Parse this on every run to confidently extract pass count, score trajectory, and stop reason. If the file is missing or malformed, the run crashed before telemetry was written.

**If log.json is missing or malformed**: Check the stderr output from the Docker invocation for error messages. If the exit code is 12 (partial apply), the skill directory may be in mid-edit state; inspect uncommitted changes with `git -C <path> diff` and reset with `git checkout .` if needed before re-running.

## Exit Code Map

| Code | Meaning | Agent response |
|------|---------|----------------|
| 0 | Natural convergence | Report stop reason, summarise wins |
| 1 | Max iterations reached | Note that another pass might help; do not auto-rerun |
| 2 | Bad path / missing `SKILL.md` | Surface the path; ask user to confirm target |
| 3 | Missing / mismatched API key | Tell user which env var the chosen model needs |
| 4 | Docker not available | Tell user to start the daemon; stop |
| 10 | Pi crash | Re-run with `--verbose`; capture stderr; do not retry blindly |
| 11 | Judge output malformed | Likely model issue — suggest switching model |
| 12 | Hitl partial apply | Skill dir may be in mid-edit state; surface git status |
| 13 | Disk full / OOM | Surface and stop |
| 14 | Another refine running on the same path | Tell user; do not force |
| 130 | SIGINT | User cancelled; report partial state |
| 143 | SIGTERM | Same as SIGINT |

## Agent Rules

1. **Never invoke the CLI without explicit user approval of cost/iteration.** Refine runs are paid API calls; default to confirming.
2. **Never bypass Docker by running `pi` directly on the host.** The sandbox is the point — host-side runs touch the user's whole machine.
3. **Never auto-rerun on exit code 1.** Max-iterations is a real signal that the rubric has plateaued; another pass usually grinds out diminishing returns. Surface and let the user decide.
4. **Never edit the target SKILL.md by hand mid-loop.** The hitl loop tracks commit boundaries — manual edits between passes corrupt the trail.
5. **Always prefer `npx @jumptag/refine-skill@latest` over a globally-installed copy** unless the user has pinned a version in the project. `npx` keeps the version surface visible in the invocation.
6. **Pass `--dry-run` first when invoking on an unfamiliar path** to verify mount + image resolution before burning API calls.
7. **Treat `.refine/log.json` as machine-readable telemetry.** When reporting, parse it; do not paste it raw.
8. **Stop on exit codes 2, 3, 4, 13, 14.** These indicate environment problems — retrying without fixing the underlying issue wastes the user's time.

## Distinguishing from the in-Claude `refine-skill` skill

The user's environment also exposes an interactive `refine-skill` skill that runs the judge → hitl loop directly inside the current Claude Code session (no Docker). Use the following decision matrix to pick the right tool:

| Criterion | CLI-based (Docker) | In-Claude (interactive) |
|-----------|-------------------|-------------------------|
| **Real-time interactivity** | ❌ Hands-off batch | ✅ Review each finding |
| **Docker available** | ✅ Required | ❌ Not needed |
| **Persistent telemetry** | ✅ `.refine/log.json` | ❌ Session-only output |
| **Cost predictability** | ✅ Tight control, Haiku default | ❌ Uses session model |
| **Skill context needed** | ❌ Sandbox isolates | ✅ Full session context |
| **Commit-per-item history** | ✅ Clear git trail | ⚠️ Manual or scripted |
| **Setup friction** | ⚠️ Requires Docker daemon | ✅ None |

**Pick the CLI version when:**
- The user explicitly says "dogfood", "CLI", "sandboxed", or "Docker"
- They want telemetry written to disk for later analysis
- They want a hands-off batch run while doing other work
- They want commit-per-item history in the target repo

**Pick the in-Claude version when:**
- The user wants to review each judge finding interactively
- Docker is not available
- The skill being refined is the *current* working skill and they want context-aware judgments

If unclear, ask which they want — do not silently pick the wrong loop.

---

### Further Reading

- **CLI source / issues** (load if troubleshooting or contributing): https://github.com/barryroodt/refine-skill
- **npm package** (reference only; do NOT load unless checking versions): https://www.npmjs.com/package/@jumptag/refine-skill
- **Supported models + env vars** (load only if switching away from default claude-haiku-4-5): https://github.com/barryroodt/refine-skill/blob/main/MODELS.md
- **Full CLI design spec** (reference only; do NOT load unless designing new refine features): `specs/2026-05-20-deftly-refine-cli-design.md` in the upstream repo
