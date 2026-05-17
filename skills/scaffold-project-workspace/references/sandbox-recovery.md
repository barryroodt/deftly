# Sandbox recovery — `git init` blocked

Loaded from core SKILL.md Step 3.4 only when `git init` fails inside
the `architecture/` subdirectory. If `git init` succeeded, skip.

## Symptoms across agents

- **Claude Code with `sandbox.enabled: true` in `.claude/settings.json`:**
  `Operation not permitted` writing to `.git/hooks/...sample` or
  `.git/config`. Recover with `git init --template=` (empty template);
  if still blocked, escalate to `dangerouslyDisableSandbox: true` on
  the Bash tool.
- **Codex with `[sandbox_workspace_write]` policy:** similar failure
  mode. Recover by running this step outside the sandbox, or with
  `--sandbox=workspace-write` if policy permits.
- **Gemini under Trusted Folders:** usually no block, but verify the
  workspace is trusted.
- **Copilot CLI:** no sandbox layer at this writing.

## Recovery order

1. Try empty-template first across all agents:
   ```bash
   cd {workspace}/architecture && git init --template=
   ```
2. If still blocked, clean up the partial `.git/` directory before
   retrying — use `find {workspace}/architecture/.git -delete`, NOT
   `rm -rf` (denied by CC's default settings).
3. Only as last resort, escalate to the agent-specific sandbox
   disable (CC: `dangerouslyDisableSandbox: true`; Codex: run outside
   sandbox).
