# skills.sh Repository Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the `skills.sh` git repository with the structure, license, authoring template, and helper script defined in the design spec, ready to publish to GitHub and consume via `npx skills add` or Claude Code plugin marketplace.

**Architecture:** Static repository of files. One layer of organization: top-level meta files (`README`, `LICENSE`, `.gitignore`), a `skills/` directory for per-skill folders, a `template/` directory with a starter `SKILL.md`, a `scripts/` directory with a POSIX shell scaffolder, and a `.claude-plugin/marketplace.json` exposing the repo as a Claude Code plugin marketplace.

**Tech Stack:** Git, POSIX shell, Markdown, JSON, YAML frontmatter. No build system. No runtime dependencies. Shell script tested with a self-contained Bash harness.

**Spec reference:** `docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md`

---

## File Structure

Files created by this plan (all paths relative to repository root):

- `.gitignore` — OS/editor noise filters.
- `LICENSE` — Apache License 2.0 text.
- `README.md` — repo description, install paths, skill index, authoring notes, license.
- `.claude-plugin/marketplace.json` — Claude Code plugin marketplace manifest.
- `skills/.gitkeep` — empty placeholder so the directory is tracked.
- `template/SKILL.md` — starter template with frontmatter and section scaffolding.
- `scripts/new-skill.sh` — POSIX shell script that scaffolds a new skill folder from the template.
- `scripts/test_new_skill.sh` — self-contained Bash test harness for `new-skill.sh`.

Documentation already present (from brainstorming phase, retained):

- `docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md`
- `docs/superpowers/plans/2026-05-17-skills-sh-repo-scaffold.md` (this file)

---

## Task 1: Initialize git repository

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Verify working directory is empty of repo state**

Run: `git rev-parse --is-inside-work-tree 2>/dev/null && echo "EXISTS" || echo "NONE"`
Expected: `NONE`

If output is `EXISTS`, stop and confirm with the user before proceeding. The repository must not already be initialized.

- [ ] **Step 2: Initialize the repository**

Run: `git init -b main`
Expected: output ends with `Initialized empty Git repository in <path>/.git/`

- [ ] **Step 3: Create `.gitignore`**

Create file `.gitignore` with exact contents:

```
# macOS
.DS_Store

# Editors
*.swp
*.swo
.idea/
.vscode/

# Node
node_modules/

# Logs
*.log
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: initialize repository with .gitignore"
```

Expected: commit succeeds; `git log --oneline` shows one commit.

---

## Task 2: Add Apache-2.0 LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create `LICENSE`**

Create file `LICENSE` with the full Apache License 2.0 text. Source: https://www.apache.org/licenses/LICENSE-2.0.txt — fetch it verbatim. The copyright header at the bottom of the file must read:

```
Copyright 2026 Barry Roodt

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The full Apache 2.0 license body precedes that copyright block. Use `curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE` to fetch the body, then append the copyright block above as the final section (or replace the placeholder copyright at the bottom of the fetched file with the block above).

- [ ] **Step 2: Verify license content**

Run: `head -2 LICENSE`
Expected: first two lines match the Apache 2.0 header (begins with `                                 Apache License` and `                           Version 2.0, January 2004`).

Run: `grep -c "Copyright 2026 Barry Roodt" LICENSE`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add LICENSE
git commit -m "chore: add Apache-2.0 LICENSE"
```

---

## Task 3: Scaffold empty `skills/` directory

**Files:**
- Create: `skills/.gitkeep`

- [ ] **Step 1: Create directory and placeholder**

Run: `mkdir -p skills && : > skills/.gitkeep`

- [ ] **Step 2: Verify**

Run: `ls -la skills/`
Expected: directory contains `.gitkeep` (size 0).

- [ ] **Step 3: Commit**

```bash
git add skills/.gitkeep
git commit -m "chore: scaffold skills/ directory"
```

---

## Task 4: Add `template/SKILL.md`

**Files:**
- Create: `template/SKILL.md`

- [ ] **Step 1: Create `template/SKILL.md`**

Create file `template/SKILL.md` with exact contents:

