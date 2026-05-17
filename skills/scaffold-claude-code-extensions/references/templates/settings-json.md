# Template: `.claude/settings.json`

Base allow + deny rules. Append detected tech-stack allow rules (from
Step 2.4 of the main skill) to the `allow` array. Then ask the user for
additional deploy-command denials and additional WebFetch domains or MCP
servers, merging both into the appropriate lists before writing.

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "allow": [
      "Bash(open *)",
      "Bash(ls *)", "Bash(ls)",
      "Bash(which *)", "Bash(wc *)",
      "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
      "Bash(file *)", "Bash(stat *)", "Bash(pwd)",
      "Bash(date *)", "Bash(echo *)", "Bash(printf *)",
      "Bash(find *)", "Bash(grep *)", "Bash(xargs *)",
      "Bash(curl *)", "Bash(jq *)",
      "Bash(sort *)", "Bash(uniq *)", "Bash(diff *)",
      "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)", "Bash(touch *)",
      "Bash(basename *)", "Bash(dirname *)", "Bash(realpath *)",
      "Bash(base64 *)",
      "Bash(* --version)", "Bash(* --help)",

      "Bash(git *)", "Bash(gh *)",

      "mcp__linear__*",
      "mcp__axiom__*",
      "mcp__Notion__*",
      "mcp__context7__*",
      "mcp__Context7__*",
      "mcp__plugin_beads_beads__*",
      "mcp__plugin_claude-mem_mcp-search__*",

      "WebFetch(domain:github.com)",
      "WebFetch(domain:deepwiki.com)",
      "WebFetch(domain:raw.githubusercontent.com)"
    ],
    "deny": [
      "Bash(git merge main)",
      "Bash(git merge main *)",
      "Bash(git merge * main)",
      "Bash(git reset --hard *)",
      "Bash(git clean *)",
      "Bash(rm -rf *)",
      "Bash(rm -r *)",
      "Bash(gh pr merge *)",
      "Bash(gh pr close *)",
      "Bash(gh issue close *)",
      "Bash(* --force *)",
      "Bash(* --no-verify *)"
    ]
  }
}
```

`settings.local.json` is handled by the adapter's Step 2 with
read-first logic — do not duplicate that here.
