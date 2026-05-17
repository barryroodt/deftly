---
name: scaffold-copilot-extensions
description: Copilot CLI adapter for `scaffold-project-workspace`.
  Near-empty by design — Copilot reads `AGENTS.md` natively and has no
  workspace-level skills directory or permissions schema. The adapter
  primarily verifies that core's outputs are sufficient and surfaces
  Copilot-specific gotchas. Invoked by core scaffold when `copilot` ∈
  targets in Phase 0.5.
---

# Copilot CLI Extensions Adapter

## What this produces

Almost nothing — by design. Copilot CLI consumes the cross-agent
`AGENTS.md` natively and has no documented workspace-level skill or
permission state.

Optional outputs (only when the user asks for them):
- `.github/copilot/settings.json` — org/repo policy gates (e.g. allowed
  marketplaces, disabled skills). Only relevant if the workspace is the
  root of a GitHub repository.

## Prerequisites

- `{workspace}/AGENTS.md` exists (written by core Step 2.9)
- That's it.

## Anti-Patterns

- **NEVER write a workspace-level skills directory for Copilot** —
  Copilot CLI loads custom agents from `~/.copilot/agents/<name>.agent.md`
  (user-global) and skills from plugin marketplaces. There is no
  documented per-workspace skills directory; writing one creates
  confusion without effect.
- **NEVER duplicate `AGENTS.md` into `.github/copilot-instructions.md`** —
  Copilot reads both files when present and combines them (no fallback
  priority per the matrix). A duplicate produces double instructions.
  Use `AGENTS.md` alone unless the user has a specific reason for the
  `.github/copilot-instructions.md` form.

## Step 1: Confirm AGENTS.md is sufficient

Read the workspace `AGENTS.md` and confirm:
- It exists
- It mentions the project name, repo map, and conventions

If yes, no further action needed for Copilot. Tell the user:

> "Copilot CLI will pick up `AGENTS.md` natively. No additional Copilot
> workspace files are required. Custom Copilot agents (if any) live in
> `~/.copilot/agents/` and are managed per-user, outside this workspace."

## Step 2: (Optional) Generate .github/copilot/settings.json

Only write this file if:
- The workspace is the root of a GitHub repository (`.github/` exists
  or `git remote get-url origin` returns a `github.com/...` URL), AND
- The user explicitly asks for org-policy gating

Ask:
> "Do you want to set Copilot org policy for this repo? (allowed
> marketplaces, disabled skills) [y/N]"

If yes, prompt for the gate values and write
`{workspace}/.github/copilot/settings.json`:

```json
{
  "extraKnownMarketplaces": [
    "{user-supplied marketplace URLs}"
  ],
  "disabledSkills": [
    "{user-supplied skill IDs to disable}"
  ]
}
```

If no, skip this step.

## Step 3: Verification

```bash
test -f {workspace}/AGENTS.md
# Optionally:
test -f {workspace}/.github/copilot/settings.json  # only if Step 2 ran
```

## Step 4: Hand back to core

Return a summary:
- AGENTS.md confirmed present
- `.github/copilot/settings.json` written? (yes/no/skipped)
- No skills bridge needed (Copilot has no workspace skills dir)

The core skill records this in its Phase 3.5 final verification table.
