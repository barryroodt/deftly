# Model Fallback Ladder

Applies to any harness **whose model you can select** (e.g. the `Omp` harness via `--model <provider>/<model>`, or another harness via its own model flag). A fixed-default harness has no ladder — escalate by switching to another available harness instead (see `failure-handling.md`).

Fallback ladder, ordered standard→strongest — on each escalation advance to the next entry until one passes the smoke test:

1. `anthropic/claude-sonnet-4` (standard coding default)
2. `openai/gpt-5` (stronger reasoning / larger context)
3. `anthropic/claude-opus-4` (strongest coding + reasoning tier)

A caller-supplied model always wins and is tried first. Re-verify per machine; auth and supported slugs differ between accounts and hosts, so replace any rung that fails to authenticate with the next known-good slug for that host.

**The concrete slugs above are drift-prone examples, not a canonical list** — providers rename, retire, and add models over time. Derive the real ladder from the *selected harness's* own model list (for `Omp`, `omp models`) rather than trusting these literals.
