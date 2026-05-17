# Agent Paths & Conventions Matrix

Reference for `scaffold-project-workspace` (M1 of
`specs/agent-agnostic-scaffold.md`). Documents the canonical file/directory
paths, permission models, skill-loading mechanisms, and personal-overrides
conventions for each supported agent CLI.

All citations retrieved 2026-05-17. Mark any unverified claim explicitly.

## Matrix

| Agent       | Workspace doc file                                     | Skills dir                                                                | Permissions model                                                | Personal-overrides-not-committed convention                                   |
|-------------|--------------------------------------------------------|---------------------------------------------------------------------------|------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Claude Code | `./CLAUDE.md` (or `./.claude/CLAUDE.md`); **does NOT read AGENTS.md natively** | `./.claude/skills/<name>/SKILL.md` (project) and `~/.claude/skills/` (user); plus plugin `skills/` dirs | `./.claude/settings.json` allow/deny lists + `managed-settings.json` (enterprise) | `./CLAUDE.local.md` (project memory) and `./.claude/settings.local.json` (settings); both git-ignored by convention |
| Codex CLI   | `AGENTS.md` (hierarchical: read from CWD up to repo root, plus `~/AGENTS.md` and `/AGENTS.md`) | Layered scan of `.agents/skills/` from CWD up to repo root, then `~/.agents/skills/`, `/etc/codex/skills/`, and built-ins | `~/.codex/config.toml` (user) + `.codex/config.toml` (project, requires explicit project trust); `--sandbox` flag + `[sandbox_workspace_write]` policy | None documented as standard. `.codex/config.toml` is project-shared by default; no `.codex/config.local.toml` convention surfaced in docs |
| Gemini CLI  | `GEMINI.md` (workspace + `~/.gemini/GEMINI.md` user)   | Auto-discovered from `.gemini/skills/<skill>/SKILL.md` and `.agents/skills/<skill>/SKILL.md` (workspace) and `~/.gemini/skills/` (user). One-level nesting only. | `~/.gemini/settings.json` Trusted Folders policy (`security.folderTrust.enabled`); per-extension `excludeTools` in `gemini-extension.json` | None documented. Trust scoping is per-folder, not per-file; no `settings.local.json` convention surfaced |
| Copilot CLI | `AGENTS.md` (also `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `CLAUDE.md`, `GEMINI.md` — all combined, no fallback priority) | `~/.copilot/agents/<name>.agent.md` (custom agents); plugin-provided skills via marketplaces. No standard workspace `skills/` directory documented. | Interactive per-action approval; session-wide via slash commands; `--allow-tool` / `--allow-all-tools` flags; org policy via `extraKnownMarketplaces` / `disabledSkills` in `.github/copilot/settings.json` | None documented. `~/.copilot/config.json` is user-global; no per-project local-override file surfaced |

---

## Per-agent detail

### Claude Code

- **Workspace doc paths (CLAUDE.md only — NOT AGENTS.md):** Project memory
  lives at `./CLAUDE.md` *or* `./.claude/CLAUDE.md`. User-scope memory at
  `~/.claude/CLAUDE.md`. Managed (enterprise) memory at platform-specific
  paths (`/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS,
  `/etc/claude-code/CLAUDE.md` on Linux,
  `C:\Program Files\ClaudeCode\CLAUDE.md` on Windows). Doc:
  <https://code.claude.com/docs/en/memory> (retrieved 2026-05-17).
- **AGENTS.md is not natively read.** Direct quote: *"Claude Code reads
  `CLAUDE.md`, not `AGENTS.md`. If your repository already uses `AGENTS.md`
  for other coding agents, create a `CLAUDE.md` that imports it..."*
  Recommended bridges: `@AGENTS.md` import in CLAUDE.md, or
  `ln -s AGENTS.md CLAUDE.md` (POSIX only). Doc:
  <https://code.claude.com/docs/en/memory#agents-md>.
- **Skill loading (manifest-free, file-scan):** Skills are auto-discovered
  from `.claude/skills/<skill>/SKILL.md`. Plugin skills live at
  `<plugin>/skills/<skill>/SKILL.md` (no separate manifest required). Doc:
  <https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/skill-development/SKILL.md>.
