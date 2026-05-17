---
name: scaffold-project-workspace
description: Scaffold and bootstrap a multi-repo project workspace from a
  Linear project for any coding-agent CLI (Claude Code, Codex, Gemini,
  Copilot) — clones repos, generates per-repo skills, writes the canonical
  `AGENTS.md`, and produces architecture docs. Use when setting up a new
  Linear project workspace, bootstrapping cross-repo agent coordination,
  creating skills for multi-repo work, or initializing a workspace with
  `.agents/skills/` from a Linear project URL. Delegates per-agent
  permissions and bridge files to optional adapter skills
  (`scaffold-claude-code-extensions`, `scaffold-codex-extensions`,
  `scaffold-gemini-extensions`, `scaffold-copilot-extensions`).
---

# Multi-Agent Multi-Repo Project Workspace Bootstrapper

## What this produces

A `{workspace}/` containing:
- `AGENTS.md` (canonical cross-agent workspace doc — Codex, Copilot,
  Gemini read this natively; Claude Code reads via a `CLAUDE.md` bridge
  written by the CC adapter)
- `.agents/skills/{architect,team,<repo>...}/SKILL.md` (de-facto
  cross-agent skills directory — auto-discovered by Codex and Gemini;
  bridged into `.claude/skills/` by the CC adapter)
- Per-target adapter outputs (see Phase 0.5):
  - Claude Code: `.claude/settings.json`, `.claude/settings.local.json`,
    `.claude/CLAUDE.md` bridge, Agent Teams flag, `/team` + `/architect`
    slash skills
  - Codex: `.codex/config.toml` permissions
  - Gemini: `.gemini/settings.json` trust + tool gates
  - Copilot: (no workspace state needed beyond `AGENTS.md`)
- `architecture/{ARCHITECTURE,LINEAR-PROJECT}.md` (own git repo)
- One cloned repo dir per repo discovered from the Linear project
- `.gitignore` excluding the cloned repos and per-adapter personal
  settings (each adapter contributes its own gitignore entries)

**Not for:** Single-repo projects, projects without a Linear project,
runtime orchestration (use the generated `/architect` or `/team` skills
for that — `/team` only when `claude-code` ∈ targets).

## Per-agent paths reference

Before writing any files, consult
`references/agent-paths.md` for the authoritative matrix of per-agent
paths, permissions models, and skill-loading mechanisms. The phases
below reference rows of that matrix; do not hard-code paths.

## Prerequisites

- Linear MCP tools available (for fetching project details)
- Notion MCP tools available (for fetching linked documentation, if used)
- `git` and `gh` CLI installed
- SSH access to clone repositories

### Fallback: Linear MCP unavailable

If Linear MCP tools are not available (server unreachable, not
configured), the skill still functions in manual mode. Phase 1.2
becomes a user-supplied data step:

> "Linear MCP unavailable. Paste the project metadata as markdown:
> name, lead, status, description; one line per milestone with
> completion %; one line per issue with title, status, PR URL.
> I'll derive the repo list from the PR URLs."

Phase 3.3 (LINEAR-PROJECT.md) is generated from the pasted markdown
instead of live API data. Note in the document header that data is
a snapshot from {date} and may drift.

The same fallback applies if Notion MCP is unavailable: ask the user
to paste fetched doc content or skip Phase 3.1.

## Anti-Patterns

- **NEVER skip the pre-existing dir check in Step 2.1** — `{workspace}`
  may contain a partial `.git`, user files, or environment-seeded
  overrides. Writing without listing first causes silent data loss.
- **NEVER `git add .` from the workspace root** — `architecture/` is a
  nested git repo (initialized in Step 3.4). A blanket add embeds it as
  a submodule reference and pollutes the workspace history. Use
  explicit paths: `git add .gitignore AGENTS.md .agents/` plus any
  adapter-owned paths (`.claude/`, `.codex/`, `.gemini/`).
