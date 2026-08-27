---
name: solo-agents-team-code
description: "Use when spawning sub-agents, coordinating multi-agent coding workflows, handling worker restarts, model-fallback escalation, or preventing deadlocks via lock ordering. Also covers idle-fire dispatch loops, sharing state across agents, and stalled-worker recovery. Harness-agnostic; the hard dependency is Solo MCP (works with whatever agent harness Solo can spawn). Triggers: spawn agent, orchestrate workers, sub-agent coordination, idle timer, multi-agent, dispatch loop, restart worker, model fallback, lock ordering, deadlock, timeout escalation."
---

# Solo Agents Team Code

## Overview

Solo MCP lets one orchestrator agent spawn worker sub-agents, hand them tasks, track shared todos, and wake itself when a worker goes idle. This skill captures the spawn defaults and the dispatch/verify loop.

**Hard dependency: Solo MCP** (and a selected project). Everything else is harness-agnostic — the orchestrator drives whatever agent harness Solo can spawn, keying launch, model, and escalation to that harness's own contract. Stop only if Solo MCP is unavailable or Solo can spawn no agent harness at all.

**Core principle:** send a worker one bounded task, wait through Solo lifecycle events when available, and verify observable done-criteria. Never busy-poll process output.

## Live Solo Preflight

Inspect the installed Solo tool surface before dispatch. Use `mcp_tools_summary` when available, or the live tool catalog. Call `whoami` in a fresh Solo session when available; otherwise pass the confirmed `project_id` explicitly.

Project scope, `list_agent_tools`, `spawn_agent`, `send_input`, process status, and process output are required. Todos, scratchpads, timers, locks, and KV are optional coordination groups. Missing optional groups must not block worker startup.

Use these fallbacks:

- Without todos, keep the task and dependency state in a scratchpad or in orchestrator memory.
- Without scratchpads, keep bounded handoffs in todo comments or orchestrator memory.
- Without timers, inspect workers only on a new user turn or another Solo lifecycle event. Never poll or sleep.
- Without locks, dispatch only work with disjoint ownership. Do not run overlapping edits concurrently.

Use the live tool schemas for every mutation. Never pass a revision, response mode, or other parameter only because another Solo install documents it.

### Runtime capability cache

When KV is available, use `solo-agents-team-code/runtime-capabilities/v1` as a project-scoped cache key with a TTL of `604800` seconds. Cache only:

- harness/runtime IDs and installation IDs,
- documented model-selection mechanisms,
- provider-qualified model IDs,
- the last selection verified by a real first prompt.

Treat the cache as a selection hint. Always call `list_agent_tools` for current availability and inspect the live tool catalog for schemas before dispatch. Never let cached fields replace, narrow, or override the live response.

Bypass the cache when the caller sets harness or model constraints. Discard a cached selection that conflicts with live capabilities. Write the cache only after the real worker prompt starts useful work. Never cache authentication, permissions, task packets, source context, prompts, or worker state.

A cache miss, stale entry, unavailable KV group, or incompatible schema falls through to live discovery without blocking dispatch.

## Worker Task Packets

Build one immutable task packet before each worker starts. Give it a stable packet ID and schema version. Include:

- exact task, scope, and exclusions,
- owned files or resources and coordination rules,
- acceptance criteria and required output shape,
- dependencies and current inputs,
- validation commands with one evidence owner each,
- selected handoff adapter and completion route.

Workers can report facts that invalidate a packet. They must not rewrite its scope, ownership, or acceptance criteria. A material change requires the orchestrator to issue a new packet version and record which version each result answers. Reject stale results after a replacement packet becomes active.

## Spawn Defaults