```markdown
---
name: your-skill-name
description: One clear sentence describing what this skill does and when to use it. The model uses this to decide when to invoke the skill, so be specific about triggers and scope.
---

<!--
This file is a template. Copy it via `scripts/new-skill.sh <skill-name>`,
then edit the copy under `skills/<skill-name>/SKILL.md`.

Frontmatter rules:
- `name` must be lowercase, hyphen-separated, no spaces.
- `description` should make the trigger conditions obvious.
-->

# Your Skill Name

State the skill's purpose in one or two sentences.

## When to use

Describe the situations that should trigger this skill. Be concrete: name file patterns, user phrases, tasks, or tools that mean this skill applies.

## When not to use

List adjacent situations where the skill should be skipped, so the model does not over-fire.

## Instructions

Give the model the procedure to follow. Number steps if order matters.

## Examples

Provide one or two short worked examples.

## Notes

Anything else the model needs: constraints, edge cases, known pitfalls.
```

- [ ] **Step 2: Verify frontmatter parses**

Run:

```bash
head -4 template/SKILL.md
```

Expected: first four lines are exactly:

```
---
name: your-skill-name
description: One clear sentence describing what this skill does and when to use it. The model uses this to decide when to invoke the skill, so be specific about triggers and scope.
---
```

- [ ] **Step 3: Commit**

```bash
git add template/SKILL.md
git commit -m "chore: add SKILL.md authoring template"
```

---

## Task 5: Write test harness for `scripts/new-skill.sh`

**Files:**
- Create: `scripts/test_new_skill.sh`

This task writes the test harness *before* the script it tests, per TDD. The harness will fail until Task 6 implements `new-skill.sh`.

- [ ] **Step 1: Create `scripts/test_new_skill.sh`**

Create file `scripts/test_new_skill.sh` with exact contents:

```bash
#!/usr/bin/env bash
# Test harness for scripts/new-skill.sh.
# Runs the script against an isolated copy of the repo in a tempdir,
# asserts expected filesystem effects, and reports pass/fail per case.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/new-skill.sh"

PASS=0
FAIL=0

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

setup_sandbox() {
  local sandbox
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/skills" "$sandbox/template" "$sandbox/scripts"
  cp "$REPO_ROOT/template/SKILL.md" "$sandbox/template/SKILL.md"
  cp "$SCRIPT" "$sandbox/scripts/new-skill.sh"
  chmod +x "$sandbox/scripts/new-skill.sh"
  echo "$sandbox"
}

# Case 1: happy path creates the folder and file.
case_happy_path() {
  local sandbox
  sandbox="$(setup_sandbox)"
  (cd "$sandbox" && ./scripts/new-skill.sh my-test-skill >/dev/null 2>&1)
  local rc=$?
  if [ $rc -ne 0 ]; then
    fail "happy path exit code (got $rc, want 0)"
  elif [ ! -f "$sandbox/skills/my-test-skill/SKILL.md" ]; then
    fail "happy path did not create skills/my-test-skill/SKILL.md"
  elif ! grep -q "^name: my-test-skill$" "$sandbox/skills/my-test-skill/SKILL.md"; then
    fail "happy path did not rewrite name frontmatter to my-test-skill"
  else
    pass "happy path"
  fi
  rm -rf "$sandbox"
}

# Case 2: missing argument exits non-zero with usage on stderr.
case_missing_arg() {
  local sandbox stderr rc
  sandbox="$(setup_sandbox)"
  stderr="$(cd "$sandbox" && ./scripts/new-skill.sh 2>&1 >/dev/null)"
  rc=$?
  if [ $rc -eq 0 ]; then
    fail "missing arg should exit non-zero (got 0)"
  elif ! echo "$stderr" | grep -qi "usage"; then
    fail "missing arg should print usage on stderr (got: $stderr)"
  else
    pass "missing arg"
  fi
  rm -rf "$sandbox"
}

# Case 3: invalid name (uppercase) exits non-zero.
case_invalid_name() {
  local sandbox rc
  sandbox="$(setup_sandbox)"
  (cd "$sandbox" && ./scripts/new-skill.sh BadName >/dev/null 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    fail "invalid name should exit non-zero (got 0)"
  else
    pass "invalid name (uppercase)"
  fi
  rm -rf "$sandbox"
}

# Case 4: invalid name (spaces) exits non-zero.
case_invalid_name_spaces() {
  local sandbox rc
  sandbox="$(setup_sandbox)"
  (cd "$sandbox" && ./scripts/new-skill.sh "bad name" >/dev/null 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    fail "invalid name with spaces should exit non-zero (got 0)"
  else
    pass "invalid name (spaces)"
  fi
  rm -rf "$sandbox"
}

# Case 5: refuses to overwrite an existing skill folder.
case_no_overwrite() {
  local sandbox rc
  sandbox="$(setup_sandbox)"
  mkdir -p "$sandbox/skills/existing"
  echo "do not touch" > "$sandbox/skills/existing/SKILL.md"
  (cd "$sandbox" && ./scripts/new-skill.sh existing >/dev/null 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    fail "overwriting existing folder should exit non-zero (got 0)"
  elif ! grep -q "^do not touch$" "$sandbox/skills/existing/SKILL.md"; then
    fail "existing SKILL.md was modified"
  else
    pass "refuses to overwrite"
  fi
  rm -rf "$sandbox"
}

case_happy_path
case_missing_arg
case_invalid_name
case_invalid_name_spaces
case_no_overwrite

echo
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 2: Make the harness executable**

Run: `chmod +x scripts/test_new_skill.sh`

- [ ] **Step 3: Run the harness and confirm it fails (script does not exist yet)**

Run: `./scripts/test_new_skill.sh`
Expected: non-zero exit. Each case fails because `scripts/new-skill.sh` does not yet exist (the harness `cp` step will fail or the script invocations will not run).

This failure is intentional — it proves the harness exercises real behavior rather than passing vacuously.

- [ ] **Step 4: Commit**

```bash
git add scripts/test_new_skill.sh
git commit -m "test: add harness for scripts/new-skill.sh"
```

---

## Task 6: Implement `scripts/new-skill.sh`

**Files:**
- Create: `scripts/new-skill.sh`

- [ ] **Step 1: Create `scripts/new-skill.sh`**

Create file `scripts/new-skill.sh` with exact contents:

```bash
#!/usr/bin/env bash
# new-skill.sh — scaffold a new skill folder from template/SKILL.md.
#
# Usage:
#   ./scripts/new-skill.sh <skill-name>
#
# <skill-name> must be lowercase, hyphen-separated, and contain only
# [a-z0-9-]. The script refuses to overwrite an existing skills/<name>/
# folder.