- **Permissions model:** JSON `permissions.allow` / `permissions.deny`
  arrays in `.claude/settings.json` (project-shared) and
  `.claude/settings.local.json` (per-user, project-local). Precedence
  highest-to-lowest: managed → project shared → project local → user. Doc:
  <https://code.claude.com/docs/en/settings#settings-files>.
- **Personal-overrides-not-committed convention:** Two distinct files —
  `./CLAUDE.local.md` for memory/instructions, and
  `./.claude/settings.local.json` for settings. Both intended to be in
  `.gitignore`; `/init` adds them automatically when the user opts in. Doc:
  <https://code.claude.com/docs/en/memory#import-additional-files>.
- **Notable quirks:**
  - SessionStart hook is a generic event hook, not the memory loader —
    memory loading happens unconditionally at session start regardless of
    hooks. Doc: <https://github.com/ericbuess/claude-code-docs/blob/main/docs/hooks.md>.
  - Path-scoped rules live under `.claude/rules/<topic>.md` with optional
    `paths:` frontmatter.
  - Auto-memory writes to `~/.claude/projects/<project>/memory/MEMORY.md`
    (machine-local, not shared across worktrees).

### Codex CLI

- **Workspace doc path:** `AGENTS.md` — hierarchical and not restricted to
  version-controlled folders. *"The contents of the `AGENTS.md` file at the
  root of the repo and any directories from the Current Working Directory
  (CWD) up to the root are automatically included with the developer
  message."* Deeper-nested `AGENTS.md` files override shallower ones; user
  prompts override both. Docs:
  <https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_1_prompt.md>,
  <https://github.com/openai/codex/blob/main/codex-rs/core/hierarchical_agents_message.md>.
- **Skills directory (`.agents/skills` — note: NOT `.codex/skills`):**
  Layered scan in this order: `$CWD/.agents/skills`, walked up to
  `$REPO_ROOT/.agents/skills`, then `$HOME/.agents/skills` (user-level),
  `/etc/codex/skills` (system), and Codex built-ins. Workspace-local
  **is** supported. Doc: <https://developers.openai.com/codex/skills>
  (retrieved 2026-05-17 via WebFetch).
  - The `init_skill.py` script defaults its `--path` to
    `${CODEX_HOME:-$HOME/.codex}/skills`, but auto-discovery is keyed on
    `.agents/skills`, not `.codex/skills`. Source:
    <https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md>.
    **Conflict flag:** the `init_skill.py` default path and the runtime
    discovery path are different conventions — `~/.codex/skills` (legacy)
    vs `~/.agents/skills` (current). Verify against installed Codex
    version at scaffold time.
- **Skill loading mechanism:** File-scan auto-discovery, manifest-free.
  Each skill is a directory with a required `SKILL.md` (YAML frontmatter
  + body) and optional `scripts/`, `templates/`, `examples/`. Source:
  <https://github.com/openai/codex/blob/main/codex-rs/memories/write/templates/memories/consolidation.md>.
- **Permissions model (`config.toml` + sandbox flag):** User config at
  `~/.codex/config.toml`, optional project overrides at
  `.codex/config.toml` (only loaded when the project is **trusted**).
  Sandbox levels: `read-only` (default), `workspace-write`,
  `danger-full-access`, selectable via `--sandbox` flag or
  `sandbox_mode` in `config.toml`. Network access governed by
  `[sandbox_workspace_write] network_access = true/false` and
  `[permissions.workspace.network]` with domain allowlist. Docs:
  <https://developers.openai.com/codex/config-basic>,
  <https://github.com/openai/codex/blob/main/codex-rs/network-proxy/README.md>,
  <https://github.com/openai/codex/blob/main/codex-rs/README.md>.
- **Personal-overrides convention:** **None documented as a standard.**
  `.codex/config.toml` is project-shared (intended to be committed). User
  settings in `~/.codex/config.toml` are user-global. No
  `.codex/config.local.toml` or equivalent appears in docs as of
  2026-05-17. Closest analog is the project-trust gate, which prevents
  `.codex/config.toml` from loading until the user explicitly trusts the
  project — but that's a one-time choice, not a per-user override file.
- **Notable quirks:**
  - `AGENTS.md` is hierarchical and can be placed anywhere (`/`, `~`,
    `.git/`-adjacent, etc.) — scope is "directory tree rooted at the file
    containing it".
  - `requirements.toml` with `allow_managed_hooks_only = true` lets admins
    restrict hook sources. Doc:
    <https://github.com/openai/codex/blob/main/docs/config.md>.
  - The `.agents/skills` path is the de-facto cross-agent convention
    (Gemini reads it too — see below).

