---
name: refine-skill
description: Iteratively refine a SKILL.md via the sandboxed `@jumptag/refine-skill` Docker CLI — runs the skill-forge judge → hitl loop inside a container so the host filesystem stays untouched apart from the skill being refined. Use when the user wants to polish, audit, grade, or iterate on an existing SKILL.md and prefers a hands-off batch run over an interactive in-Claude loop. Triggers on "/refine-skill", "refine this skill with the CLI", "run refine-skill on …", "dogfood refine-skill", "sandboxed skill refine". Requires Docker daemon running and a provider API key (Anthropic by default).
---

# refine-skill (dogfood the CLI)

Dogfoods `@jumptag/refine-skill` — a Docker-sandboxed wrapper around the skill-forge judge + hitl loop. Each pass: judge scores the SKILL.md against a rubric, hitl applies approved improvements, loop exits on convergence or `--iterations` cap. Telemetry lands in `<path>/.refine/log.json`.

## When to Use

- Polishing a SKILL.md before publishing or merging
- Auditing an existing skill against the skill-forge rubric
- Producing a per-pass score / delta trail in `.refine/log.json`
- Batch-refining multiple skills without manually driving each item through HITL
- Running the refine loop in a sandbox so the host filesystem stays untouched beyond the target skill directory

## When NOT to Use

- Creating a brand-new skill from scratch — use the in-Claude-Code `skill-forge-create` / `superpowers:writing-skills` flow instead
- Edits requiring real-time judgment from the user mid-pass — use the interactive `refine-skill` skill (in-session, no Docker) instead
- Anything that is not a `SKILL.md` directory

## Prerequisites

1. **Docker daemon** running (Engine 20.10+). Verify with `docker info >/dev/null 2>&1`.
2. **Node 20+** on PATH (for `npx`). Verify with `node --version`.
3. **Provider API key** matching the chosen `--model`. Default model is `claude-sonnet-4-5`; the loader expects `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`. Other supported providers and their env vars are listed in [MODELS.md](https://github.com/barryroodt/refine-skill/blob/main/MODELS.md).

If any prerequisite is missing, surface the exact gap and stop — do **not** fall back to running judge/hitl manually in-session (defeats the purpose of the dogfood).

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
- Model + estimated cost band (Haiku ≈ $0.01–0.05/run, Sonnet ≈ $0.03–0.15/run, Opus ≈ $0.30–1+/run on a typical small skill)
- Iteration cap
- That telemetry will be written to `<path>/.refine/log.json` unless `--no-log` was passed

Wait for user approval before invoking the CLI.

### 4. Run

Invoke via `npx` so the user's pinned version (or the latest published) is used:

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

The user's environment also exposes an interactive `refine-skill` skill that runs the judge → hitl loop directly inside the current Claude Code session (no Docker). Pick this CLI-based skill when:

- The user explicitly says "dogfood", "CLI", "sandboxed", or "Docker"
- They want telemetry written to disk for later analysis
- They want a hands-off batch run while doing other work
- They want commit-per-item history in the target repo

Pick the in-Claude version when:

- The user wants to review each judge finding interactively
- Docker is not available
- The skill being refined is the *current* working skill and they want context-aware judgments

If unclear, ask which they want — do not silently pick the wrong loop.

## Upstream references

- CLI source / issues: https://github.com/barryroodt/refine-skill
- npm: https://www.npmjs.com/package/@jumptag/refine-skill
- Supported models + env vars: https://github.com/barryroodt/refine-skill/blob/main/MODELS.md
- Spec: `specs/2026-05-20-deftly-refine-cli-design.md` in the upstream repo
