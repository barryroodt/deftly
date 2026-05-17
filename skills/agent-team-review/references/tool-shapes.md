# Tool-Call Shapes

Concrete tool-call examples for orchestrating the review team.

## Create the team

```
TeamCreate({ name: "review-<branch-slug>" })
```

## Spawn a reviewer (correctness example)

```
Agent({
  team_name: "review-<branch-slug>",
  name: "correctness",
  subagent_type: "claude",
  prompt: `MANDATORY — Read skills/agent-team-review/templates/correctness.md and follow its Output Format exactly.

Diff to review:
<git diff output, scoped>

Report findings to the lead. If you spot a convention violation, message the conventions reviewer instead:
SendMessage({ to: "conventions", message: "<file:line> — <issue>" })`,
})
```

The same shape applies to `conventions`, `spec-compliance`, `contracts`, and specialist reviewers — swap the `name`, the template path, and the prompt body.

## Specialist reviewer

A specialist must invoke its skill inside its prompt so it loads with domain context:

```
Agent({
  team_name: "review-<branch-slug>",
  name: "rust-specialist",
  subagent_type: "claude",
  prompt: `Invoke the rust-pro skill via the Skill tool before reviewing.

MANDATORY — After loading rust-pro, read skills/agent-team-review/templates/correctness.md for output format.

Diff to review:
<git diff output, scoped to Rust files>`,
})
```

## Cross-review broadcast (Step 8)

After every reviewer has reported:

```
SendMessage({
  to: "*",
  message: "Summary so far:\n<aggregated findings>\n\nAmend, withdraw, or escalate based on what other reviewers found.",
})
```

## Cleanup (Step 10)

Shut each reviewer down, then delete the team:

```
SendMessage({ to: "<reviewer>", type: "shutdown_request" })
TeamDelete({ name: "review-<branch-slug>" })
```