### Gemini CLI

- **Workspace doc path:** `GEMINI.md` at workspace root, with user-scope
  `~/.gemini/GEMINI.md`. The `save_memory` tool persists facts to
  `GEMINI.md`. Doc:
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md>.
- **Skill loading (file-scan, NOT manifest-only):** Skills are auto-
  discovered from `.gemini/skills/<skill>/SKILL.md` and
  `.agents/skills/<skill>/SKILL.md` (workspace) and `~/.gemini/skills/`
  (user). Only one level of nesting is scanned. Activation is dynamic
  via the `activate_skill` tool — Gemini matches user prompt against
  `description:` frontmatter and activates on demand with user consent.
  Doc:
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/skills-getting-started.md>
  (retrieved 2026-05-17 via WebFetch).
- **SKILL.md format compatibility:** The cross-agent SKILL.md format
  (YAML frontmatter with `name:` and `description:`) is consumed
  directly. No separate registration manifest required. The SDK
  `skillDir()` helper loads from any directory; the CLI scans the paths
  above automatically. Doc:
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/writing-extensions.md>,
  <https://github.com/google-gemini/gemini-cli/blob/main/packages/sdk/SDK_DESIGN.md>.
- **Permissions model (trust policy + per-extension excludes):** Global
  trust gate in `~/.gemini/settings.json`:
  ```json
  { "security": { "folderTrust": { "enabled": true } } }
  ```
  Extensions can declare `excludeTools: ["run_shell_command(rm -rf *)"]`
  in `gemini-extension.json` to scope-restrict dangerous tools. Docs:
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md>,
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/best-practices.md>.
- **Personal-overrides convention:** **None documented.** Trust is
  scoped per-folder, not per-file. No `settings.local.json` analog
  surfaced for Gemini CLI.
- **Notable quirks:**
  - Extensions are declared in `gemini-extension.json` (full manifest
    with MCP servers, context file, plan directory). This is a separate
    concept from skills — extensions register MCP servers; skills are
    on-demand instruction packages.
  - Gemini reads `.agents/skills/` — same path as Codex — making it a
    plausible cross-agent shared-skills location.
  - The `intellectronica/gemini-cli-skillz` extension exists for
    "Anthropic-style Agent Skills" via an MCP server — confirming that
    the SKILL.md format and on-demand activation pattern is portable.

### Copilot CLI

- **Workspace doc paths (AGENTS.md natively supported alongside others):**
  Copilot combines (not falls back through) these custom-instructions
  files at workspace level:
  - `/.github/copilot-instructions.md`
  - `/.github/instructions/**/*.instructions.md`
  - `**/AGENTS.md`
  - `/CLAUDE.md`
  - `/GEMINI.md`

  Direct quote: *"All custom instruction files now combine instead of
  using priority-based fallbacks."* Doc:
  <https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results>
  (retrieved 2026-05-17 via WebFetch).
  - Note: this list is from the Copilot **coding agent** docs. The CLI's
    instruction-file handling is documented as inheriting the same
    custom-instructions model, but I could not retrieve a CLI-specific
    page enumerating the list (404s on
    `docs.github.com/.../customize-cli` and
    `.../configure-cli`). Treat the AGENTS.md support for Copilot CLI
    specifically as **unverified for the CLI surface** — strongly likely
    given doc parity, but the canonical CLI-side enumeration was not
    accessible.
- **Custom agents (user-global):** `~/.copilot/agents/<name>.agent.md` —
  Markdown with frontmatter (`name`, `description`, `model`, `tools`)
  plus instruction body. Selected via `/agent <name>` or
  `copilot --agent <name>`. Doc:
  <https://context7.com/github/copilot-cli/llms.txt> (retrieved
  2026-05-17 via context7).
- **Skill loading (per-plugin marketplace, no standard workspace dir):**
  Skills are delivered via plugins from marketplaces; managed by
  `extraKnownMarketplaces` and `disabledSkills` in repo-level
  `.github/copilot/settings.json` *or* `.claude/settings.json` (Copilot
  recognises the latter for compatibility). No documented standalone
  workspace `skills/` directory analog to Claude/Codex/Gemini. Doc:
  <https://context7.com/github/copilot-cli/llms.txt>.