- **NEVER use `rm -rf` to clean up partial scaffolds** — Claude Code's
  default deny list blocks it. Other agents may permit it, but staying
  uniform avoids surprises. Use `find <path> -delete` for targeted
  cleanup of failed `.git/` dirs (see Step 3.4 sandbox note).
- **NEVER skip Phase 0.5** — running without explicit target selection
  produces a workspace that fits no agent cleanly. Adapters can be
  added later, but their outputs differ; retrofitting causes drift.
- **NEVER hard-code agent paths** — always read
  `references/agent-paths.md` and let the per-target adapter (M3-M5)
  own the agent-specific file writes. The core skill writes only
  cross-agent artifacts: `AGENTS.md`, `.agents/skills/`, `architecture/`.
- **NEVER edit this skill (Phase 4) without showing the diff and
  getting approval** — the agent generating workspaces shouldn't
  silently mutate the workflow that generated them.
- **NEVER batch unrelated improvements in Phase 4** — fix one specific
  gap per edit; present multiple findings as a list for single approval,
  but don't bundle them into one rewrite.

Adapter-specific NEVER lists (e.g. "never blind-write
`.claude/settings.local.json`") live in each adapter skill, not here.

## Templates (loaded on demand)

Core templates live in `references/templates/`. Do NOT load them up
front — each phase calls out the exact moment to load each one:

- `references/templates/per-repo-skill.md` — load before Step 2.6
- `references/templates/architect-skill.md` — load before Step 2.7
- `references/templates/team-skill.md` — load before Step 2.8
  (only when `claude-code` ∈ targets)
- `references/templates/agents-md.md` — load before Step 2.9

Adapter-owned templates (e.g. `.claude/settings.json` schema,
`.codex/config.toml` schema) live in each adapter skill's
`references/templates/` directory, not here.

## Phase 0: SIBLING SHORTCUT (optional)

> Before walking discovery, ask: is there a sibling workspace whose
> structure already answers most of these questions? Inheriting from a
> sibling is cheap; rediscovering from scratch is expensive.

If the user references an existing workspace as a template ("same as
~/path/to/sibling", "rollout phase of project X", "fork of Y") OR the
new workspace name resembles an existing sibling (e.g. `fooRollout`
next to `foo`), inspect the sibling first before walking full discovery.

### Step 0.1: Detect sibling
- Check the parent directory of the target workspace for sibling
  workspaces with `.claude/skills/` populated.
- If user explicitly named a sibling, use that.

### Step 0.2: Inspect sibling
Read from sibling, in this order (skip what's absent):
- `AGENTS.md` (workspace root) — workspace structure; fall back to
  `.claude/CLAUDE.md` or `GEMINI.md` if AGENTS.md not present
- `.agents/skills/*/SKILL.md` — repo skill set; fall back to
  `.claude/skills/*/SKILL.md` for legacy CC-only siblings
- Per-adapter config files for permissions baseline:
  - `.claude/settings.json` (CC)
  - `.codex/config.toml` (Codex)
  - `.gemini/settings.json` (Gemini)
- `.gitignore` — cloned repo list
- Per-repo remote URLs: `git -C <sibling>/<repo> remote get-url origin`

Infer which target agents the sibling was scaffolded for from which
config files exist, and propose the same set in Phase 0.5 (the user
can adjust).

### Step 0.3: Confirm replication scope
Present to user:
- Repo list discovered from sibling (with SSH URLs)
- Skill list to copy
- Permission rules to copy
- What needs adapting for the new workspace (project name, Linear URL,
  scope-specific rules — e.g. "rollout phase" vs "implementation phase")

Ask the user explicitly:

> "How should I use the sibling?
> A) Full replication — copy repo list, skills, and permissions verbatim;
>    skip Phase 1.2-1.6; jump to Phase 2 with sibling as source.
> B) Partial — copy skills and permissions from sibling; run fresh
>    Phase 1 discovery for repos and cross-repo interfaces.
> C) Skip — ignore the sibling, run full Phase 1 discovery from scratch."

