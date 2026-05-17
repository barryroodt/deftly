# Spec: agent-agnostic `scaffold-project-workspace`

## Goal

`scaffold-project-workspace` currently bakes in Claude Code primitives
(`.claude/`, settings.json allow/deny, Agent Teams, `CLAUDE.md`). Refactor
so the skill scaffolds workspaces for any of: Claude Code, Codex, Gemini
CLI, Copilot CLI. Multi-select supported. CC-specific bits factor into an
optional adapter skill.

## Architecture

Split into 2 skills:

1. **`scaffold-project-workspace`** (refactored — agent-agnostic core)
   - Discover (Linear), clone repos, generate `AGENTS.md` as canonical,
     write per-agent skill files, generate architecture docs.

2. **`scaffold-claude-code-extensions`** (new — optional adapter)
   - Invoked by core when `claude-code` ∈ targets.
   - Generates `.claude/settings.json`, Agent Teams flag, `CLAUDE.md`
     pointer/symlink (if AGENTS.md not natively read), `/team` and
     `/architect` slash skills.

Future adapters: `scaffold-codex-extensions`, `scaffold-gemini-extensions`,
`scaffold-copilot-extensions`. Each owns that agent's permission model and
invocation conventions.

## Claude Code-specific items to extract

| Concern                                 | Current location              | Cross-agent equivalent                                                  |
|----------------------------------------- |------------------------------- |----------------------------------------------------------------------- |
| `.claude/CLAUDE.md`                      | Step 2.9 + template            | Codex/Copilot read `AGENTS.md`; Gemini reads `GEMINI.md`                |
| `.claude/settings.json` allow/deny       | Step 2.5 + template            | CC-only schema. Codex `config.toml`. Gemini trust policy. No portable form. |
| `.claude/settings.local.json`            | Step 2.5                       | CC-only                                                                  |
| `.claude/skills/<n>/SKILL.md` path       | Steps 2.6-2.9                  | Codex `~/.codex/skills/`, Copilot per-plugin, Gemini per-manifest        |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`   | settings template              | CC-only flag                                                             |
| Agent Teams + `/team` `/architect` slash | Steps 2.7-2.8, team-skill tmpl | Some agents lack subagent teams entirely                                 |
| `Task` tool, `dangerouslyDisableSandbox`, `sandbox.enabled` | Step 3.4 sandbox note | CC tool/setting names                                                    |
| `mcp__linear__*` permission patterns     | settings template              | CC's permission glob syntax                                              |
| Plugin cache path `~/.claude/plugins/`   | Phase 4.2                      | CC-only artifact                                                         |

## Milestones

### M1 — Extract agent matrix (1 PR, no behaviour change)

Reference doc only. No SKILL.md changes.

- New `skills/scaffold-project-workspace/references/agent-paths.md`
  documenting per-agent paths/conventions:

  | Agent       | Workspace doc      | Skills dir                      | Permissions model               |
  |------------ |------------------- |--------------------------------- |-------------------------------- |
  | Claude Code | `.claude/CLAUDE.md` (or AGENTS.md if natively read) | `.claude/skills/<n>/SKILL.md` | `settings.json` allow/deny       |
  | Codex       | `AGENTS.md`        | `~/.codex/skills/<n>/SKILL.md`  | `config.toml`                    |
  | Gemini CLI  | `GEMINI.md`        | per-plugin manifest             | trust policy                     |
  | Copilot CLI | `AGENTS.md`        | per-plugin                      | none                             |

- Verify matrix against each agent's current docs via context7 lookup.
- Acceptance: matrix accurate; cited per-agent doc URLs; no SKILL.md
  edits.

### M2 — Core skill refactor (1 PR)

- Add **Phase 0.5**: "Which agents target this workspace?" multi-select
  (claude-code / codex / gemini / copilot).
- Replace `.claude/CLAUDE.md` references with `AGENTS.md` as canonical
  (CC's SessionStart hook reads `AGENTS.md` natively — verify in M1).
- Move CC-specific Step 2.5 (`settings.json`) into adapter skill — core
  only writes `AGENTS.md` + per-agent skill files at matrix-looked-up
  paths.
- Drop `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` from any base template.
- Rewrite description: agent-neutral language.
- Acceptance: core skill produces working CC, Codex, Gemini, Copilot
  workspaces (one e2e dry-run each, captured in PR description).

### M3 — Claude Code extensions adapter (1 PR)

- New skill `skills/scaffold-claude-code-extensions/SKILL.md`.
- Owns:
  - `.claude/settings.json` allow/deny generation
  - `.claude/settings.local.json`
  - Agent Teams env flag
  - `/architect` and `/team` slash skills
  - `CLAUDE.md` (only if M1 finds AGENTS.md not natively read by CC)
- Invoked by core when `claude-code` ∈ targets.
- Inherits NEVER list items relevant to CC settings (the existing five).
- Acceptance: CC workspace produced via core+adapter == previous CC-only
  output (diff check on a sample workspace).

### M4 — Codex adapter (1 PR)

- `skills/scaffold-codex-extensions/SKILL.md`.
- Owns: `config.toml` permission writes, Codex tool-allow patterns,
  sandbox model differences.
- Acceptance: Codex workspace dry-run; Codex picks up the generated
  skills correctly.

### M5 — Gemini + Copilot adapters (1 PR each, or combined)

- Lower priority. Gemini has trust-policy config; Copilot has near-zero
  workspace state. Both may be one-pager adapters.

### M6 — Aggregate target mode (1 PR)

- Multi-select case: write all target-agent artifacts in one pass.
- Verify no path collisions (`AGENTS.md` is shared between
  Codex/Copilot — generate once, both consume).
- Phase 3.5 verification grows per-agent assertion blocks.
- Acceptance: workspace with all four agents selected produces correct
  artifacts for each; verification step lists per-agent file presence.

## Open questions (resolve before M2)

1. Does Claude Code's SessionStart hook read `AGENTS.md` natively or
   require `CLAUDE.md`? If AGENTS.md works, M2 simpler; if not, CC
   adapter must symlink/copy.
2. Codex skills directory: workspace-local (`<ws>/.codex/skills/`) or
   user-global (`~/.codex/skills/`)? Current spec says global.
   Implication: per-workspace skills harder; may need symlink farm.
3. Gemini CLI: does it consume cross-agent SKILL.md format, or only
   `activate_skill`-registered skills via separate manifest? Affects
   whether M5 ports skills 1:1 or needs adapter layer.
4. `settings.local.json` equivalent in other agents: any of them have
   a personal-overrides-not-committed convention? If not, document the
   gap in `references/agent-paths.md`.

## Non-goals

- Backporting older Claude Code-only workspaces to multi-agent format.
  New scaffolds only.
- Per-agent skill *content* differences. Skill bodies stay identical
  across agents; only frontmatter/paths/permissions adapt.
- Runtime agent detection. User declares targets in Phase 0.5; no
  auto-sniffing.

## Risks

- **High**: Codex/Gemini SKILL.md compatibility may differ in subtle ways
  (frontmatter fields, file refs). M1 matrix must verify with real test
  invocations, not docs alone.
- **Medium**: Agent Teams replacement for non-CC. If Codex/Gemini lack
  subagent dispatch, the generated `team` skill becomes CC-only —
  accept the asymmetry, document it.
- **Low**: `AGENTS.md` naming collision across agents — already a de
  facto cross-agent standard.

## Sequencing

M1 → M2 → M3 in order. M4/M5 independent after M2 lands. M6 last.

Estimates:
- M1: half day (research + matrix doc)
- M2: 1-2 days (core refactor + 4 dry-runs)
- M3: small (factor existing code into adapter)
- M4: medium (Codex permission model new ground)
- M5/M6: small each

## Implementation branch

This branch (`feat/agent-agnostic-scaffold`) carries the spec and all
milestone PRs. Each milestone lands as a separate commit/PR series off
this branch, merging back here, then to `main` once M6 lands.
