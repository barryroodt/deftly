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