Record the choice. A → continue to Step 0.4 then jump to Phase 2.1.
B → continue to Step 0.4 then Phase 1.1. C → skip remainder of Phase 0,
go to Phase 1.1.

### Step 0.4: Adapt, don't blindly copy
Even with full replication, the following must be tailored to the new
workspace and NOT inherited verbatim:
- `AGENTS.md` project name, Linear URL, scope-specific rules (e.g.
  rollout may have "no production deploys" rules absent from
  implementation)
- `architect` skill identity and rollout/phase-specific coordination
- `architecture/ARCHITECTURE.md` — same system map but reframed scope
- `architecture/LINEAR-PROJECT.md` — new project's milestones + issues

If using sibling shortcut, run Phase 0.5 (target selection) next, then
jump to Phase 2.1. Phase 1 becomes "fetch new project's Linear data +
Notion docs only".

## Phase 0.5: SELECT TARGET AGENTS

> Before scaffolding, ask: which coding-agent CLIs will use this
> workspace? The answer drives which adapter skills run and which
> files get written.

### Step 0.5.1: Multi-select target agents

Ask the user:

> "Which coding-agent CLIs will use this workspace? Select all that apply:
>
> 1) Claude Code (`claude` CLI)
> 2) Codex (`codex` CLI)
> 3) Gemini CLI (`gemini`)
> 4) Copilot CLI (`gh copilot`)
> 5) Other / custom — describe it
>
> Default if you skip: just Claude Code."

Record the set of targets. This drives which adapter skills are invoked
in Steps 2.5 and onward.

### Step 0.5.2: Confirm adapter availability

For each target ∈ {claude-code, codex, gemini, copilot}, confirm the
corresponding adapter skill exists in the deftly plugin:

| Target      | Adapter skill                          |
|-------------|----------------------------------------|
| claude-code | `scaffold-claude-code-extensions`      |
| codex       | `scaffold-codex-extensions`            |
| gemini      | `scaffold-gemini-extensions`           |
| copilot     | `scaffold-copilot-extensions`          |

If an adapter is missing for a selected target, warn the user:

> "Adapter `<name>` not found. Core scaffold will write `AGENTS.md` and
> `.agents/skills/` only — you'll need to add agent-specific permissions
> manually. Proceed anyway? (y/n)"

If the user declines, drop that target from the set and continue. If
all targets are dropped, abort with a message pointing the user to the
spec.

## Phase 1: DISCOVER

> Before scaffolding, ask: what repos, interfaces, and docs am I
> missing? Cheap to ask the user now; expensive to backfill once
> templates are written.

### Step 1.1: Accept Linear Project URL

Ask the user for the Linear project URL. Example:
`https://linear.app/<org-slug>/project/<project-slug>/overview`

### Step 1.2: Fetch Linear Project Details

Use Linear MCP tools to fetch:

1. **Project metadata**: `get_project` — name, description, lead, status
2. **Milestones**: `list_milestones` filtered to this project — names, completion %
3. **Issues**: `list_issues` filtered to this project — titles, status, assignees, PR attachments
4. **Resources**: Check project description and issue attachments for Notion links, repo URLs

From the issues, extract repository references:
- Look at PR attachments: `get_attachment` for each issue with attachments
- PR URLs contain the repo: `github.com/{org}/{repo}/pull/{n}`
- Deduplicate to get the list of involved repositories

Present to user:
- Project summary (name, lead, status)
- Discovered repositories (name, URL, role inferred from issues)
- Milestones with completion %
- Any Notion links found

### Step 1.3: Fetch Linked Documents

For each Notion link (or other external doc link) found in Linear:
1. Use `notion-fetch` (or the appropriate fetcher) to retrieve the page content
2. Convert to markdown
3. Store in memory for Phase 3

