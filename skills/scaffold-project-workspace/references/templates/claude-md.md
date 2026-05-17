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

Project: **[{Project Name}]({Linear project URL})**.
Team: **{Team Name} ({Team Key})**.

- At session end, create or update Linear issues for any PRs, bugfixes,
  or shipped features produced. One sub-task per fix/PR, not per commit.
- Mark Shipped only when the PR is merged; In Progress for open PRs.
- Attach PR links via the `links` field on issue creation.
- Reference Linear tickets in PR descriptions with magic words:
  `Fixes {KEY}-XXX`, `Closes {KEY}-XXX`, `Resolves {KEY}-XXX`, or
  `Part of {KEY}-XXX` (partial work).
- Labels: `type/bug`, `type/chore`, `unplanned/not-scoped` (work
  discovered mid-session).

## Workspace Rules (non-default)

- Every PR must reference a Linear task. Create the issue first if missing.
- Before opening a PR, confirm the branch is NOT already merged:
  `git fetch origin main && git merge-base --is-ancestor HEAD origin/main`
  (exit code 0 = merged — do NOT create a PR).
- Merges to main are human-only. Never `git merge main`, never `gh pr merge`.
- Changes spanning repos require architect coordination.
- Each repo has its own AGENTS.md — read it before changes.
```
