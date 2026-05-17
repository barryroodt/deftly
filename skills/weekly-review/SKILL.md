---
name: weekly-review
description: Generates a weekly recap markdown report from Linear (tickets), GitHub (PRs and reviews), and Notion (docs). Use when the user wants a weekly summary, weekly recap, standup notes, status update, or weekly review.
---

# Weekly Recap

Generates a summary of the week's work by pulling from Linear, Notion, and Github.

## Identity

Read identity from `~/.config/weekly-recap/identity.yaml`. Fields:

- `name` — display name
- `email` — work email
- `notion_user_id` — Notion user UUID
- `github` — GitHub username
- `linear_team` — Linear team name
- `linear_team_id` — Linear team UUID
- `linear_user_id` — Linear user UUID
- `output_dir` — directory for weekly recap files (e.g. `~/work/recaps`)

If the file does not exist, run first-time setup:

1. Use `AskUserQuestion` to collect identity fields. It supports up to 4 questions per call (the user answers all before submitting), so use two calls: first for name, email, GitHub username, and Linear team name; then for preferred output directory. Pre-populate options where possible (e.g. infer name/email from `git config`, list Linear teams via API, offer current directory and `~/work/recaps` for output directory). The user can always pick "Other" for free-text input.
2. Look up `notion_user_id` from email via `mcp__notion__notion-get-users`.
3. Look up `linear_user_id` from email via `mcp__linear-server__list_users`.
4. Look up `linear_team_id` from team name via `mcp__linear-server__list_teams`.
5. Write the file and continue.

## Workflow

1. **Determine the week range.** Default: current Monday through today.
2. **Linear: completed work.** `mcp__linear-server__list_issues` with `assignee: "me"`, `team: "{linear_team}"`, `state: "completed"`, `updatedAt` >= Monday. Post-filter to issues where `completedAt` falls within the target week.
3. **Linear: in-flight work.** `mcp__linear-server__list_issues` with `assignee: "me"`, `team: "{linear_team}"`, `state: "started"`.
4. **Linear: tickets I created for others.** `mcp__linear-server__list_issues` with `team: "{linear_team}"`, `createdAt` >= Monday. Filter to issues where `createdById` matches `{linear_user_id}` but `assigneeId` does not (or is null).
5. **Github: my PRs.** `gh search prs --author={github} --created="YYYY-MM-DD..YYYY-MM-DD" --json number,title,repository,state,url,closedAt,createdAt`. The `state` field returns `"merged"`, `"closed"`, or `"open"` — exclude PRs where state is `"closed"` (closed without merging). Do not use `mergedAt` — it is not a valid `gh search prs` JSON field.
6. **Github: review activity.** Two `gh search prs` queries (deduplicate results). Use `--json number,title,repository,state,url,author,createdAt` for both:
   - `gh search prs --reviewed-by={github} --updated="YYYY-MM-DD..YYYY-MM-DD" -- -author:{github}`
   - `gh search prs --commenter={github} --updated="YYYY-MM-DD..YYYY-MM-DD" -- -author:{github}`
7. **Notion: documents.** `mcp__notion__notion-search` with `query_type: "internal"`, filtered by `{notion_user_id}` and updates in the target week's date range. Build search terms in three layers: generic structural terms (`runbook, incident, design, postmortem, maintenance, deployment`), project keywords from the week's Linear/GitHub titles, then ask the user for additional terms. One search per term; deduplicate and drop trivial sub-pages.
8. **Fetch full details for investigation and truncated issues.** Before writing any summaries, call `mcp__linear-server__get_issue` for every completed issue that is either (a) an investigation ticket (title starts with "Investigate") or (b) had its description truncated in the list response. Write the "so what" from the actual resolution in the ticket, not from the title or a guess. For investigation tickets, include what action was taken or what mitigated the problem, not just the diagnosis — "investigated, linked to Tailscale DNS issues; Ansible playbook run corrected it" over "suspected Tailscale DNS issues." If the ticket doesn't document a resolution, say so ("resolution not documented") rather than inventing one.
   - Note that the `get_issue` call needs `id` as the input parameter, not `issueId`.