### Step 1.4: Ask for Additional Sources

Ask the user:
> "I found these documents linked in Linear. Are there additional sources
> I should include? (Notion pages, local files, URLs)"

Options:
1. No, that's everything
2. Yes, here are additional sources (user provides)

Fetch any additional sources provided.

### Step 1.5: Ask for Workspace Location

Ask the user:
> "Where should I create the project workspace?"

No default — the user must specify the full path. This keeps the skill
org-portable.

### Step 1.6: Discover Cross-Repo Interfaces

For each pair of repos, ask:
> "How does {repo-A} connect to {repo-B}? (API calls, shared types,
> binary dependencies, env vars, SQL, RPC — or 'no direct connection')"

Skip pairs where the user says no connection. Record all interfaces
for use in the architect skill and ARCHITECTURE.md.

If the user says "check the docs" or the fetched documents already
describe the interfaces, extract them from the fetched docs instead
of asking for each pair manually.

## Phase 2: SCAFFOLD

> Before writing, ask: what already exists in `{workspace}` that I
> might clobber? List, then merge — never blind-write.

### Step 2.1: Create Directory Structure

**Pre-existing dir check:** Before any `mkdir` or write, list contents
of `{workspace}` if it exists. The dir may already contain:
- A partial `.git` (workspace already initialized)
- Environment-seeded files like `AGENTS.override.md` (subspace) or
  agent-specific session files (e.g. `.claude/settings.local.json`
  auto-created by the Claude Code harness)
- In-progress user files

If non-empty:
1. List the contents to the user.
2. Confirm scaffolding will preserve unrelated files and only add the
   expected scaffold artifacts.
3. Never delete or overwrite files outside the scaffold's own outputs.
4. For files the scaffold or its adapters own but already exist (e.g.
   `settings.local.json` auto-created by the CC harness), **read first,
   then merge or skip** — don't blind-write.

```bash
mkdir -p {workspace}/.agents/skills
mkdir -p {workspace}/architecture
```

Per-target adapter directories (`.claude/`, `.codex/`, `.gemini/`) are
created by the respective adapter skill in Step 2.5, not here.

Note: Per-repo skill directories (`.agents/skills/{name}/`) are created
in Step 2.6.

### Step 2.2: Clone Repositories

For each repo in the discovered list:

```bash
cd {workspace}
git clone {repo-ssh-url}
```

After cloning, verify each repo by listing its top-level contents.

### Step 2.3: Read Repo Context

For each cloned repo, read:
1. `AGENTS.md` (if exists) — authoritative conventions (cross-agent)
2. `.claude/CLAUDE.md` (if exists) — Claude Code conventions
3. `GEMINI.md` (if exists) — Gemini-specific conventions
4. `README.md` (if exists, fallback) — basic project info

Store this context for skill generation in Step 2.6.

### Step 2.4: Detect Tech Stacks

For each cloned repo, check for marker files and record detected stacks:

| File Found | Stack | Allow Rules |
|---|---|---|
| `package.json` + `bun.lockb` | Bun | `bun install`, `bun install *`, `bun test *`, `bun run *` |
| `package.json` + `pnpm-lock.yaml` | pnpm | `pnpm install`, `pnpm install *`, `pnpm test *`, `pnpm run *`, `pnpm start *` |
| `package.json` + `package-lock.json` | npm | `npm install`, `npm install *`, `npm test *`, `npm run *` |
| `package.json` + `yarn.lock` | yarn | `yarn install`, `yarn install *`, `yarn test *`, `yarn run *` |
| `Cargo.toml` | Rust | `cargo build`, `cargo build *`, `cargo test *`, `cargo check *`, `cargo clippy *` |
| `Cargo.toml` containing `pgrx` | pgrx | Above + `cargo pgrx test *`, `cargo pgrx run *` |
| `Makefile` | Make | `make`, `make *` |
| `Dockerfile` or `docker-bake.hcl` | Docker | `docker build *`, `docker run *`, `docker bake *`, `docker images *`, `docker ps *` |
| `go.mod` | Go | `go *`, `go`, `golangci-lint *`, `gopls *`, `dlv *` |
| `requirements.txt` or `pyproject.toml` | Python | `python *`, `pip install *`, `pytest *` |