- **Permissions model (interactive approval, no static allow/deny
  schema):** Three approval tiers — per-action prompt, session-wide
  approval via slash command, and CLI flags `--allow-tool <name>` /
  `--allow-all-tools` (the latter explicitly flagged as risky). Org
  policy can restrict via `disabledSkills`. Doc:
  <https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli>
  (retrieved 2026-05-17 via WebFetch).
- **Personal-overrides convention:** **None documented.**
  `~/.copilot/config.json` is user-global (one machine-wide config).
  `.github/copilot/settings.json` is repo-shared. No per-project local
  override file surfaced.
- **Notable quirks:**
  - LSP config split: `~/.copilot/lsp-config.json` (user) and
    `.github/lsp.json` (repo). Doc: GitHub `copilot-cli` README.
  - Copilot CLI explicitly recognises `.claude/settings.json` as a
    valid repository-config path — useful cross-agent reuse signal.
  - `copilot-setup-steps.yml` pre-installs deps in Copilot's dev env
    (cloud-agent feature; presence in CLI surface unverified).

---

## Open-question resolutions

### Q1 — Does Claude Code's SessionStart hook read AGENTS.md natively?

**Resolved: NO.** Claude Code reads `CLAUDE.md`, not `AGENTS.md`. The
official memory doc states this explicitly: *"Claude Code reads
`CLAUDE.md`, not `AGENTS.md`."* Bridging requires either an `@AGENTS.md`
import inside `CLAUDE.md` or a `ln -s AGENTS.md CLAUDE.md` symlink
(POSIX-only; Windows users must use the import).

**Implication for the scaffolder:** The CC adapter (`scaffold-claude-code-extensions`)
**must** generate either a `CLAUDE.md` that imports `@AGENTS.md`, or a
symlink. Symlink is preferable on POSIX (no duplicate content); on
Windows, fall back to a `CLAUDE.md` containing `@AGENTS.md` plus any
Claude-specific addenda. The SessionStart hook is unrelated — memory
loading is unconditional at session start.

Source: <https://code.claude.com/docs/en/memory#agents-md> (retrieved
2026-05-17).

### Q2 — Codex CLI skills directory: workspace-local or user-global only?

**Resolved: BOTH supported, but the path convention differs from the
spec.** Codex auto-discovers skills from `.agents/skills/<skill>/SKILL.md`
walking up from CWD to repo root, then from `~/.agents/skills/`,
`/etc/codex/skills/`, and built-ins. **Workspace-local IS supported.**

**Two convention conflicts to flag:**
1. The spec table in `specs/agent-agnostic-scaffold.md` (line 56) says
   `~/.codex/skills/`. The actual current discovery path is
   `~/.agents/skills/` (cross-agent convention shared with Gemini). The
   `init_skill.py` scaffolder script's default `--path` is
   `${CODEX_HOME:-$HOME/.codex}/skills`, which appears to be a legacy
   convention not aligned with current auto-discovery. Verify against
   the user's installed Codex version at scaffold time.
2. The cross-agent `.agents/skills/` path means a single workspace skills
   directory can serve both Codex and Gemini natively, without
   per-agent copies or symlinks. Claude Code does NOT read this path —
   it requires `.claude/skills/`.

**Implication for the scaffolder:** Write skills to
`.agents/skills/<skill>/SKILL.md` as the canonical workspace path
(serves Codex + Gemini). For Claude Code, the CC adapter must either
copy or symlink each skill into `.claude/skills/`. No symlink farm is
needed for Codex itself — workspace-local just works.

Sources: <https://developers.openai.com/codex/skills>,
<https://github.com/openai/codex/blob/main/codex-rs/memories/write/templates/memories/consolidation.md>
(retrieved 2026-05-17).

### Q3 — Does Gemini CLI consume the standard cross-agent SKILL.md format?

**Resolved: YES, directly. No separate manifest required for skills.**
Gemini CLI auto-discovers `SKILL.md` files from `.gemini/skills/`,
`.agents/skills/` (workspace), and `~/.gemini/skills/` (user) — one
level of nesting only. The SKILL.md format is the Anthropic-style
frontmatter spec (`name:` + `description:` required). Activation is
dynamic via the built-in `activate_skill` tool, which matches user
prompts against skill descriptions — this is a runtime mechanism, not a
pre-registration manifest.

