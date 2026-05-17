---
name: scaffold-project-workspace
description: Scaffold and bootstrap a multi-repo project workspace from a
  Linear project — clones repos, generates per-repo skills, writes
  permissions, and produces architecture docs. Use when setting up a new
  Linear project workspace, bootstrapping cross-repo Agent Teams, creating
  agent skills for coordinated multi-repo work, or initializing a workspace
  with `.claude/skills/` from a Linear project URL. Keywords: scaffold,
  bootstrap workspace, multi-repo, Linear project, cross-repo, agent teams,
  workspace setup, clone repos.
---

# Multi-Repo Project Workspace Bootstrapper

## What this produces

A `{workspace}/` containing:
- `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json`
- `.claude/skills/{architect,team,<repo>...}/SKILL.md`
- `architecture/{ARCHITECTURE,LINEAR-PROJECT}.md` (own git repo)
- One cloned repo dir per repo discovered from the Linear project
- `.gitignore` excluding the cloned repos and personal settings

**Not for:** Single-repo projects, projects without a Linear project, runtime orchestration (use the generated `/architect` or `/team` skills for that).

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

- **NEVER blind-write `.claude/settings.local.json`** — the Claude Code
  harness auto-creates it with session permissions. Clobbering wipes
  them silently. Always read first, then merge or skip.
- **NEVER skip the pre-existing dir check in Step 2.1** — `{workspace}`
  may contain a partial `.git`, user files, or environment-seeded
  overrides. Writing without listing first causes silent data loss.
- **NEVER `git add .` from the workspace root** — `architecture/` is a
  nested git repo (initialized in Step 3.4). A blanket add embeds it as
  a submodule reference and pollutes the workspace history. Use
  explicit paths: `git add .gitignore .claude/`.
- **NEVER use `rm -rf` to clean up partial scaffolds** — the default
  deny list blocks it; the command will fail mid-cleanup leaving a
  worse state. Use `find <path> -delete` for targeted cleanup of
  failed `.git/` dirs (see Step 3.4 sandbox note).
- **NEVER commit `.claude/settings.local.json`** — it carries personal
  overrides (local MCP servers, experimental flags). The generated
  `.gitignore` already excludes it; double-check before `git add`.
- **NEVER edit this skill (Phase 4) without showing the diff and
  getting approval** — the agent generating workspaces shouldn't
  silently mutate the workflow that generated them.
- **NEVER batch unrelated improvements in Phase 4** — fix one specific
  gap per edit; present multiple findings as a list for single approval,
  but don't bundle them into one rewrite.

## Templates (loaded on demand)

Five output templates live in `references/templates/`. Do NOT load them up
front — each phase calls out the exact moment to load each one:

- `references/templates/settings-json.md` — load before Step 2.5
- `references/templates/per-repo-skill.md` — load before Step 2.6
- `references/templates/architect-skill.md` — load before Step 2.7
- `references/templates/team-skill.md` — load before Step 2.8
- `references/templates/claude-md.md` — load before Step 2.9

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
Read from sibling:
- `.claude/skills/*/SKILL.md` — repo skill set
- `.claude/settings.json` — permissions baseline
- `.claude/CLAUDE.md` — workspace structure
- `.gitignore` — cloned repo list
- Per-repo remote URLs: `git -C <sibling>/<repo> remote get-url origin`

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
- `CLAUDE.md` project name, Linear URL, scope-specific rules (e.g. rollout
  may have "no production deploys" rules absent from implementation)
- `architect` skill identity and rollout/phase-specific coordination
- `architecture/ARCHITECTURE.md` — same system map but reframed scope
- `architecture/LINEAR-PROJECT.md` — new project's milestones + issues

If using sibling shortcut, jump to Phase 2.1 after this step. Phase 1
becomes "fetch new project's Linear data + Notion docs only".

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
  `.claude/settings.local.json` (Claude Code session permissions)
- In-progress user files

If non-empty:
1. List the contents to the user.
2. Confirm scaffolding will preserve unrelated files and only add the
   expected scaffold artifacts.
3. Never delete or overwrite files outside the scaffold's own outputs.
4. For files the scaffold owns but already exist (e.g. `settings.local.json`
   auto-created by the harness), **read first, then merge or skip** —
   don't blind-write.

```bash
mkdir -p {workspace}/.claude/skills
mkdir -p {workspace}/architecture
```

Note: Per-repo skill directories (`skills/{name}/`) are created in Step 2.6.

### Step 2.2: Clone Repositories

For each repo in the discovered list:

```bash
cd {workspace}
git clone {repo-ssh-url}
```

After cloning, verify each repo by listing its top-level contents.

### Step 2.3: Read Repo Context

