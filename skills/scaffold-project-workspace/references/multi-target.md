# Multi-target collision matrix and verification

Loaded by the core scaffold skill via MANDATORY trigger only when more
than one target is selected in Phase 0.5. Single-target runs skip this
file entirely.

## Collision matrix

When more than one target is selected, before invoking any adapter,
build a "planned writes" table by asking each adapter to declare which
paths it will write or modify. The matrix below is the expected
baseline — verify your installed adapter versions match:

| Path                           | Owner                  | Multi-target collision? |
|--------------------------------|------------------------|-------------------------|
| `AGENTS.md`                    | core (Step 2.9)        | No — single writer      |
| `.agents/skills/`              | core (Steps 2.6-2.8)   | No — single writer      |
| `.gitignore`                   | core baseline + each adapter appends | Yes — adapters must append, never clobber. Dedupe before final write |
| `.claude/CLAUDE.md`            | claude-code adapter    | No — single owner       |
| `.claude/skills/`              | claude-code adapter (bridge) | No — single owner   |
| `.claude/settings.json`        | claude-code adapter    | No — single owner       |
| `.claude/settings.local.json`  | claude-code adapter (read-first) | No — single owner |
| `.codex/config.toml`           | codex adapter          | No — single owner       |
| `.codex/README.md`             | codex adapter          | No — single owner       |
| `GEMINI.md`                    | gemini adapter (symlink to AGENTS.md) | No — single owner |
| `.gemini/settings.json`        | gemini adapter (optional) | No — single owner    |
| `.github/copilot/settings.json`| copilot adapter (optional) | No — single owner   |

## Collision handling rules

1. **`.gitignore`** — core writes the baseline first. Each adapter
   reads the file, scans for its own marker comment (e.g.
   `# Claude Code personal overrides (not committed)`), and only
   appends if absent. Multiple adapters running in sequence converge
   to the same union.
2. **Bridge files (`CLAUDE.md`, `GEMINI.md`)** — only the owning
   adapter writes. If two targets both produced a bridge to the same
   path (e.g. both wanted `CLAUDE.md`), this is a bug — refuse to
   continue and surface the conflict.
3. **`AGENTS.md`** — core writes once before any adapter runs.
   Adapters MUST NOT modify it. They may read it for verification.

If an adapter declares a write outside this expected table, treat as a
plugin-version mismatch — warn the user, ask whether to proceed, and
record in the Phase 3.5 summary.

## All-four-targets worked example

With Phase 0.5 selecting `{claude-code, codex, gemini, copilot}`, the
verification block should confirm — in addition to the core files —
exactly this set of adapter-owned artifacts:

```
AGENTS.md
.agents/skills/architect/SKILL.md
.agents/skills/team/SKILL.md      # because claude-code ∈ targets
.agents/skills/<repo>/SKILL.md    # per cloned repo
.claude/CLAUDE.md                  # @AGENTS.md import bridge
.claude/skills                     # symlink → .agents/skills
.claude/settings.json
.claude/settings.local.json
.codex/config.toml
.codex/README.md
GEMINI.md                          # symlink → AGENTS.md
# .gemini/settings.json only if user opted in
# .github/copilot/settings.json only if user opted in
```

Any missing required file is a bug. Surface to the user before
completing.