Separately, Gemini does support `gemini-extension.json` manifests for
**extensions** (MCP server registration, context file naming, plan
directory). Extensions and skills are distinct concepts: extensions
register tools/servers; skills are on-demand instruction packages.

**Implication for the scaffolder:** Skills written for the cross-agent
`.agents/skills/<skill>/SKILL.md` path will work in Gemini without any
adapter-layer transformation. M5 (Gemini adapter) does not need to
port skills 1:1 — they're already compatible. If the workspace also
needs MCP servers, those go in `gemini-extension.json` (Gemini-
specific, handled by the Gemini adapter).

Source: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/skills-getting-started.md>
(retrieved 2026-05-17 via WebFetch).

### Q4 — Personal-overrides-not-committed convention in Codex / Gemini / Copilot?

**Resolved: NONE of them have a direct equivalent to Claude Code's
`.claude/settings.local.json` / `CLAUDE.local.md` pair.**

| Agent       | Personal-overrides convention                                                                 |
|-------------|-----------------------------------------------------------------------------------------------|
| Claude Code | `./CLAUDE.local.md` + `./.claude/settings.local.json` (both gitignored; `/init` opts in)      |
| Codex       | **None documented.** `.codex/config.toml` is project-shared. Closest analog: per-user project-trust gate (one-time consent, not a config layer). |
| Gemini CLI  | **None documented.** Folder-trust policy is per-directory, not per-file. No `settings.local.json` analog. |
| Copilot CLI | **None documented.** `~/.copilot/config.json` is user-global; `.github/copilot/settings.json` is repo-shared. No documented per-project local override file. |

**Verification gap:** I was unable to retrieve the canonical
GitHub-docs page for Copilot CLI configuration directly (multiple
404s on `docs.github.com/.../configure-cli` and `.../customize-cli`).
Codex's official config reference at `developers.openai.com` also was
not crawlable end-to-end. The claim "none documented" reflects best-
effort search across the official docs and project READMEs as of
2026-05-17 — verification against changelogs / source code would
strengthen it. If a convention exists, it is not surfaced in the
top-level user docs.

**Implication for the scaffolder:** Document this gap explicitly in
the scaffolded workspace. For Codex/Gemini/Copilot, users who want
per-machine personal overrides must either (a) edit user-global config
(`~/.codex/config.toml`, `~/.gemini/settings.json`, `~/.copilot/config.json`),
or (b) maintain their own gitignored overlay file and source it
manually. M2/M4/M5 should NOT generate a `.local` file for these
agents — there is no agent-side mechanism to read it.

Sources (retrieved 2026-05-17):
- Codex: <https://developers.openai.com/codex/config-basic>
- Gemini: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md>
- Copilot: <https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli>,
  <https://context7.com/github/copilot-cli/llms.txt>

---

## Unresolved gaps (to verify before M2 lands)

1. **Codex `~/.codex/skills` vs `~/.agents/skills` convention conflict.**
   The `init_skill.py` script writes to `~/.codex/skills` by default but
   runtime auto-discovery scans `~/.agents/skills`. Verify with a live
   `codex` install which path is loaded. Likely the docs page is fresher
   than the bundled script, but worth confirming with `codex --version`
   on the user's machine before committing to one path.

2. **Copilot CLI's exact custom-instructions enumeration on the CLI
   surface.** The combined-files list (AGENTS.md, CLAUDE.md, GEMINI.md,
   `.github/copilot-instructions.md`, `.github/instructions/**`) is
   documented for the Copilot coding agent. The CLI is documented as
   inheriting this model, but the CLI-specific page enumerating it was
   404 on `docs.github.com` at retrieval time. Verify via `copilot help`
   output or the CLI's source repo.

3. **Codex `.codex/config.toml` trust gate UX.** The "trusted project"
   prompt is described in the basic config docs but the exact CLI flow
   (one-time prompt vs persistent flag, where the trust decision is
   stored) is not surfaced in retrievable docs. Likely lives in
   `~/.codex/trust.json` or similar — unverified.

4. **Gemini CLI workspace `.gemini/settings.json` vs user-global.** The
   trust policy snippet uses `~/.gemini/settings.json` (user). Whether a
   workspace `.gemini/settings.json` exists and what fields it accepts
   is not directly retrievable — `gemini-extension.json` is the
   workspace-level manifest documented, but it's per-extension, not a
   global workspace config.
