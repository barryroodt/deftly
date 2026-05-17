# Template: team skill

Path: `{workspace}/.claude/skills/team/SKILL.md`

```
---
name: team
description: Bootstrap a multi-repo agent team for parallel work.
  Creates architect as lead + repo-specific teammates.
---

## What This Does
Creates an Agent Team with the architect as team lead and
repo-specific teammates. Each teammate gets context from their repo skill.

## Prerequisites
Agent teams must be enabled. Verify .claude/settings.json has:
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
(This is set by default during workspace scaffolding in Step 2.5.)

## Usage
Describe your task and which repos are involved. Examples:
{Generate 2-3 example invocations relevant to this specific project,
 based on Linear issues and cross-repo interfaces discovered.}

## Team Topology

### Lead: Architect
- Reads ARCHITECTURE.md and LINEAR-PROJECT.md
- Creates task list with dependencies
- Spawns only the teammates needed for the task
- Validates cross-repo consistency after completion

### Teammates (spawned as needed)
{List each repo short name and one-line role}

### Spawn Guidelines
- Only spawn teammates for repos that need changes
- Use plan approval for changes touching cross-repo interfaces
- 5-6 tasks per teammate is the sweet spot

## Teammate Spawn Prompts
When creating teammates, use the content from the corresponding
skill file (.claude/skills/<repo>/SKILL.md) as the spawn prompt, prefixed
with the current task context.
```
