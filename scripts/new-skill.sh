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
