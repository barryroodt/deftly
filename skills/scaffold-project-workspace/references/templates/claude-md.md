# Template: `.claude/CLAUDE.md`

Path: `{workspace}/.claude/CLAUDE.md`

**Target: under 100 lines.** This loads into every session and teammate
context window. Fill placeholders from Linear data + Phase 1 discovery.

```
# {Project Name}

## Project Summary
{2-3 sentence description from Linear project}

## Repository Map
| Repo | Path | Language | Role |
|------|------|----------|------|
{row per repo, discovered from Linear + cloned repos}

## How Repos Connect
{discovered cross-repo interfaces as text diagram}

## Architecture Documentation
Read ./architecture/ARCHITECTURE.md for the full system map.
Read ./architecture/LINEAR-PROJECT.md for current project status.

## Skills (Single Session)
Invoke {list skills} for focused repo work. Each skill loads
repo-specific context and conventions.

## Agent Teams (Parallel Work)
Invoke /team to bootstrap a multi-repo agent team.

## Linear Project Tracking

This workspace tracks progress in the Linear project
**[{Project Name}]({Linear project URL})**.
Team: **{Team Name} ({Team Key})**.

### When to Update Linear
- **At session end**: If the session produced PRs, bugfixes, or shipped
  features, create or update Linear issues to reflect the work completed.
- **Sub-tasks**: Create sub-tasks under the relevant parent issue for
  discrete pieces of work (one sub-task per fix/PR, not one per commit).
- **Status accuracy**: Mark issues Shipped only when the PR is merged.
  Use In Progress for open PRs awaiting review/merge.
- **PR links**: Always attach PR links to Linear issues using the
  `links` field when creating issues.
- **Comments**: Add summary comments to parent issues when completing a
  batch of related sub-tasks, providing context on root cause and fix chain.

### Issue Conventions
- Use `type/bug` label for bugfixes, `type/chore` for maintenance tasks
- Add `unplanned/not-scoped` label for work discovered during a session
  that wasn't pre-planned
- Reference Linear tickets in PR descriptions with magic words:
  `Fixes {KEY}-XXX`, `Closes {KEY}-XXX`, `Resolves {KEY}-XXX`, or
  `Part of {KEY}-XXX` (for partial work)

## Universal Rules
- Never deploy to production
- Never push without explicit permission
- NEVER merge anything into main - not via git merge, not via gh pr merge.
  Merges to main are human-only operations.
- Each repo has its own AGENTS.md with repo-specific conventions -
  READ IT before making changes
- Changes spanning repos require architect coordination

## Git & PR Rules

### Branch Policy
- NEVER work directly on `main`. Always work on a feature branch.
- Before starting work, verify you are NOT on main:
  `git rev-parse --abbrev-ref HEAD` — if it returns `main`, stop and
  create/checkout a feature branch first.
- Branch naming: use the Linear issue branch name when available

### Pull Request Policy
- **Every PR must reference a Linear task.** Do not create a PR until
  a corresponding Linear issue exists. If no issue exists yet, create
  one first (see Linear Project Tracking above).
- Before creating a PR, ALWAYS check:
  1. `git log main..HEAD` — confirm there are commits to submit
  2. `gh pr list --head $(git branch --show-current)` — confirm no
     existing PR for this branch
  3. `git fetch origin main && git merge-base --is-ancestor HEAD origin/main` —
     confirm branch has NOT already been merged (exit code 0 = merged,
     do NOT create PR)
- Use `gh pr create` with a clear title and description
- Always reference the Linear ticket in the PR description using
  Linear magic words: `Fixes {KEY}-XXX`, `Closes {KEY}-XXX`,
  `Resolves {KEY}-XXX`, or `Part of {KEY}-XXX` (for partial work)
- Never force-push PR branches

### PR Comment Responses
- When reading PR comments via `gh api` or `gh pr view`:
  1. Read the FULL comment thread for context
  2. Understand what the reviewer is asking
  3. Check the relevant code to verify the comment is valid/applicable
  4. If the comment references code you haven't read, READ IT FIRST
  5. Never blindly implement a suggestion — verify it makes sense
  6. If a comment is unclear or seems incorrect, flag it rather than
     guessing the intent
```
