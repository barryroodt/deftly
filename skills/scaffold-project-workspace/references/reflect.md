# Phase 4 REFLECT — full mechanics

Loaded from the core scaffold skill's Phase 4 pointer when the agent
is ready to propose changes to this skill itself.

## Step 4.1: Identify Improvements

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

## Step 4.2: Propose Changes

If improvements were identified:

1. Present each proposed change with:
   - **What happened**: the friction point or gap
   - **Proposed fix**: the specific edit to this skill
   - **Rationale**: why this is a general improvement, not project-specific

2. Wait for explicit user approval.

3. If approved, edit this skill file in its **source repo** (the
   deftly plugin checkout — NOT the installed copy in any agent's
   plugin cache: `~/.claude/plugins/` for Claude Code,
   `~/.codex/plugins/` for Codex, etc.). Resolve the source path at
   runtime:

   ```bash
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

(See top-level **Anti-Patterns** in the core SKILL.md for the Phase 4
NEVERs.)
