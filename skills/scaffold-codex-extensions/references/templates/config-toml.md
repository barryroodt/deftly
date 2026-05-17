# Template: `.codex/config.toml`

Path: `{workspace}/.codex/config.toml`

Project-level Codex config. Only loaded after `codex trust .` (see
adapter SKILL.md caveats).

Fill placeholders from core Step 2.4 (tech stack) and Step 2.5 (deploy
denials + WebFetch domains).

```toml
# Codex project config for {project name}
# Loaded after `codex trust .` — see .codex/README.md for setup.

# Default approval policy: prompt on writes outside workspace, on
# network calls, and on any command Codex flags as risky.
approval_policy = "on-request"

# Sandbox: workspace-write lets Codex edit inside {workspace} without
# prompting, but still prompts for writes elsewhere.
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
# Absolute paths Codex may write to without prompting.
writable_roots = [
    "{workspace_absolute_path}"
]

# Disable /tmp and TMPDIR auto-include — explicit allowlisting only.
exclude_tmpdir_env_var = true
exclude_slash_tmp = true

# Network access: enable only if WebFetch domains were requested in
# core Step 2.5. Otherwise leave false.
network_access = {true if domains else false}

# Network domain allowlist — required when network_access = true.
# Codex blocks all hosts unless explicitly allowed here.
[permissions.workspace.network.domains]
"localhost" = "allow"
"127.0.0.1" = "allow"
"::1" = "allow"
{one line per user-supplied WebFetch domain — e.g. "github.com" = "allow"}
```

## Notes for fill-in

- `{workspace_absolute_path}` — resolve at scaffold time with
  `realpath {workspace}` or equivalent. Codex requires absolute paths
  in `writable_roots`; relative paths are rejected.
- If the user did not supply any WebFetch domains in core Step 2.5,
  omit the `[permissions.workspace.network.domains]` table entirely
  and keep `network_access = false`.
- Codex has no command-deny patterns — deploy-command denials from
  core Step 2.5 are surfaced to the user via `.codex/README.md`, not
  encoded in this file.
- Approval policy options: `"untrusted"` (always prompt), `"on-request"`
  (default — prompt on risky actions), `"on-failure"` (prompt only
  after a failed attempt), `"never"` (no prompts, dangerous). Source:
  <https://developers.openai.com/codex/config-basic>.
- Sandbox mode options: `"read-only"` (default), `"workspace-write"`,
  `"danger-full-access"` (disables sandboxing — do NOT auto-write).
