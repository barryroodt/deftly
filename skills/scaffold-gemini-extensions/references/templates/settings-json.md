# Template: `.gemini/settings.json` (workspace-level)

Path: `{workspace}/.gemini/settings.json`

Only written if the user opted into tool/extension gating in adapter
Step 2. Otherwise skip — Gemini's defaults are correct for most
workspaces.

Schema reference:
<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md>

```json
{
  "security": {
    "folderTrust": {
      "enabled": true
    }
  },
  "tools": {
    "excludeTools": [
      "{user-supplied tool names — e.g. web-fetch, run-shell}"
    ]
  },
  "extensions": {
    "disable": [
      "{user-supplied extension IDs to disable}"
    ]
  }
}
```

## Notes for fill-in

- `security.folderTrust.enabled` — leave `true` unless the user
  explicitly asks to disable workspace trust prompts. Default true is
  the safe choice.
- `tools.excludeTools` — list of tool names Gemini should never expose
  in this workspace. Common values: `web-fetch`, `run-shell`,
  `save-memory`.
- `extensions.disable` — IDs of installed Gemini extensions to ignore
  in this workspace (per `gemini-extension.json`).
- If all three sections are empty after user input, write the empty
  file `{}` only if the user explicitly asked for one. Otherwise skip
  the file entirely.