set -eu

usage() {
  echo "Usage: $0 <skill-name>" >&2
  echo "       <skill-name>: lowercase, hyphen-separated, [a-z0-9-]+" >&2
}

if [ $# -lt 1 ]; then
  usage
  exit 2
fi

name="$1"

# Validate the name.
case "$name" in
  *[!a-z0-9-]*|"")
    echo "Error: invalid skill name '$name'." >&2
    usage
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
template="$repo_root/template/SKILL.md"
target_dir="$repo_root/skills/$name"
target_file="$target_dir/SKILL.md"

if [ ! -f "$template" ]; then
  echo "Error: template not found at $template" >&2
  exit 1
fi

if [ -e "$target_dir" ]; then
  echo "Error: $target_dir already exists; refusing to overwrite." >&2
  exit 1
fi

mkdir -p "$target_dir"

# Copy the template and rewrite the `name:` frontmatter field on the
# first matching line only.
awk -v new_name="$name" '
  BEGIN { replaced = 0 }
  /^name: / && replaced == 0 { print "name: " new_name; replaced = 1; next }
  { print }
' "$template" > "$target_file"

echo "Created $target_file"
echo
echo "Next steps:"
echo "  1. Edit $target_file — update the description and body."
echo "  2. Add the skill to README.md under the skill index."
echo "  3. git add skills/$name && git commit -m \"feat: add $name skill\""
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/new-skill.sh`

- [ ] **Step 3: Run the harness and verify all cases pass**

Run: `./scripts/test_new_skill.sh`
Expected last line: `Results: 5 passed, 0 failed`. Exit code 0.

- [ ] **Step 4: Sanity-check against the real repo (no commit yet)**

Run:

```bash
./scripts/new-skill.sh demo-skill
cat skills/demo-skill/SKILL.md | head -4
```

Expected: file exists; first four lines are the frontmatter block with `name: demo-skill`.

Then remove the demo so it does not get committed:

```bash
rm -rf skills/demo-skill
```

- [ ] **Step 5: Commit**

```bash
git add scripts/new-skill.sh
git commit -m "feat: add new-skill scaffolder script"
```

---

## Task 7: Add `.claude-plugin/marketplace.json`

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p .claude-plugin`

- [ ] **Step 2: Create `.claude-plugin/marketplace.json`**

Create file `.claude-plugin/marketplace.json` with exact contents:

```json
{
  "name": "skills-sh",
  "owner": {
    "name": "Barry Roodt"
  },
  "plugins": [
    {
      "name": "skills-sh",
      "source": ".",
      "description": "Skills authored by Barry Roodt, distributed via skills.sh.",
      "skills": "./skills"
    }
  ]
}
```

- [ ] **Step 3: Verify JSON is valid**

Run: `python3 -c "import json,sys; json.load(open('.claude-plugin/marketplace.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "chore: add Claude Code plugin marketplace manifest"
```

---

## Task 8: Write `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

Create file `README.md` with exact contents:

```markdown
# skills.sh

A collection of Claude Code-compatible Skills authored by Barry Roodt and published to the [skills.sh](https://skills.sh) registry.

## Install

### Via skills.sh (any supported agent)

```bash
npx skills add <owner>/skills.sh
```

Replace `<owner>` with the GitHub owner of this repository. The skills.sh CLI installs every skill under `skills/` into your configured agent.

### Via Claude Code plugin marketplace

```bash
/plugin marketplace add <owner>/skills.sh
/plugin install skills-sh@skills-sh
```

## Skills

This index lists every skill in `skills/`. Update it whenever you add or remove a skill.

| Skill | Description |
| ----- | ----------- |
| _none yet_ | _Add your first skill with `./scripts/new-skill.sh <name>`._ |

## Authoring

To add a new skill:

```bash
./scripts/new-skill.sh my-skill-name
```

This copies `template/SKILL.md` into `skills/my-skill-name/SKILL.md`, pre-fills the `name:` frontmatter, and prints next steps. Edit the copy, add supporting files in the same folder if needed, update the skill index above, then commit.

The template lives in `template/SKILL.md`. See [Anthropic's Agent Skills spec](https://github.com/anthropics/skills/tree/main/spec) for the full frontmatter contract.

## Repository layout

```
skills.sh/
├── .claude-plugin/marketplace.json   # Claude Code marketplace manifest
├── skills/                           # one folder per skill
├── template/SKILL.md                 # starter template
├── scripts/new-skill.sh              # scaffolder
└── scripts/test_new_skill.sh         # test harness for the scaffolder
```

## License

Apache License 2.0. See [LICENSE](./LICENSE).
```

- [ ] **Step 2: Verify rendering of fenced blocks**

Run: `grep -c '^```' README.md`
Expected: an even number ≥ 6 (every opening fence has a matching close).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, authoring, and layout"
```

---

## Task 9: Commit design and plan documents

The spec and plan were authored under `docs/superpowers/` during brainstorming and planning. Commit them so they ship with the repository as historical context.

**Files:**
- Track: `docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md`
- Track: `docs/superpowers/plans/2026-05-17-skills-sh-repo-scaffold.md`

- [ ] **Step 1: Verify both files exist**

Run:

```bash
ls docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md \
   docs/superpowers/plans/2026-05-17-skills-sh-repo-scaffold.md
```

Expected: both paths print without error.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md \
        docs/superpowers/plans/2026-05-17-skills-sh-repo-scaffold.md
git commit -m "docs: add design spec and scaffold implementation plan"
```

---

## Task 10: Final verification

- [ ] **Step 1: Re-run the script test harness**

Run: `./scripts/test_new_skill.sh`
Expected last line: `Results: 5 passed, 0 failed`. Exit code 0.

- [ ] **Step 2: Inspect the working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

Run: `git ls-files`
Expected output (order may vary):

```
.claude-plugin/marketplace.json
.gitignore
LICENSE
README.md
docs/superpowers/plans/2026-05-17-skills-sh-repo-scaffold.md
docs/superpowers/specs/2026-05-17-skills-sh-repo-design.md
scripts/new-skill.sh
scripts/test_new_skill.sh
skills/.gitkeep
template/SKILL.md
```

- [ ] **Step 3: Review the commit history**

Run: `git log --oneline`
Expected: nine commits, one per Task 1 through Task 9, in order.

- [ ] **Step 4: Smoke-test the install paths conceptually**

These are documentation-only checks — no command run, just confirm the repo presents the right shape:

- `.claude-plugin/marketplace.json` exists at the repo root, so `/plugin marketplace add <owner>/skills.sh` will succeed once the repo is pushed to GitHub.
- `skills/` exists, so `npx skills add <owner>/skills.sh` will find an empty but valid skill set.
- `README.md` documents both install paths.

If all four steps pass, the scaffold is complete. Pushing the repo to GitHub and adding the first skill is out of scope for this plan.
