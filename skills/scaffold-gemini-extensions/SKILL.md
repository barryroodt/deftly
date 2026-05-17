---
name: scaffold-gemini-extensions
description: Gemini CLI adapter for `scaffold-project-workspace`. Writes
  a `GEMINI.md` bridge to `AGENTS.md`, an optional `.gemini/settings.json`
  with trust + tool-exclusion gates, and confirms that `.agents/skills/`
  is the auto-discovered skill path Gemini reads. Invoked by core
  scaffold when `gemini` ∈ targets in Phase 0.5. Use directly only for
  retro-fitting Gemini support onto an existing agent-agnostic workspace.
---

# Gemini CLI Extensions Adapter

## What this produces

- `GEMINI.md` — bridge file so Gemini reads the canonical `AGENTS.md`
  (symlink on POSIX; copy fallback on Windows)
- `.gemini/settings.json` (optional) — workspace-level Gemini settings
  for tool exclusions or extension overrides, only if the user has
  specific gating needs
- No `.gitignore` changes (no personal-overrides convention in Gemini
  per the matrix)

**Not for:** Modifying `~/.gemini/GEMINI.md` or `~/.gemini/settings.json`
(user-global state).

## Prerequisites

- `{workspace}/AGENTS.md` exists (written by core Step 2.9)
- `{workspace}/.agents/skills/` populated (auto-discovered by Gemini —
  no bridge needed)

## Anti-Patterns

- **NEVER duplicate `AGENTS.md` content into `GEMINI.md`** — use a
  symlink or a single-line pointer; copies drift.
- **NEVER write `.gemini/settings.json` with `folderTrust.enabled =
  false`** — that disables Gemini's trust prompts globally for the
  workspace. If the user wants to suppress trust prompts, set it in
  their user-level `~/.gemini/settings.json`.
- **NEVER bridge `.agents/skills/` into `.gemini/skills/`** — Gemini
  auto-discovers both paths. A bridge causes Gemini to load the same
  skills twice and emit "duplicate skill name" warnings.

## Step 1: Generate GEMINI.md bridge

Gemini reads `GEMINI.md` at the workspace root. To keep `AGENTS.md` as
the single source of truth:

POSIX (preferred):
```bash
ln -s AGENTS.md {workspace}/GEMINI.md
```

Windows fallback (no symlink support without dev-mode):
```bash
cp {workspace}/AGENTS.md {workspace}/GEMINI.md
```

If copying, add a Phase 4 reflection note: re-run the adapter after any
`AGENTS.md` edit. The symlink avoids this entirely.

Verify:
```bash
test -L {workspace}/GEMINI.md || test -f {workspace}/GEMINI.md
ls -la {workspace}/GEMINI.md  # should resolve to AGENTS.md
```

## Step 2: (Optional) Generate .gemini/settings.json

Only write this file if the user supplied tool-exclusion or extension
gating in core Step 2.5. Otherwise skip — Gemini's defaults are fine.

Ask the user:
> "Do you want to gate specific Gemini tools or extensions for this
> workspace? (e.g. exclude `web-fetch` outside an allowlist, disable a
> specific extension) [y/N]"

If yes, load `references/templates/settings-json.md` and write
`{workspace}/.gemini/settings.json` with the user-supplied gates.

If no, skip this step entirely. Do NOT write an empty settings file —
Gemini will treat it as an opt-out of defaults.

## Step 3: Confirm skills discovery

Gemini auto-discovers skills from `.agents/skills/` (no bridge needed).
Confirm with:

```bash
ls {workspace}/.agents/skills/*/SKILL.md
```

Every entry will be visible to Gemini at session start. Skill activation
happens via the `activate_skill` runtime tool — no manifest registration
required.

## Step 4: Hand back to core

Return a summary:
- `GEMINI.md` bridge type (symlink / copy)
- `.gemini/settings.json` written? (yes/no/skipped)
- Skills discovered via auto-scan: count

The core skill records this in its Phase 3.5 final verification table.