Present detected stacks to the user for confirmation.

### Step 2.5: Invoke per-target adapter skills

For each target selected in Phase 0.5, invoke the corresponding adapter
skill, passing the detected tech-stack rules from Step 2.4 plus user
answers to the prompts below. Adapters own all agent-specific file
writes (permissions, env flags, bridge files).

Before invoking adapters, gather shared inputs:

> "Are there deploy commands specific to your tooling I should deny?
> (e.g. `wrangler deploy *`, `kraft deploy *`, `fly deploy *`)"

> "Are there additional WebFetch domains or MCP servers to allow?"

Pass both answers + the tech-stack table to every adapter. Each adapter
translates them into its own permission schema:

| Target      | Adapter invocation                                        |
|-------------|-----------------------------------------------------------|
| claude-code | `scaffold-claude-code-extensions` → `.claude/settings.json`, `.claude/settings.local.json`, `CLAUDE.md` bridge, Agent Teams flag |
| codex       | `scaffold-codex-extensions` → `.codex/config.toml`        |
| gemini      | `scaffold-gemini-extensions` → `.gemini/settings.json`    |
| copilot     | `scaffold-copilot-extensions` → no workspace state needed |

If an adapter is missing (warned in Step 0.5.2), skip the invocation
and continue. The core scaffold still produces a usable `AGENTS.md` +
`.agents/skills/` baseline for that agent.

### Step 2.5.5: Multi-target collision check

When more than one target is selected in Phase 0.5, before invoking any
adapter, build a "planned writes" table by asking each adapter to
declare which paths it will write or modify. The matrix below is the
expected baseline — verify your installed adapter versions match:

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

Collision handling rules:

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

### Step 2.6: Generate Per-Repo Skills

**MANDATORY — load `references/templates/per-repo-skill.md`.**

For each cloned repo, create
`{workspace}/.agents/skills/{short-name}/SKILL.md` filled from the
template + repo AGENTS.md + Phase 1 interface discovery.

Confirm short names with the user before writing (see template).

Codex and Gemini auto-discover skills at `.agents/skills/`. Claude Code
does not — the CC adapter (M3) creates a `.claude/skills/` bridge
(symlink or copy) so CC discovers the same set.

### Step 2.7: Generate Architect Skill

**MANDATORY — load `references/templates/architect-skill.md`.**

Write `{workspace}/.agents/skills/architect/SKILL.md` from the template.
Fill the Cross-Repo Interfaces section from Phase 1.6 and the Validation
Checklist from the same discovery.

### Step 2.8: Generate Team Skill (Claude Code only)

Skip this step if `claude-code` ∉ targets — Codex/Gemini/Copilot lack
the Agent Teams subagent-dispatch primitive, so the team skill has no
runtime to drive there. The asymmetry is intentional; do not generate
a degraded team skill for non-CC targets.

If `claude-code` ∈ targets:

**MANDATORY — load `references/templates/team-skill.md`.**

Write `{workspace}/.agents/skills/team/SKILL.md` from the template.
Generate 2-3 example invocations relevant to this project from Linear
issues and discovered interfaces.

### Step 2.9: Generate AGENTS.md

**MANDATORY — load `references/templates/agents-md.md`.**

Write `{workspace}/AGENTS.md` (workspace root, NOT `.claude/CLAUDE.md`)
from the template. Fill placeholders from Linear data + Phase 1
discovery. Target under 100 lines.

Conditional sections:
- Include the "Agent Teams (Parallel Work)" section only when
  `claude-code` ∈ targets.
