# Template: per-repo skill

Path: `{workspace}/.claude/skills/{short-name}/SKILL.md`

**Important:** Skills must use directory-based structure
(`skills/<name>/SKILL.md`), not flat files. Claude Code only discovers
skills in the `<name>/SKILL.md` directory format.

Before writing, ask the user to confirm short names:
> "I'll create these skill names. Adjust any that don't look right:
> - {repo-dir-1} → /{short-name-1}
> - {repo-dir-2} → /{short-name-2}
> - ..."

Fill placeholders from each repo's `AGENTS.md` + cross-repo interface
discovery (Phase 1).

```
---
name: {repo-short-name}
description: Use when working on {repo-name} — {one-line role}
---

## Identity
You are the {Name} Agent. You own ./{repo-directory}/.

## Repo Context
{2-3 sentences from AGENTS.md/README}

## Key Files
{Key directories and files relevant to this project's scope}

## Conventions
{Build commands, test commands, error handling, coding style from AGENTS.md}

## Collaboration
{How this repo connects to other repos — from interface discovery}

## Important
Always read ./{repo-directory}/AGENTS.md first. It has the authoritative
conventions. This skill provides project-level context on top.
```