- **Pick the harness without name bias.** Resolve at spawn time via `list_agent_tools`: use the **caller-specified** harness if one was given (match by `name` or `id`); otherwise any harness `list_agent_tools` returns — every returned entry is a spawnable agent runtime, so do not filter by name or `tool_type`. If several are returned and the caller named none, pick one and note which (or ask). If a caller named a harness that is not in the list, **halt and report the available names** rather than substituting a different one. Never hardcode the id, it shifts per machine. Halt too if `list_agent_tools` returns nothing — Solo MCP is the hard dependency, not any particular harness.
- **Model handling follows the selected harness's contract.** Pass the model in the chosen harness's own form: e.g. the `Omp` harness uses a per-launch `extra_args=["--model", "<provider>/<model>"]` (never mutating saved defaults), slugs from `omp models`; a harness with its own model flag uses that flag/slug format. A caller-supplied model wins and is tried first — but only a harness with a documented model mechanism can honor it: if a model is explicitly requested and the selected harness has no known way to pass it, **halt and report (or pick a harness that supports it)** rather than silently running an unrelated saved default. Only when no model is requested may a harness run its saved default. Never assume one harness's flag works for another.
- **"Available" means it actually runs**, not that it appears in a model list or that `spawn_agent` succeeds. Traps: (1) a provider can be listed but unauthenticated; (2) an authenticated account can still reject a specific slug at runtime (e.g. ChatGPT-OAuth accounts rejecting certain `*-codex` slugs with "model is not supported when using Codex with a ChatGPT account"). Treat any selected model/harness as worth a smoke test. A worker that boots can still refuse the first turn.
- **Verify with a send-input smoke test, never spawn acceptance alone.** After spawning, `send_input` a real first prompt — with the worker's `agent_instructions` prepended and crisp done-criteria included (e.g. "clean tree + one new commit, `cargo test` green") — and read the output: a working worker prints its boot banner and begins the task; a broken one prints an auth/model error banner ("No API key" / "not supported ..."). Only then arm the idle timer. The `wait_ms` below (10000) is a starting window, not a hard limit: slow boots (cold starts, large models, congested endpoints) can exceed it. Empty output with no error banner is a slow boot, not a broken worker — extend the wait and re-read before concluding. For a harness on a fixed default, the smoke test is how you confirm that default actually runs.
- **Choosing a model.** A caller-supplied model always wins and is tried first. For a harness whose model you can select, escalate along a fallback ladder ordered standard→strongest (see `references/model-ladder.md`; re-derive slugs from that harness's own model list). For a fixed-default harness, "escalation" means switching to another available harness, not respawning the same default (see Failure & Timeout Handling).

```
tools   = list_agent_tools()   # each entry exposes at least: id, name, tool_type
if caller_harness:  # caller named one -> honor it EXACTLY; never substitute a different harness
    harness = next((t for t in tools if t["name"] == caller_harness or t["id"] == caller_harness), None)
    if harness is None:
        halt_and_report(f"requested harness {caller_harness!r} not available; choices: {[t['name'] for t in tools]}")
else:               # none requested -> any returned harness (all entries are valid); if several, pick one and note it
    harness = tools[0] if tools else None
if harness is None:
    halt_and_report("Solo has no agent harness registered")  # Solo MCP is the hard dep, not any particular harness

# Model passing follows the SELECTED harness's documented contract. Do NOT assume one harness's flag works for another.
def launch_args(harness, model):
    if model is None:
        return []                       # no model requested -> harness runs its saved default
    if harness["name"] == "Omp":
        return ["--model", model]       # Omp's contract: --model "<provider>/<model>", slugs from `omp models`
    # <add other harnesses' documented model flag here as you learn them>
    halt_and_report(f"harness {harness['name']!r} has no known model-passing mechanism to honor "
                    f"requested model {model!r} — pick a harness that supports it, or omit the model")

w = spawn_agent(agent_tool_id=harness["id"], name="worker",
                extra_args=launch_args(harness, requested_model))  # requested_model = caller's model, else None -> saved default
# SMOKE TEST before trusting it — prepend agent_instructions (Solo process/project context):
send_input(process_id=w["process_id"],
           input=w["agent_instructions"] + "\n\n" + "<first task prompt>", wait_ms=10000)  # extend for slow boots; empty+no-error != broken
#   good  -> boot banner + worker starts the task
#   bad   -> auth/model error banner -> close + escalate (selectable model: next slug; fixed default: switch harness)
```

## Concurrent Multi-Worker Startup

For independent ready work, start workers concurrently with their real task packets. Keep blocked work out of the batch until its inputs exist.

Use four ordered parallel batches:

1. Create available todo or scratchpad task state for every ready worker.
2. Spawn every worker with the selected live runtime.
3. Send every complete real prompt with prepended `agent_instructions` and a short `wait_ms`, such as `250`.
4. Inspect every process status and output once.

Record each process ID, packet version, owned scope, and expected completion signal. Treat useful work as a successful smoke test. Explicit authentication, model, or launch errors fail immediately. Empty output without an error is an ambiguous slow boot and follows the timer or lifecycle-event fallback.

Partial startup does not cancel successful workers. Recover only failed starts, using the identical active task packet unless a new version is issued.

## Validation Ownership

Assign one evidence owner to each required validation command before dispatch. The owner runs that command once, captures its exact result, and reports it to the orchestrator. Other workers can run narrower checks for their own changes, but must not duplicate an owned repository or integration check.

Run an owned command only after its required artifacts land. The orchestrator checks that every required command has one owner, that evidence matches the active packet versions and final artifacts, and that each failure has a concrete resolution.

## Optional Independent Judgment

Add an independent reviewer or verifier when completion depends on cross-worker integration, security, protocol behavior, or explicit caller-requested judgment. Give it a separate read-only packet with the claim to assess, relevant artifacts, acceptance criteria, and evidence owner map.

This lane is unnecessary for ordinary isolated work. It returns evidence and one `accept`, `reject`, or `blocked` judgment. The orchestrator remains accountable for resolving the result and deciding whether another implementation or judgment pass is necessary.

## The Idle-Fire Loop

When timers are available, arm the timer only after the real first prompt is sent:

```
timer_fire_when_idle_any(
  processes=[<worker process_id>],
  max_wait_ms=600000,
  body="<worker> wake: FIRST call get_process_status; running/producing → use producing-timeout recovery; exited/error → use crash recovery; idle → verify Task N done-criteria (clean → persist handoff + complete todo + inspect newly unblocked work; fail → send_input the failing criteria then re-arm).",
)
```

`timer_fire_when_idle_any` waits for a new idle transition and can ignore a process that was already idle when armed. `timer_fire_when_idle_all` can return `already_satisfied`; inspect the barrier immediately because no later wake will occur. Give every timer a finite maximum wait and a self-contained body with process IDs, task IDs, state locators, and the next action. Cancel obsolete timers when work completes or changes owner.

On wake the same body is injected whether the worker went idle, hit `max_wait_ms`, or exited. Inspect the worker first with `get_process_status`, then read only new output when needed:

- **`running` / producing new output:** do not run done-criteria. Use the producing-timeout recovery path.
- **`exited` / error:** do not send input or re-arm against a dead process. Use the crash recovery path.
- **`idle`:** verify the observable done-criteria. Idle is not completion.

### Done checks

The orchestrator declares completion only when all applicable checks pass:

```text
git status --porcelain   # empty, or only the explicitly expected changes
git log --oneline -1    # expected commit, when the task requires a commit
<targeted task checks>   # pass against the final artifacts
<required repo checks>   # pass once under their assigned evidence owners
```

Also require every worker result to match the active packet version, every required artifact to exist, each handoff to be complete, and shared-state readback to match the final state when supported.

Worker completion, idle state, successful startup, or an optional reviewer verdict cannot replace these checks.

Without timers, wait for a new user turn or Solo lifecycle event, then perform one batched status inspection. State that automatic wake-up is unavailable. Never replace timers with polling.

### Complete and unblock

When the worker satisfies its done-criteria:

1. Persist its handoff in the selected state adapter. Include changed artifacts, checks, remaining risk, active child processes, and restart context. Read it back when the adapter supports reads.
2. When todos are available, call `todo_complete(completed=true, response_mode="rich")` if the live schema supports that response mode.
3. Call `todo_get` when available and require the task to report complete.
4. Inspect each dependent task returned or affected by completion. Dispatch it only when Solo reports all blockers satisfied.
5. Send the newly actionable task to its assigned worker, or spawn its worker, then read back the canonical process status.

Without todos, mark the task complete in the scratchpad or orchestrator state, recompute dependency edges, and dispatch only newly actionable work.

If done-criteria fail, send the specific gap to the worker before another wait. Re-arming an idle worker without corrective input gives it nothing to do.

Use `timer_fire_when_idle_any` for first-finished dispatch, `timer_fire_when_idle_all` for a real barrier, and `timer_set` only for a delay unrelated to process idleness.

For multi-worker fan-out, define one task per worker before spawning and encode dependency order in the available state adapter. Cap concurrency at 2–3 workers unless edit ownership is disjoint.

## Solo Mutation Safety

Treat a successful mutation response as acceptance, not proof of intended state. Capability-gate readback through the live schema:

- process creation or restart through `get_process_status`,
- todo creation, blockers, and completion through `todo_get` when available,
- scratchpad changes through `scratchpad_read` when available,
- timer creation or cancellation through its response or `timer_list` when available.

Use `expected_revision` only when the installed scratchpad operation exposes it. On conflict, re-read the affected section and reapply once. Without revision support, prefer append-only updates and read them back. If no readback exists, label the state unverified.

## Failure & Timeout Handling

**MANDATORY:** when done-criteria fail, a worker never goes idle, or a worker crashes, load `references/failure-handling.md` for the full retry/escalate/abort ladder. **Do NOT load it during normal dispatch** — only on a non-clean idle wake or spawn failure.

## Coordination Surface

**MANDATORY:** when you need exact todo, scratchpad, lock, identity, or lifecycle operations, load `references/coordination-surface.md`. **Do NOT load it during routine dispatch** when the live tool schema already answers the call.

## Common Mistakes

- **NEVER** hardcode the harness id, assume a specific harness, or filter by name / `tool_type` — **INSTEAD** resolve at runtime via `list_agent_tools`: the caller-specified harness if given, else any returned entry (all are spawnable agent runtimes). If the caller named a harness that is not returned, **halt and report the choices — never silently substitute another.** Halt too if `list_agent_tools` returns nothing at all.
- **NEVER** assume one harness's model flag works for another, and **NEVER** silently ignore a requested model — **INSTEAD** pass a requested model in the *selected* harness's documented form (`Omp`: per-launch `--model <provider>/<model>`; others: their own flag); if the selected harness has no documented model mechanism, halt and report (or switch harnesses) rather than dropping the model. Only when no model is requested may a harness run its saved default; always smoke-test.
- **NEVER** assume idle means done — **INSTEAD** run the concrete Done checks before completing a todo or dispatching dependent work.
- **NEVER** send a bare prompt to a worker — **INSTEAD** prepend `agent_instructions` so the worker has its Solo process/project context.
- **NEVER** busy-poll process output — **INSTEAD** use idle-fire timers when available; otherwise inspect once on a new user turn or Solo lifecycle event.
- **NEVER** wait indefinitely on a stalled worker — **INSTEAD** after 2 failed retries escalate per the selected harness: a selectable-model harness → `close_process` + `spawn_agent` with a stronger model in that harness's form; a fixed-default harness → switch to another available harness (respawning it unchanged is not an escalation); if neither is possible, mark the todo blocked. `restart_process` only relaunches the same spec.
- **NEVER** dispatch overlapping edits without mutual exclusion — **INSTEAD** use live lock tools in a consistent order when available, or require disjoint ownership.