For each cloned repo, read:
1. `AGENTS.md` (if exists) — authoritative conventions
2. `.claude/CLAUDE.md` (if exists) — additional context
3. `README.md` (if exists, fallback) — basic project info

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

### Step 2.5: Generate settings.json + settings.local.json

**MANDATORY — load `references/templates/settings-json.md` before writing.**

Write `{workspace}/.claude/settings.json` from the template base. Append
the tech-stack allow rules from Step 2.4 to the `allow` array.

Then ask:
> "Are there deploy commands specific to your tooling I should also deny?
> (e.g. `wrangler deploy *`, `kraft deploy *`, `fly deploy *`)"

Add user-specified deploy denials to the `deny` list.

Also ask:
> "Are there additional WebFetch domains or MCP servers to allow?"

Add user-specified entries to `allow`.

Write `{workspace}/.claude/settings.local.json` per template (empty `{}`).
This file is gitignored.

### Step 2.6: Generate Per-Repo Skills

**MANDATORY — load `references/templates/per-repo-skill.md`.**

For each cloned repo, create
`{workspace}/.claude/skills/{short-name}/SKILL.md` filled from the
template + repo AGENTS.md + Phase 1 interface discovery.

Confirm short names with the user before writing (see template).

### Step 2.7: Generate Architect Skill

**MANDATORY — load `references/templates/architect-skill.md`.**

Write `{workspace}/.claude/skills/architect/SKILL.md` from the template.
Fill the Cross-Repo Interfaces section from Phase 1.6 and the Validation
Checklist from the same discovery.

### Step 2.8: Generate Team Skill

**MANDATORY — load `references/templates/team-skill.md`.**

Write `{workspace}/.claude/skills/team/SKILL.md` from the template.
Generate 2-3 example invocations relevant to this project from Linear
issues and discovered interfaces.

### Step 2.9: Generate CLAUDE.md

**MANDATORY — load `references/templates/claude-md.md`.**

Write `{workspace}/.claude/CLAUDE.md` from the template. Fill placeholders
from Linear data + Phase 1 discovery. Target under 100 lines.

### Step 2.10: Create .gitignore

Write `{workspace}/.gitignore`:

```
# Cloned repos (tracked independently)
{one line per repo directory}

# Architecture has its own git repo
architecture/

# Personal settings
.claude/settings.local.json

# OS files
.DS_Store
```

### Step 2.11: Initialize Git and Commit

```bash
cd {workspace}
git init
git add .gitignore .claude/
git commit -m "init project workspace with skills and permissions"
```

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

Write `{workspace}/architecture/ARCHITECTURE.md` containing:

1. **System Overview** — text-based diagram showing all repos and their roles
2. **Repository Responsibilities** — table with repo, language, and primary role
3. **Data Flow** — how data moves between repos (text arrows)
4. **Cross-Repo Interface Contracts** — detailed contracts from discovery:
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

**Sandbox note:** If `{workspace}/.claude/settings.json` has
`sandbox.enabled: true`, plain `git init` may fail copying default hooks
into `architecture/.git/`. Symptoms: `Operation not permitted` writing
to `.git/hooks/...sample` or `.git/config`. Two recovery options:

1. Run `git init --template=` (empty template) to skip hook templates.
2. If still blocked, run the init+commit step with sandbox disabled
   (e.g. `dangerouslyDisableSandbox: true` on Claude Code's Bash tool).

Prefer option 1 first. Only escalate to option 2 if writes to
`architecture/.git/config` are still blocked. Clean up any partial
`.git/` directory (use `find ... -delete`, NOT `rm -rf` which is denied
by default settings) before retrying.

### Step 3.5: Final Verification

1. List the full workspace structure (2-3 levels deep)
2. Confirm fixed files exist:
   - `.claude/CLAUDE.md`
   - `.claude/settings.json`
   - `.claude/settings.local.json`
   - `.claude/skills/architect/SKILL.md`
   - `.claude/skills/team/SKILL.md`
   - `architecture/ARCHITECTURE.md`
   - `architecture/LINEAR-PROJECT.md`
   - `.gitignore`
3. Confirm per-repo skills: list `.claude/skills/` and verify a
   `{short-name}/SKILL.md` exists for every entry in the cloned-repo
   list from Step 2.2. Any mismatch (extra skill dir without a repo,
   or repo without a skill dir) is a bug — flag to the user before
   continuing.
4. Confirm all repos cloned successfully (one `git -C <repo> rev-parse HEAD`
   per repo; non-zero exit = clone failed).
5. Present summary to user.

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
   plugin checkout — NOT the installed copy under
   `~/.claude/plugins/`). Resolve the source path at runtime:

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