9. **Correlate PRs with Linear issues.** Merge PRs into their Linear tickets where linked. For unlinked PRs, check for matches by branch prefix or PR cross-references. Unmatched PRs go in Done (if merged) or In Flight (if open), grouped by theme alongside Linear-linked work — use the PR link instead of a Linear issue ID.
10. **Write the report** to `{output_dir}/YYYY-MM-DD.md` (Monday date). Title: `# Week of D Mon YYYY` (e.g. `# Week of 23 Feb 2026`).
11. **Format.** Run `npx prettier --write` on the output file.

## Report Structure

### TL;DR (at the top, no heading)

2-3 sentence summary in prose after the title, before any sections. Must touch all three: what shipped, what moved forward (in-flight highlights), and what's blocked (if anything). Focus on goals, themes, outcomes, and substance; don't count or number tasks or activity.

### Done this week

- Completed Linear issues grouped by theme, not by date. Prefer fewer, larger thematic groups — group by the project or initiative that caused the work, not by issue type. A bug caused by the pooling rollout belongs in the pooling section, not in a separate "bug fixes" section.
- Each bullet: issue ID (as link), title, one-line "so what" as a single clause, with associated PR(s) inline. List all PRs when a ticket spans multiple. The "so what" should lead with root cause or the nature of the change, not the symptom. "Three independent tier-mapping algorithms producing different results; consolidated to one" over "fixing two bugs where databases got undersized PgBouncer configs."
- When a ticket is an umbrella for sub-tickets (e.g. a maintenance window covering multiple config changes), nest the sub-tickets as indented sub-items rather than flattening everything. The umbrella bullet itself should summarize the aggregate change, not just repeat the title.

### In flight

- In-progress Linear issues and open PRs as a unified view, with both links where related.
- Short status note for each (e.g. "in review", "parked behind X", "deprioritized in favor of X").
- Do not guess at blockers — check the ticket or ask.

### Reviews

- Table: PR number as markdown link, title, author, repo. Use full PR titles — do not truncate to fit column widths.
- Only PRs where I reviewed or commented, not ones I authored.

### Docs written

- Notion documents created or substantially edited, with links and a one-line note on purpose.

### Tickets created

- Linear tickets I created but did not assign to myself.
- Each bullet: issue ID (as link), title, current status, assignee (or "unassigned").

## Gotchas

### Large Linear responses

`mcp__linear-server__list_issues` can save results to a file instead of returning inline. When this happens, extract with jq first — do not read the raw file:

1. `jq -r '.[0].text' /path/to/saved/file > /tmp/linear_issues.json`
2. Filter the extracted JSON. Use `| not` instead of `!=` (bash history expansion mangles it): `jq '[.issues[] | select(.createdById == "{linear_user_id}") | select(.assigneeId == "{linear_user_id}" | not)]' /tmp/linear_issues.json`

## Style

- Casual, factual
- Every section opens with 1-2 sentences of prose summary before its list/table. Section intros summarize the _substance_ of the work, not the inventory or the authors. "Mostly ppg-conductor and unikraft image fixes — tier config, per-region image selection, and a TLS crash in the prisma_postgres extension" is good. "I shipped 13 issues across three areas", "I reviewed PRs across six repositories", and "Reviewed mostly Barry's fixes and a few cross-team PRs" are all bad — counts, lists, and attributions are not summaries of what changed.
- Emphasize what changed or shipped, not activity
- When referring to a date by day name in prose, verify the day of week against the calendar. Do not assume events at the start of the week happened on Monday.
- Skip trivial items (config bumps, typo fixes) unless there's nothing else to report. Don't inflate light weeks.
- Done and In Flight are always present; if empty, keep the heading and note it
- Reviews, Docs written, and Tickets created are skipped when empty
- Use markdown link syntax for all links
- Linear issues: `[FT-1234](https://linear.app/prisma-company/issue/FT-1234)`
- Github PRs: `[#123](https://github.com/prisma/repo/pull/123)`
