---
name: scaffold-codex-extensions
description: Codex CLI adapter for `scaffold-project-workspace`. Writes
  a project-level `.codex/config.toml` with appropriate sandbox mode,
  approval policy, network allowlist derived from WebFetch domains, and
  workspace writable_roots. Invoked by core scaffold when `codex` ∈
  targets in Phase 0.5. Use directly only for retro-fitting Codex
  support onto an existing agent-agnostic workspace.
---

# Codex CLI Extensions Adapter

## What this produces

- `.codex/config.toml` — project-level Codex config with sandbox +
  approval + network rules
- `.codex/README.md` — short doc telling the user to run `codex trust .`
  in this workspace before the config loads
- `.gitignore` additions (none normally — `.codex/config.toml` is
  project-shared by Codex convention)

**Not for:** Modifying `~/.codex/config.toml` (the user-level layer).
Adapters never touch user-global state — leave that to the user.

## Caveats

**Source conflict — verify before relying on `.codex/config.toml`:**
The public Codex docs (developers.openai.com/codex/config-basic)
describe a project-level `.codex/config.toml` loaded after the project
is trusted. The Rust config-loader README only enumerates user +
managed + CLI layers. The two sources may be out of sync, or the
project layer may be a separate code path. Before relying on the
project config for sensitive policies, verify against the installed
Codex version:

```bash
codex --version
# Then check whether `.codex/config.toml` settings actually take effect:
cd <workspace> && codex trust . && codex config show 2>/dev/null || true
```

If `.codex/config.toml` is not loaded by the installed version, fall
back to documenting recommended user-level config additions instead of
writing project config.

## Prerequisites

- `{workspace}/AGENTS.md` exists (written by core Step 2.9)
- `{workspace}/.agents/skills/` populated (written by core Steps 2.6-2.8)
- Tech-stack table + user permission answers from core Step 2.5

## Anti-Patterns

- **NEVER write `~/.codex/config.toml`** — that's user-global state
  outside this workspace's ownership.
- **NEVER skip the trust caveat** — Codex requires `codex trust .` (or
  the equivalent UI prompt) before project-level config loads. A
  silently-written `.codex/config.toml` that never takes effect is a
  worse outcome than no file at all. Always tell the user about the
  trust step.
- **NEVER translate CC's command allow-list into Codex deny rules** —
  Codex has no command deny-list. Its security model is sandbox-based
  (read-only / workspace-write / danger-full-access) with per-action
  approval prompts. Map deploy denials to "approval required" semantics
  (i.e. don't auto-approve them via sandbox mode), not to a deny array.
- **NEVER set `sandbox_mode = "danger-full-access"`** — that disables
  all sandboxing. If the user explicitly wants it, set it in user-level
  config, not project-level, so it doesn't auto-apply to teammates.

## Step 1: Generate .codex/config.toml

**MANDATORY — load `references/templates/config-toml.md` before writing.**

Write `{workspace}/.codex/config.toml` from the template. Fill in:

- `[sandbox_workspace_write].writable_roots` — set to the absolute
  path of `{workspace}` so Codex can write inside it.
- `[sandbox_workspace_write].network_access` — default `false` unless
  the user provided WebFetch domains in core Step 2.5.
- `[permissions.workspace.network.domains]` — one entry per WebFetch
  domain from core Step 2.5. Format: `"<domain>" = "allow"`. Plus
  defaults for loopback (`localhost`, `127.0.0.1`, `::1`).
- `approval_policy` — default `"on-request"` (Codex's middle-ground;
  prompts on writes outside workspace and on network calls).

Do NOT translate the CC `deny` list into Codex. Codex blocks dangerous
operations via sandboxing + approval prompts, not patterns. The
deploy-command denials from core Step 2.5 are documented in the
`.codex/README.md` (Step 2) instead.

## Step 2: Generate .codex/README.md

Write `{workspace}/.codex/README.md` containing:

```
# Codex configuration for {project name}

This workspace uses a project-level `.codex/config.toml`. Before Codex
loads it, you must trust the project:

    codex trust .

Without trust, Codex falls back to your `~/.codex/config.toml` only.

## Deploy commands flagged for manual approval

Codex has no command-deny pattern. The following commands gathered
during scaffold should require explicit user approval before running.
They will prompt under the default `approval_policy = "on-request"`:

{list user-supplied deploy-denials from core Step 2.5}

## Network access

This config allows network to:
{list domains from core Step 2.5}

If you need additional domains, add them under
`[permissions.workspace.network.domains]` in `.codex/config.toml`.
```

## Step 3: Verification

```bash
test -f {workspace}/.codex/config.toml
test -f {workspace}/.codex/README.md
# Tell the user (do not run silently):
echo "Run 'codex trust .' in this workspace before Codex loads .codex/config.toml"
```

If the user has Codex installed and asks, run:

```bash
codex --version && cd {workspace} && codex config show 2>/dev/null
```

to verify the project config is recognized. If not recognized (caveat
above), tell the user that `.codex/config.toml` may not be supported
by their Codex version and recommend the equivalent user-level config
additions from the README.

## Step 4: Hand back to core

Return a summary:
- `.codex/config.toml` written (with sandbox/approval/network settings)
- `.codex/README.md` written (with trust step + deploy denials + domain
  list)
- Trust-step caveat surfaced to user
- Source-conflict caveat surfaced if relevant

The core skill records this in its Phase 3.5 final verification table.