- Otherwise drop that section entirely; mentioning a primitive that's
  not available creates a misleading workspace doc.

The CC adapter (M3) handles the `CLAUDE.md` bridge so Claude Code reads
the same content.

### Step 2.10: Create .gitignore

Write `{workspace}/.gitignore` from the core baseline. Each adapter
appends its own personal-overrides entries (e.g. CC adapter appends
`.claude/settings.local.json` and `CLAUDE.local.md`).

Core baseline:

```
# Cloned repos (tracked independently)
{one line per repo directory}

# Architecture has its own git repo
architecture/

# OS files
.DS_Store
```

After core writes the baseline, each invoked adapter appends its own
section. The final file is the union.

### Step 2.11: Initialize Git and Commit

```bash
cd {workspace}
git init
git add .gitignore AGENTS.md .agents/
{for each adapter that produced files, add its paths — e.g. .claude/ for CC, .codex/ for Codex, .gemini/ for Gemini}
git commit -m "init project workspace ({comma-separated target list})"
```

Adapter paths are determined by which targets were selected in Phase
0.5; never `git add .` because `architecture/` is a nested git repo
(see Anti-Patterns).

## Phase 3: DOCUMENT

> Before documenting, ask: which fetched content captures *decisions*
> (keep verbatim under `architecture/`) vs. *status* (link to source,
> don't duplicate — it will drift)?

### Step 3.1: Write Fetched Docs to Architecture

For each external document fetched in Phase 1:
1. Write to `{workspace}/architecture/{NN}-{slug}.md`
2. Number sequentially (01-, 02-, etc.)
3. Include a header noting the source URL and fetch date

### Step 3.2: Write ARCHITECTURE.md

Write `{workspace}/architecture/ARCHITECTURE.md` containing the
following sections — include each only where it applies to the
discovered system; omit empty ones rather than ship placeholders:

1. **System Overview** — text-based diagram showing all repos and their roles
2. **Repository Responsibilities** — table with repo, language, and primary role
3. **Data Flow** — how data moves between repos (text arrows)
4. **Cross-Repo Interface Contracts** — detailed contracts from discovery,
   choose the subset that matches the system:
   - API endpoints (HTTP method, path, request/response)
   - RPC methods (name, parameters, return type)
   - SQL functions (signature, who calls them)
   - Env vars (name, who sets, who reads)
   - Binary dependencies (what's packaged where)
5. **Key Workflows** — end-to-end flows that span repos

Source: Linear project data + fetched docs + user-provided interface info.

### Step 3.3: Write LINEAR-PROJECT.md

Write `{workspace}/architecture/LINEAR-PROJECT.md` containing:

1. **Project Info** — name, lead, team, status, Linear URL
2. **Milestones** — name, completion %, list of issues per milestone
3. **Issue Summary** — grouped by status (Done, In Progress, Todo)
4. **Phase Breakdown** — if the project has phases, list them with status

Source: Linear project data fetched in Phase 1.

### Step 3.4: Initialize Architecture Git Repo

```bash
cd {workspace}/architecture
git init
git add -A
git commit -m "init architecture docs for {project-name} workspace"
```

**Sandbox note:** Agent sandboxes may block `git init` from copying
default hooks into `architecture/.git/`. Symptoms across agents:
- Claude Code with `sandbox.enabled: true` in `.claude/settings.json`:
  `Operation not permitted` writing to `.git/hooks/...sample` or
  `.git/config`. Recover with `git init --template=` (empty template);
  if still blocked, escalate to `dangerouslyDisableSandbox: true` on
  the Bash tool.
- Codex with `[sandbox_workspace_write]` policy: similar failure mode.
  Recover by running this step outside the sandbox, or with
  `--sandbox=workspace-write` if policy permits.
- Gemini under Trusted Folders: usually no block, but verify the
  workspace is trusted.
- Copilot CLI: no sandbox layer at this writing.

Prefer the empty-template option first across all agents. Clean up any
partial `.git/` directory with `find ... -delete` (NOT `rm -rf` —
denied by CC's default settings) before retrying.

### Step 3.5: Final Verification

1. List the full workspace structure (2-3 levels deep).

2. Confirm **core** files exist (always required):
   - `AGENTS.md`
   - `.agents/skills/architect/SKILL.md`
   - `.agents/skills/team/SKILL.md` (only if `claude-code` ∈ targets)
   - `architecture/ARCHITECTURE.md`
   - `architecture/LINEAR-PROJECT.md`
   - `.gitignore`

3. Confirm per-repo skills: list `.agents/skills/` and verify a
   `{short-name}/SKILL.md` exists for every entry in the cloned-repo
   list from Step 2.2. Any mismatch (extra skill dir without a repo,
   or repo without a skill dir) is a bug — flag to the user before
   continuing.

4. **Per-target adapter checks** — for each adapter invoked in Step
   2.5, run its verification assertions. The adapter owns the
   assertion list; the core skill only invokes it. Expected per-target
   artifacts:

   | Target      | Adapter-owned files to confirm                            |
   |-------------|-----------------------------------------------------------|
   | claude-code | `.claude/settings.json`, `.claude/settings.local.json`, `.claude/CLAUDE.md` (bridge), `.claude/skills/` (bridge to `.agents/skills/`) |
   | codex       | `.codex/config.toml`                                       |
   | gemini      | `.gemini/settings.json` (if generated)                     |
   | copilot     | (none — AGENTS.md alone is sufficient)                     |

   If an adapter was skipped (missing or user-declined in Step 0.5.2),
   note that in the summary.

   **All-four-targets worked example.** With Phase 0.5 selecting
   `{claude-code, codex, gemini, copilot}`, the verification block
   should confirm — in addition to the core files — exactly this set
   of adapter-owned artifacts:

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

5. Confirm all repos cloned successfully (one
   `git -C <repo> rev-parse HEAD` per repo; non-zero exit = clone
   failed).

6. Present summary to user — list targets, files written, adapters
   invoked, and any skipped steps.

## Phase 4: REFLECT

After setup is complete, review the process for improvements.

### Step 4.1: Identify Improvements

Review the setup just completed. Look for:
- Steps that required workarounds not covered by this skill
- Questions that should have been asked but weren't
- Tech stack detections that were missing
- Permission rules that needed manual addition
- Template sections that produced unclear or poor output
- Ordering issues (a step needed info from a later step)

Do NOT flag:
- Project-specific details (those belong in the workspace, not this skill)
- One-off edge cases unlikely to recur

### Step 4.2: Propose Changes

If improvements were identified:

1. Present each proposed change with:
   - **What happened**: the friction point or gap
   - **Proposed fix**: the specific edit to this skill
   - **Rationale**: why this is a general improvement, not project-specific

2. Wait for explicit user approval

3. If approved, edit this skill file in its source repo (the deftly
   plugin checkout — NOT the installed copy in any agent's plugin
   cache: `~/.claude/plugins/` for Claude Code, `~/.codex/plugins/`
   for Codex, etc.). Resolve the source path at runtime:

   ```bash
   # From this SKILL.md's directory, walk upward to the git root.
   skill_dir="$(dirname "$(realpath <path-to-this-SKILL.md>)")"
   repo_root="$(git -C "$skill_dir" rev-parse --show-toplevel)"
   target="$repo_root/skills/scaffold-project-workspace/SKILL.md"
   ```

   Edit `$target`, not the installed plugin copy — the plugin cache is
   overwritten on update and edits will be lost.

4. Commit the change on a feature branch and open a PR — do not push
   directly to main.

If no improvements identified, say so:
> "Setup completed cleanly — no skill improvements needed."

(See top-level **Anti-Patterns** for the Phase 4 NEVERs.)
